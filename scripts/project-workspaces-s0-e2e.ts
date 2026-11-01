// S0 diagnostics use real host stores and controlled child processes, never live providers.
// Run: bun scripts/project-workspaces-s0-e2e.ts --group lifecycle
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { Packet } from "./project-workspaces-s0/worker";

// The installed Bun cannot load node:sqlite. Run the real database on Node.
if (process.versions.bun) {
  const child = spawn("node", ["--import", "tsx", import.meta.filename, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  process.exit(typeof code === "number" ? code : 1);
}
const { openHost, packetSchema } = await import("./project-workspaces-s0/worker");

const logger = createOpenBotLogger("project-workspaces-s0");
const ROOT = resolve(import.meta.dirname, "..");
const DEADLINE_MS = 30_000;
const groupSchema = z.enum(["lifecycle", "access", "credentials"]);
type ProbeGroup = z.infer<typeof groupSchema>;
const evidenceSchema = z.strictObject({
  id: z.string().min(1),
  caseId: z.string().min(1),
  provider: z.string().min(1),
  mode: z.string().min(1),
  entryPoint: z.string().min(1),
  subject: z.enum(["host", "provider"]),
  guarantee: z.enum([
    "admission",
    "audience",
    "identity",
    "delivery",
    "termination",
    "history",
    "credential-selection",
    "redaction",
    "confinement",
  ]),
  support: z.enum(["supported", "unsupported", "unverified"]),
  basis: z.enum(["source", "service-fixture", "live-provider"]),
  source: z.array(z.string().min(1)).min(1),
  artifacts: z.array(z.string().min(1)),
  observed: z.string().min(1),
  limitation: z.string().nullable(),
});
type EvidenceRow = z.infer<typeof evidenceSchema>;
const reportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  platform: z.string(),
  versions: z.record(z.string(), z.string()),
  groups: z.array(groupSchema).min(1),
  probeRunPassed: z.boolean(),
  rows: z.array(evidenceSchema),
  failures: z.array(z.string()),
});
type ProbeReport = z.infer<typeof reportSchema>;
const CASES: Record<ProbeGroup, string[]> = {
  lifecycle: [
    "duplicate-delivery",
    "handoff-crash",
    "surviving-worker",
    "cancel-before-dispatch",
    "late-completion",
    "destination-delete-receipt",
  ],
  access: ["audience-and-derived-content", "local-owner-and-remote-principal"],
  credentials: ["credential-fallback", "credential-revocation"],
};

function validateReport(report: ProbeReport): void {
  assert.equal(report.probeRunPassed, true, "Probe run did not pass");
  assert.deepEqual(report.failures, [], "Probe failures must be empty");
  assert.equal(new Set(report.groups).size, report.groups.length, "Duplicate groups");
  assert.equal(new Set(report.rows.map((row) => row.id)).size, report.rows.length, "Duplicate evidence IDs");
  for (const group of report.groups)
    for (const caseId of CASES[group]) {
      assert.ok(
        report.rows.some((row) => row.caseId === caseId),
        `Missing case: ${caseId}`,
      );
    }
  for (const row of report.rows) {
    assert.ok(
      report.groups.some((group) => CASES[group].includes(row.caseId)),
      `Unexpected case: ${row.caseId}`,
    );
    if (row.support !== "supported") assert.ok(row.limitation?.trim(), `Missing limitation: ${row.id}`);
    if (row.basis !== "source") assert.ok(row.artifacts.length, `Missing runtime artifacts: ${row.id}`);
    if (row.support === "supported" && row.guarantee === "confinement" && row.subject === "provider") {
      assert.equal(row.basis, "live-provider", "Provider confinement requires live-provider evidence");
    }
    for (const artifact of row.artifacts)
      assert.ok(
        !artifact.startsWith("/") && !artifact.split(/[\\/]/).includes(".."),
        "Artifact must remain inside run directory",
      );
  }
  if (report.groups.includes("credentials"))
    for (const proxy of ["available", "unavailable"])
      for (const token of ["present", "absent"]) {
        assert.ok(
          report.rows.some(
            (row) => row.caseId === "credential-fallback" && row.mode === `proxy-${proxy}/repository-token-${token}`,
          ),
          "Missing credential-fallback combination",
        );
      }
}

