import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const source = process.argv.find((value) => value.startsWith("--report="))?.slice(9);
assert.ok(source, "Pass an actual completed planning report.");
const root = resolve(import.meta.dirname, "..");
const evidenceRoot = join(root, ".openbot-build/project-planning");
const output = join(evidenceRoot, randomUUID(), "verifier");
await mkdir(output, { recursive: true, mode: 0o700 });
const original = JSON.parse(await readFile(source, "utf8"));
const cases: string[] = [];
let passed = false;
async function cli(args: string[]): Promise<number> {
  const child = spawn("bun", ["scripts/project-planning-e2e.ts", ...args], { cwd: root, stdio: "ignore" });
  const [code] = await once(child, "exit");
  return typeof code === "number" ? code : 1;
}
try {
  assert.equal(await cli(["--verify-report", source]), 0, "The actual positive report must verify first.");
  cases.push("actual-report-control");
  const appSource = process.argv.find((value) => value.startsWith("--app-report="))?.slice(13);
  if (appSource) {
    assert.equal(await cli(["--verify-report", appSource]), 0);
    const app = JSON.parse(await readFile(appSource, "utf8"));
    delete app.runtime;
    delete app.platform;
    const missingRuntime = join(output, "missing-runtime.json");
    await writeFile(missingRuntime, JSON.stringify(app));
    assert.equal(await cli(["--verify-report", missingRuntime]), 1);
    cases.push("missing-application-runtime-refusal");
  }
  const missing = join(output, "missing-case.json");
  await writeFile(missing, JSON.stringify({ ...original, cases: original.cases.slice(1) }));
  assert.equal(await cli(["--verify-report", missing]), 1);
  cases.push("missing-case-refusal");
  const fake = join(output, "false-native.json");
  await writeFile(fake, JSON.stringify({ ...original, basis: "native" }));
  assert.equal(await cli(["--verify-report", fake]), 1);
  cases.push("false-native-refusal");
  const before = new Set(await readdir(evidenceRoot));
  assert.equal(await cli(["--worker-failure-probe"]), 1);
  const added = (await readdir(evidenceRoot)).filter((name) => !before.has(name));
  assert.equal(added.length, 1);
  const failure = JSON.parse(await readFile(join(evidenceRoot, added[0] ?? "", "supervisor/report.json"), "utf8"));
  assert.equal(failure.passed, false);
  assert.equal(failure.basis, "supervisor");
  assert.equal(failure.failure, "WorkerSignal:SIGKILL");
  cases.push("owned-worker-unexpected-exit");
  passed = true;
} finally {
  await writeFile(
    join(output, "report.json"),
    `${JSON.stringify({ schemaVersion: 1, basis: "verifier", passed, cases }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({ output, passed })}\n`);
}
