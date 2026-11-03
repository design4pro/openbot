// Owns one named stack. Hosted CI proves refusal; only a reviewed isolated configuration runs full proof.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";
import { readAllDevStackRecords, readDevStackRecords } from "./dev-automation/stack-registry";
import { runPlanningWorker } from "./project-planning/owned-worker";
import { verifyPlanningEvidence } from "./project-planning/report";

assert.equal(process.platform, "linux");
assert.equal(process.env.OPENBOT_PLANNING_ISOLATED, "xvfb");
assert.match(process.env.DISPLAY ?? "", /^:\d+$/u);
const mode = process.argv[2];
assert.ok(mode === "--mode=unsupported" || mode === "--mode=full");
const root = resolve(import.meta.dirname, "..");
assert.equal(
  readDevStackRecords().filter((record) => resolve(record.projectRoot) === root && record.services.includes("app"))
    .length,
  0,
  "The CI launcher needs an unused worktree; do not rebuild another live instance.",
);
const evidenceRoot = join(root, ".openbot-build/project-planning");
const output = join(evidenceRoot, randomUUID(), "launcher");
await mkdir(output, { recursive: true, mode: 0o700 });
const before = new Set(readAllDevStackRecords().map((record) => record.supervisorPid));
const instance = `wt-${createHash("sha256").update(randomUUID()).digest("hex")}`;
async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
const inspectorPort = await port();
const debugPort = await port();
const env = {
  ...process.env,
  OPENBOT_DEV_INSTANCE_ID: instance,
  OPENBOT_DEV_REMOTE_DEBUGGING_PORT: String(debugPort),
  V8_INSPECTOR_BRK_PORT: String(inspectorPort),
  OPENBOT_DEV_REMOTE_ROLE: "",
  OPENBOT_PLANNING_STACK_LOG: join(output, "stack.log"),
};
const log = openSync(join(output, "stack.log"), "a", 0o600);
function startStack() {
  const child = spawn("bun", ["run", "dev"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  return {
    child,
    exited: new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    }),
  };
}
let owned = startStack();
let stack = owned.child;
let stackExited = owned.exited;
let closing: Promise<void> | null = null;
const report: {
  schemaVersion: number;
  basis: string;
  mode: string;
  instance: string;
  cases: string[];
  passed: boolean;
  failure: string | null;
} = { schemaVersion: 1, basis: "launcher", mode, instance, cases: [], passed: false, failure: null };
function ownedStack() {
  const found = readAllDevStackRecords().filter(
    (record) => resolve(record.projectRoot) === root && !before.has(record.supervisorPid),
  );
  assert.ok(found.length <= 1, "Do not stop an ambiguous stack.");
  return found[0];
}
function stop(): Promise<void> {
  closing ??= (async () => {
    const record = ownedStack();
    if (record)
      assert.equal(await runPlanningWorker("bun", ["run", "dev:stop", `--pid=${record.supervisorPid}`], root), 0);
    else if (stack.exitCode === null && stack.signalCode === null) stack.kill("SIGTERM");
    await stackExited;
  })();
  return closing;
}
const deadline = setTimeout(() => {
  report.failure = "PlanningLauncherDeadlineExceeded";
  report.passed = false;
  void writeFile(join(output, "report.json"), JSON.stringify(report)).finally(() => {
    const cleanupDeadline = setTimeout(() => process.exit(1), 60000);
    void stop().finally(() => {
      clearTimeout(cleanupDeadline);
      process.exit(1);
    });
  });
}, 15 * 60_000);
async function ready(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let text = "";
    const data = (chunk: Buffer) => {
      writeSync(log, chunk);
      text = `${text}${chunk.toString()}`.slice(-16384);
      if (text.includes(`:${inspectorPort}/`)) resolve();
    };
    stack.stdout.on("data", data);
    stack.stderr.on("data", data);
    stack.once("error", reject);
    stack.once("exit", () => reject(new Error("The owned stack stopped before inspector readiness.")));
  });
  assert.ok(ownedStack());
}
try {
  await ready();
  async function run(script: string, args: string[], group?: string): Promise<void> {
    const prior = new Set(await readdir(evidenceRoot));
    const child = spawn("bun", [script, ...args], { cwd: root, env, stdio: "inherit" });
    const code = await new Promise<number>((resolve, reject) => {
      child.once("exit", (code) => resolve(code ?? 1));
      child.once("error", reject);
    });
    assert.equal(code, 0, `The ${group ?? "bootstrap"} worker must pass.`);
    assert.ok(
      readDevInstanceRecords().find(
        (record) => resolve(record.projectRoot) === root && record.instanceId === instance && record.service === "app",
      ),
      "The resumed app must publish its own named instance.",
    );
    if (group) {
      const matches: string[] = [];
      for (const id of (await readdir(evidenceRoot)).filter((id) => !prior.has(id))) {
        const file = join(evidenceRoot, id, group, "report.json");
        try {
          await readFile(file);
          matches.push(file);
        } catch (cause) {
          if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
        }
      }
      assert.equal(matches.length, 1);
      verifyPlanningEvidence(JSON.parse(await readFile(matches[0] ?? "", "utf8")));
      report.cases.push(group);
    }
  }
  const args = [`--instance=${instance}`, "--allow-mutations"];
  if (mode === "--mode=unsupported") {
    await run("scripts/project-planning-electron-e2e.ts", [...args, "--case=unsupported"]);
    report.cases.push("unsupported-configuration-refusal");
    await run("scripts/project-planning-electron-e2e.ts", [...args, "--case=files-public"]);
    report.cases.push("public-files");
  } else {
    await run("scripts/project-planning-electron-e2e.ts", args, "electron");
    await stop();
    closing = null;
    owned = startStack();
    stack = owned.child;
    stackExited = owned.exited;
    await ready();
    await run("scripts/project-planning-electron-e2e.ts", [...args, "--case=bootstrap"]);
    await run("scripts/project-planning-ui-e2e.ts", args, "ui");
    for (const group of ["files", "remote"])
      await run("scripts/project-planning-e2e.ts", ["--group", group, ...args], group);
  }
  report.passed = true;
} catch (cause) {
  report.failure = cause instanceof Error ? cause.message : "PlanningLauncherFailed";
  process.exitCode = 1;
} finally {
  try {
    await stop();
  } catch {
    report.passed = false;
    report.failure ??= "OwnedStackCleanupFailed";
    process.exitCode = 1;
  }
  closeSync(log);
  clearTimeout(deadline);
  await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ output, passed: report.passed })}\n`);
}
