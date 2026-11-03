import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The parent can still write failed evidence if its owned worker is killed before finally runs. */
export async function runPlanningWorker(command: string, args: string[], root: string): Promise<number> {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", env: process.env });
  const outcome = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", () => resolve({ code: null, signal: "spawn_failed" }));
  });
  if (outcome.code === 0) return 0;
  const output = join(root, ".openbot-build/project-planning", randomUUID(), "supervisor");
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(
    join(output, "report.json"),
    `${JSON.stringify({ schemaVersion: 1, basis: "supervisor", cases: [], passed: false, failure: outcome.signal ? `WorkerSignal:${outcome.signal}` : `WorkerExit:${outcome.code}` }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return outcome.code ?? 1;
}
