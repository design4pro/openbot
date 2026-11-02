// Drives local planning services on disposable profiles. No live provider or account is used.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { type PlanningReport, verifyPlanningReport } from "./project-planning/report";

if (process.versions.bun) {
  const child = spawn("node", ["--import", "tsx", import.meta.filename, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  process.exit(typeof code === "number" ? code : 1);
}
const logger = createOpenBotLogger("project-planning-e2e");
const args = process.argv.slice(2);
const root = resolve(import.meta.dirname, "..");
if (args[0] === "--identity-worker" && args.length === 2) {
  const { openIdentityProfile } = await import("./project-planning/identity");
  const identity = await openIdentityProfile(args[1] ?? "");
  // Machine-readable: private child-process result, synthetic profile identifiers only.
  process.stdout.write(`${JSON.stringify(identity)}\n`);
} else if (args[0] === "--verify-report" && args.length === 2) {
  verifyPlanningReport(JSON.parse(await readFile(args[1] ?? "", "utf8")));
  logger.info("Planning report verified.");
} else if (
  args.length === 2 &&
  args[0] === "--group" &&
  (args[1] === "identity" ||
    args[1] === "files-service" ||
    args[1] === "admission" ||
    args[1] === "domain" ||
    args[1] === "reviews")
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
    basis: "service",
    sourceHashes,
    cases: [],
    passed: false,
    failure: null,
  };
  try {
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
    report.passed = true;
    verifyPlanningReport(report);
  } catch (error) {
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
