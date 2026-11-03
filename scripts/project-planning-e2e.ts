// Drives local planning services on disposable profiles. No live provider or account is used.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { runPlanningWorker } from "./project-planning/owned-worker";
import { type PlanningReport, verifyPlanningEvidence, verifyPlanningReport } from "./project-planning/report";

if (process.versions.bun) {
  process.exit(
    await runPlanningWorker(
      "node",
      ["--import", "tsx", import.meta.filename, ...process.argv.slice(2)],
      resolve(import.meta.dirname, ".."),
    ),
  );
}
const logger = createOpenBotLogger("project-planning-e2e");
const args = process.argv.slice(2);
const root = resolve(import.meta.dirname, "..");
if (args[0] === "--worker-failure-probe" && args.length === 1) {
  process.kill(process.pid, "SIGKILL");
} else if (args[0] === "--group" && (args[1] === "files" || args[1] === "remote")) {
  if (args.length !== 4 || !args[2]?.startsWith("--instance=") || args[3] !== "--allow-mutations")
    throw new Error("Application evidence requires --instance=<name> --allow-mutations.");
  process.exit(
    await runPlanningWorker(
      "bun",
      ["scripts/project-planning-electron-e2e.ts", args[2], args[3], `--case=${args[1]}`],
      root,
    ),
  );
} else if (args[0] === "--identity-worker" && args.length === 2) {
  const { openIdentityProfile } = await import("./project-planning/identity");
  const identity = await openIdentityProfile(args[1] ?? "");
  // Machine-readable: private child-process result, synthetic profile identifiers only.
  process.stdout.write(`${JSON.stringify(identity)}\n`);
} else if (args[0] === "--verify-report" && args.length === 2) {
  verifyPlanningEvidence(JSON.parse(await readFile(args[1] ?? "", "utf8")));
  logger.info("Planning report verified.");
} else if (
  (args.length === 2 || (args.length === 3 && args[2]?.startsWith("--isolated-display="))) &&
  args[0] === "--group" &&
  (args[1] === "identity" ||
    args[1] === "files-service" ||
    args[1] === "admission" ||
    args[1] === "domain" ||
    args[1] === "reviews" ||
    args[1] === "native")
) {
  const group = args[1];
  const runId = randomUUID();
  const output = join(root, ".openbot-build", "project-planning", runId, group);
  const fixture = join(output, "fixture");
  await mkdir(fixture, { recursive: true, mode: 0o700 });
  const sourceHashes: Record<string, string> = {};
  const sourceFiles = [
    "scripts/project-planning-e2e.ts",
    "scripts/project-planning/identity.ts",
    "scripts/project-planning/report.ts",
    "src/backend/database/local-profile-identity.ts",
    "src/backend/local-planning/local-planning-schema.ts",
    "src/backend/openbot-database-schema.ts",
    "src/backend/database/database-core.ts",
    "src/backend/openbot-database.ts",
  ];
  if (group === "files-service")
    sourceFiles.push(
      "scripts/project-planning/files.ts",
      "src/backend/protected-profile-files.ts",
      "src/backend/agent/attachment-gateway.ts",
      "src/backend/attachment-files.ts",
      "src/backend/workspace-paths.ts",
      "src/main/team-api/route-files.ts",
    );
  if (group === "admission")
    sourceFiles.push(
      "scripts/project-planning/admission.ts",
      "src/main/private-planning-admission.ts",
      "src/main/screen-capture.ts",
      "src/backend/agent/screen-capture.ts",
      "src/backend/agent/openbot-tool-router.ts",
    );
  if (group === "domain" || group === "reviews")
    sourceFiles.push(
      "scripts/project-planning/domain.ts",
      "scripts/project-planning/domain-worker.ts",
      "packages/contracts/src/ipc-local-planning.ts",
      "src/backend/local-planning/local-planning-schemas.ts",
      "src/backend/local-planning/local-planning-authority.ts",
      "src/backend/local-planning/local-planning-errors.ts",
      "src/backend/local-planning/local-planning-service.ts",
      "src/backend/local-planning/local-planning-commands.ts",
      "src/backend/database/local-planning-records.ts",
      "src/backend/database/local-planning-drafts.ts",
    );
  if (group === "reviews")
    sourceFiles.push("scripts/project-planning/reviews.ts", "src/backend/local-planning/local-planning-reviews.ts");
  if (group === "native")
    sourceFiles.push(
      "scripts/project-planning/native.ts",
      "scripts/project-planning/native-fixture.ts",
      "scripts/install-remote-desktop-runtime.ts",
      "scripts/native-runtime-lock.ts",
      "scripts/cua-driver-lock.ts",
      "scripts/project-planning/x11-input-probe.py",
      "src/main/cua-driver-runtime.ts",
      "src/main/private-planning-native.ts",
      "src/main/cua-driver-daemon-client.ts",
      "src/main/cua-driver-action-tap.ts",
      "src/main/remote-screen-gateway.ts",
      "src/main/sunshine-moonlight-runtime.ts",
      "src/main/private-planning-admission.ts",
      "native-runtime.lock.json",
    );
  for (const file of sourceFiles)
    sourceHashes[file] = createHash("sha256")
      .update(await readFile(join(root, file)))
      .digest("hex");
  const report: PlanningReport = {
    schemaVersion: 1,
    runId,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    platform: `${process.platform}-${process.arch}`,
    runtime: `Node ${process.version}`,
    group,
    basis: group === "native" ? "native" : "service",
    sourceHashes,
    cases: [],
    passed: false,
    failure: null,
  };
  try {
    if (group === "native") {
      const result = await (await import("./project-planning/native")).nativeCases(
        fixture,
        args[2]?.slice("--isolated-display=".length) ?? "",
        (id) => report.cases.push(id),
      );
      report.cases = result.cases;
      report.nativeRuntime = result.nativeRuntime;
    } else {
      const { identityCases } = await import("./project-planning/identity");
      report.cases =
        group === "identity"
          ? await identityCases(fixture)
          : group === "files-service"
            ? await (await import("./project-planning/files")).fileServiceCases(fixture)
            : group === "admission"
              ? await (await import("./project-planning/admission")).admissionCases()
              : group === "domain"
                ? await (await import("./project-planning/domain")).domainCases(fixture)
                : await (await import("./project-planning/reviews")).reviewCases(fixture);
    }
    report.passed = true;
    verifyPlanningReport(report);
  } catch (error) {
    report.passed = false;
    report.failure = error instanceof Error ? error.name : "PlanningFailure";
    process.exitCode = 1;
  } finally {
    await rm(fixture, { recursive: true, force: true });
    const path = join(output, "report.json");
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    logger.info("Planning evidence written.", { path, passed: report.passed, failure: report.failure });
  }
} else {
  throw new Error("Use --group identity|files-service or --verify-report <path>.");
}