async function record(
  runDirectory: string,
  row: Omit<EvidenceRow, "artifacts">,
  details: object,
): Promise<EvidenceRow> {
  const artifact = `${row.id}.json`;
  await writeFile(join(runDirectory, artifact), `${redactText(JSON.stringify(details, null, 2))}\n`);
  return { ...row, artifacts: [artifact] };
}
function lifecycleRow(
  caseId: string,
  guarantee: EvidenceRow["guarantee"],
  support: EvidenceRow["support"],
  observed: string,
  limitation: string | null,
): Omit<EvidenceRow, "artifacts"> {
  return {
    id: caseId,
    caseId,
    provider: "controlled-worker",
    mode: "temporary-host/channel/busy-scheduling-hook",
    entryPoint: "ChannelService/MailboxStore",
    subject: "host",
    guarantee,
    support,
    basis: "service-fixture",
    source: ["src/backend/channel-service.ts:1837 recover", "src/backend/mailbox-store.ts:497 enqueue"],
    observed,
    limitation,
  };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Diagnostic step deadline exceeded")), DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function childProcess(role: "host" | "worker", runId: string, directory: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(ROOT, "scripts/project-workspaces-s0/worker.ts"), role, runId, directory],
    {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH, OPENBOT_LOG_LEVEL: "error" },
    },
  );
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-8000);
  });
  const pending = new Map<
    string,
    { resolve: (packet: Packet) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const received = new Map<string, Packet>();
  const transcript: Packet[] = [];
  const lines = createInterface({ input: child.stdout });
  function fail(error: Error) {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  }
  lines.on("line", (line) => {
    try {
      const packet = packetSchema.parse(JSON.parse(line));
      assert.equal(packet.runId, runId);
      transcript.push(packet);
      const waiter = pending.get(packet.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(packet.id);
        waiter.resolve(packet);
      } else received.set(packet.id, packet);
    } catch (error) {
      fail(new Error(`Invalid worker packet: ${String(error)}`));
    }
  });
  child.on("error", fail);
  child.on("exit", () => {
    lines.close();
    fail(new Error(`Child exited: ${redactText(stderr)}`));
  });
  const receive = (id: string): Promise<Packet> => {
    const packet = received.get(id);
    if (packet) {
      received.delete(id);
      return Promise.resolve(packet);
    }
    return new Promise((resolvePacket, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Missing acknowledgement: ${id}`));
      }, DEADLINE_MS);
      pending.set(id, { resolve: resolvePacket, reject, timer });
    });
  };
  const send = (type: Packet["type"], action?: Packet["action"]) => {
    const id = randomUUID();
    const answer = receive(id);
    child.stdin.write(`${JSON.stringify({ runId, id, type, action })}\n`);
    return answer;
  };
  try {
    assert.equal((await receive("ready")).type, "ready");
  } catch (error) {
    child.kill("SIGKILL");
    await exited;
    throw error;
  }
  return {
    transcript,
    send,
    async kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    },
    async close() {
      try {
        if (child.exitCode === null && child.signalCode === null) assert.equal((await send("stop")).type, "stopped");
      } finally {
        child.stdin.end();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        await exited;
      }
    },
  };
}

async function runLifecycleProbes(runDirectory: string): Promise<EvidenceRow[]> {
  const rows: EvidenceRow[] = [];
  const host = await openHost(join(runDirectory, "store"));
  try {
    const id = await host.seed();
    const duplicate = await runCauseEffect(host.mailbox.enqueue(host.input));
    const changed = await runCauseEffect(host.mailbox.enqueue({ ...host.input, text: "Changed payload" }));
    assert.deepEqual(duplicate, changed);
    assert.equal(host.mailbox.deliveryForKey(host.input.idempotencyKey)?.delivery.id, id);
    rows.push(
      await record(
        runDirectory,
        lifecycleRow(
          "duplicate-delivery",
          "delivery",
          "unsupported",
          "Duplicate keys return the same delivery, including a changed payload.",
          "Canonical request fingerprint enforcement is absent on this path.",
        ),
        { deliveryId: id, duplicate, changed },
      ),
    );
    await runCauseEffect(host.mailbox.cancel(host.agent.id, id));
    await runCauseEffect(host.channels.recover());
    assert.equal(host.mailbox.getDelivery(id)?.delivery.status, "cancelled");
    assert.equal(host.schedules(), 0);
    rows.push(
      await record(
        runDirectory,
        lifecycleRow(
          "cancel-before-dispatch",
          "admission",
          "supported",
          "Cancelled queued delivery stays cancelled through recovery and schedules no work.",
          "Controlled busy hook; no project gate or real provider launch is tested.",
        ),
        { status: host.mailbox.getDelivery(id)?.delivery.status, schedules: host.schedules() },
      ),
    );
    const commandId = "s0-shared-command";
    host.database.dispatch(
      commandId,
      [
        { aggregateType: "channel", aggregateId: host.channelId, eventType: "s0.marker", payload: {} },
        { aggregateType: "s0-diagnostic", aggregateId: "s0-other", eventType: "s0.marker", payload: {} },
      ],
      () => ({ retained: true }),
    );
    assert.ok(host.database.commandResult(commandId));
    await runCauseEffect(host.channels.deleteChannel(host.channelId));
    const remaining = host.database.connection
      .prepare(
        "SELECT count(*) AS count FROM orchestration_events WHERE command_id = ? AND aggregate_type = 's0-diagnostic'",
      )
      .get(commandId);
    assert.equal(host.channels.store.exists(host.channelId), false);
    assert.equal(remaining?.count, 1);
    assert.equal(host.database.commandResult(commandId), undefined);
    host.database.close();
    await runCauseEffect(host.database.initialize());
    assert.equal(host.database.commandResult(commandId), undefined);
    rows.push(
      await record(
        runDirectory,
        lifecycleRow(
          "destination-delete-receipt",
          "history",
          "unsupported",
          "Channel deletion removed a shared command receipt while the diagnostic aggregate event remained after reopen.",
          "No project schema exists; this exercises the existing cross-aggregate persistence boundary.",
        ),
        {
          remaining,
          receiptPresent: host.database.commandResult(commandId) !== undefined,
          channelPresent: host.channels.store.exists(host.channelId),
        },
      ),
    );
  } finally {
    await host.close();
  }
  const boundaries = ["enqueue", "running", "terminal"] as const;
  const crashes: object[] = [];
  for (const boundary of boundaries) {
    const state = join(runDirectory, `crash-${boundary}`);
    const runId = randomUUID();
    const first = await childProcess("host", runId, state);
    let worker: Awaited<ReturnType<typeof childProcess>> | undefined;
    try {
      const enqueued = await first.send("start", "enqueue");
      if (boundary !== "enqueue") {
        worker = await childProcess("worker", runId, state);
        await worker.send("start");
        await first.send("start", "running");
      }
      if (boundary === "terminal") await worker?.send("finish");
      await first.kill();
      const next = await childProcess("host", runId, state);
      try {
        const recovered = await next.send("start", "recover");
        assert.equal(recovered.deliveryId, enqueued.deliveryId);
        assert.equal(recovered.schedules, 0);
        crashes.push({
          boundary,
          enqueued,
          recovered,
          first: first.transcript,
          restarted: next.transcript,
          worker: worker?.transcript ?? [],
        });
      } finally {
        await next.close();
      }
    } finally {
      await first.kill();
      await worker?.close();
    }
  }
  rows.push(
    await record(
      runDirectory,
      lifecycleRow(
        "handoff-crash",
        "delivery",
        "supported",
        "The persisted delivery ID survived each controlled host crash without a new schedule.",
        "Recovery ran with a busy hook; the probe does not certify real provider launch or project-intent atomicity.",
      ),
      { crashes },
    ),
  );
  rows.push(
    await record(
      runDirectory,
      lifecycleRow(
        "surviving-worker",
        "termination",
        "unverified",
        "Controlled workers remained responsive after host exit; persisted running deliveries were retained.",
        "Busy hook prevents replacement. Real provider identity detection, descendant termination and effect reconciliation remain unverified.",
      ),
      { crashes: crashes.slice(1) },
    ),
  );
  const interrupt = Promise.withResolvers<void>();
  const acknowledge = Promise.withResolvers<void>();
  const completed = Promise.withResolvers<void>();
  const late = await openHost(join(runDirectory, "late"), {
    interrupt: () =>
      Effect.promise(() => {
        interrupt.resolve();
        return acknowledge.promise;
      }),
    changed: () => {
      if (late.channels.store.assignments(late.channelId).some((item) => item.state === "completed"))
        completed.resolve();
    },
  });
  try {
    const id = await late.seed();
    await runCauseEffect(late.mailbox.markStarting(id));
    await runCauseEffect(late.mailbox.markRunning(id, "s0-turn"));
    await runCauseEffect(late.channels.accepted(id, "s0-session", "s0-turn"));
    const stop = runCauseEffect(
      late.channels.command(
        { type: "stop", operationId: "s0-stop", channelId: late.channelId, taskId: "s0-task", recipientAgentId: null },
        { id: "s0-owner", name: "S0 owner" },
      ),
    );
    await bounded(interrupt.promise);
    await runCauseEffect(late.mailbox.markTerminal(id, "completed"));
    assert.equal(
      late.channels.event({
        type: "turn-completed",
        agentId: late.agent.id,
        threadId: late.channels.store.context(late.channelId, late.agent.id).threadId,
        turnId: "s0-turn",
        status: "completed",
      }),
      true,
    );
    await bounded(completed.promise);
    const beforeAcknowledgement = late.channels.store.assignments(late.channelId)[0]?.state;
    assert.equal(beforeAcknowledgement, "completed");
    acknowledge.resolve();
    await bounded(stop);
    const task = late.channels.store.tasks(late.channelId)[0];
    assert.equal(late.mailbox.getDelivery(id)?.delivery.status, "completed");
    rows.push(
      await record(
        runDirectory,
        lifecycleRow(
          "late-completion",
          "termination",
          "supported",
          "Completion arrived before interrupt acknowledgement; the assignment and mailbox retained completed status.",
          "Task stop state is recorded separately. A service event is not proof of provider process exit.",
        ),
        { task, beforeAcknowledgement, status: late.mailbox.getDelivery(id)?.delivery.status },
      ),
    );
  } finally {
    acknowledge.resolve();
    await late.close();
  }
  return rows;
}

async function main() {
  const verify = process.argv.indexOf("--verify-report");
  if (verify !== -1) {
    const path = process.argv[verify + 1];
    assert.ok(path, "Missing report path");
    const report = reportSchema.parse(JSON.parse(await readFile(path, "utf8")));
    validateReport(report);
    for (const row of report.rows) for (const artifact of row.artifacts) await readFile(join(dirname(path), artifact));
    logger.info("Report verified", { path, rows: report.rows.length });
    return;
  }
  const selected = process.argv[process.argv.indexOf("--group") + 1];
  const groups: ProbeGroup[] =
    selected === "all" ? ["lifecycle", "access", "credentials"] : [groupSchema.parse(selected)];
  const runId = randomUUID();
  const runDirectory = join(ROOT, ".openbot-build/project-workspaces-s0", runId);
  await mkdir(runDirectory, { recursive: true });
  const report: ProbeReport = {
    schemaVersion: 1,
    runId,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    platform: process.platform,
    versions: {
      node: process.versions.node,
      runnerSha256: createHash("sha256")
        .update(await readFile(import.meta.filename))
        .digest("hex"),
      workerSha256: createHash("sha256")
        .update(await readFile(join(ROOT, "scripts/project-workspaces-s0/worker.ts")))
        .digest("hex"),
    },
    groups,
    probeRunPassed: false,
    rows: [],
    failures: [],
  };
  try {
    for (const group of groups) {
      if (group !== "lifecycle") throw new Error(`Missing group: ${group}`);
      report.rows.push(...(await runLifecycleProbes(runDirectory)));
    }
    report.probeRunPassed = true;
    validateReport(report);
  } catch (error) {
    report.probeRunPassed = false;
    report.failures.push(redactText(String(error)));
  }
  const reportPath = join(runDirectory, "report.json");
  await writeFile(reportPath, `${redactText(JSON.stringify(report, null, 2))}\n`);
  logger.info("S0 report", {
    reportPath,
    passed: report.probeRunPassed,
    rows: report.rows.length,
    failures: report.failures,
  });
  if (!report.probeRunPassed) process.exitCode = 1;
}
if (import.meta.main) await main();
