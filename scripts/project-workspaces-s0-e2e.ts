// S0 diagnostics use real host stores and controlled child processes, never live providers.
// Run: bun scripts/project-workspaces-s0-e2e.ts --group lifecycle

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { CHANNEL_CHATS_CAPABILITY, SIGNED_OUT_CHANNEL_MEMBER_ID } from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { createOpenBotLogger, redactText, registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { TeamApiRequestContext } from "../src/main/team-api/request-context";
import type { ChannelSettingsAgents } from "../src/main/team-api/route-channels";
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

async function childProcess(role: "host" | "worker", runId: string, directory: string, exitAfterStart = false) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      join(ROOT, "scripts/project-workspaces-s0/worker.ts"),
      role,
      runId,
      directory,
      ...(exitAfterStart ? ["--exit-after-start"] : []),
    ],
    {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH, OPENBOT_LOG_LEVEL: "error" },
    },
  );
  const exited = once(child, "exit");
  let stderr = "";
  let failure: Error | null = null;
  let expectedExit: "kill" | "stop" | null = null;
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
    failure ??= error;
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
  child.on("exit", (code, signal) => {
    lines.close();
    if (expectedExit === null || (expectedExit === "stop" && (code !== 0 || signal !== null)))
      fail(new Error(`Unexpected ${role} exit: code=${code}, signal=${signal}; ${redactText(stderr)}`));
    else if (pending.size) fail(new Error(`${role} exited before acknowledgement`));
  });
  const receive = (id: string): Promise<Packet> => {
    if (failure) return Promise.reject(failure);
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
    if (failure) return Promise.reject(failure);
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
      if (child.exitCode === null && child.signalCode === null) {
        expectedExit = "kill";
        child.kill("SIGKILL");
      }
      await bounded(exited);
      if (failure) throw failure;
    },
    async close() {
      try {
        if (failure) throw failure;
        assert.equal(child.exitCode, null, "Child exited before stop acknowledgement");
        assert.equal(child.signalCode, null, "Child signalled before stop acknowledgement");
        expectedExit = "stop";
        assert.equal((await send("stop")).type, "stopped");
        child.stdin.end();
        await bounded(exited);
        if (failure) throw failure;
        assert.equal(child.exitCode, 0);
        assert.equal(child.signalCode, null);
      } finally {
        child.stdin.end();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await bounded(exited);
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
    const readRemainingEvents = () =>
      host.database.connection
        .prepare(
          "SELECT count(*) AS count FROM orchestration_events WHERE command_id = ? AND aggregate_type = 's0-diagnostic'",
        )
        .get(commandId);
    const remaining = readRemainingEvents();
    assert.equal(host.channels.store.exists(host.channelId), false);
    assert.equal(remaining?.count, 1);
    assert.equal(host.database.commandResult(commandId), undefined);
    host.database.close();
    await runCauseEffect(host.database.initialize());
    const remainingAfterReopen = readRemainingEvents();
    assert.equal(remainingAfterReopen?.count, 1);
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
          remainingAfterReopen,
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
        worker = await childProcess(
          "worker",
          runId,
          state,
          boundary === "running" && process.argv.includes("--fault-worker-exit"),
        );
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
        if (worker) {
          const alive = await worker.send("start", "inspect");
          assert.equal(alive.type, "effect-admitted");
          assert.equal(alive.starts, 1);
        }
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
      try {
        await first.kill();
      } finally {
        await worker?.close();
      }
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

function sourceRow(
  id: string,
  caseId: string,
  guarantee: EvidenceRow["guarantee"],
  source: string[],
  observed: string,
  limitation: string,
): EvidenceRow {
  return {
    id,
    caseId,
    provider: "none",
    mode: "source-only",
    entryPoint: source[0] ?? "unknown",
    subject: "host",
    guarantee,
    support: "unverified",
    basis: "source",
    source,
    artifacts: [],
    observed,
    limitation,
  };
}

async function runAccessProbes(runDirectory: string): Promise<EvidenceRow[]> {
  const { TeamStore } = await import("../src/main/team-store");
  const { routeChannels } = await import("../src/main/team-api/route-channels");
  const host = await openHost(join(runDirectory, "access"));
  const team = new TeamStore(join(runDirectory, "access/team.json"));
  await runCauseEffect(team.initialize());
  await runCauseEffect(team.configure("S0 host", "s0-owner", "synthetic-password-123"));
  const addReader = async (name: string) => {
    const invite = await runCauseEffect(team.createInvite("member"));
    const result = await runCauseEffect(team.acceptInvite(invite.token, name, "synthetic-password-123"));
    registerSecretValue(result.sessionToken);
    return result;
  };
  const unavailable = () => {
    throw new Error("Unselected settings operation");
  };
  const settings: ChannelSettingsAgents = {
    listChannelMemories: (id) => host.channels.listMemories(id),
    createChannelMemory: unavailable,
    updateChannelMemory: unavailable,
    deleteChannelMemory: unavailable,
    clearChannelMemories: unavailable,
    listChannelRoutines: unavailable,
    createChannelRoutine: unavailable,
    updateChannelRoutine: unavailable,
    deleteChannelRoutine: unavailable,
    testChannelRoutine: unavailable,
    listChannelRoutineRuns: unavailable,
  };
  // This loopback fixture exercises the production route and authentication store separately.
  // It does not certify TeamApiServer's transport, event filtering or IPC sender validation.
  const server = createServer((request, response) => {
    void (async () => {
      const token = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
      const session = team.authenticateSession(token);
      if (!session) {
        response.writeHead(401);
        response.end();
        return;
      }
      const context: TeamApiRequestContext = {
        request,
        response,
        method: request.method ?? "GET",
        url: new URL(request.url ?? "/", "http://127.0.0.1"),
        protocol: 9,
        capabilities: new Set([CHANNEL_CHATS_CAPABILITY]),
        ...session,
        token,
        agentLevel: () => "none",
        json: (status, value) => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(value));
          return "handled";
        },
        empty: (status) => {
          response.writeHead(status);
          response.end();
          return "handled";
        },
      };
      if ((await routeChannels(context, host.channels, settings)) === "unmatched") {
        response.writeHead(404);
        response.end();
      }
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  const rows: EvidenceRow[] = [];
  try {
    const marker = `s0-content-${randomUUID()}`;
    await host.seed();
    const resultId = randomUUID();
    host.channels.store.update(host.channels.store.get(host.channelId), {
      messages: [
        {
          id: resultId,
          channelId: host.channelId,
          sequence: 0,
          author: { kind: "agent", id: host.agent.id, name: "S0 agent" },
          taskId: "s0-task",
          superseded: false,
          message: {
            id: resultId,
            text: marker,
            author: "system",
            createdAt: new Date().toISOString(),
            status: "completed",
          },
        },
      ],
    });
    host.channels.createMemory({ channelId: host.channelId, text: marker });
    host.channels.store.saveSummary(host.channelId, { version: 1, throughSequence: 1, text: marker });
    server.listen(0, "127.0.0.1");
    await bounded(once(server, "listening"));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const read = async (token: string, path: string) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ channelId: host.channelId }),
        signal: AbortSignal.timeout(DEADLINE_MS),
      });
      const text = await response.text();
      return { status: response.status, markerDisclosed: text.includes(marker) };
    };
    const first = await addReader("s0-first");
    const initial = {
      channelAndResult: await read(first.sessionToken, CHANNEL_ROUTES.read),
      memory: await read(first.sessionToken, CHANNEL_ROUTES.memories),
    };
    const second = await addReader("s0-second");
    const added = {
      channelAndResult: await read(second.sessionToken, CHANNEL_ROUTES.read),
      memory: await read(second.sessionToken, CHANNEL_ROUTES.memories),
    };
    for (const phase of [initial, added])
      for (const outcome of Object.values(phase)) assert.deepEqual(outcome, { status: 200, markerDisclosed: true });
    await runCauseEffect(team.removeMember(first.member.id));
    const revoked = {
      channelAndResult: await read(first.sessionToken, CHANNEL_ROUTES.read),
      memory: await read(first.sessionToken, CHANNEL_ROUTES.memories),
    };
    for (const outcome of Object.values(revoked)) assert.deepEqual(outcome, { status: 401, markerDisclosed: false });
    const remainingReader = await read(second.sessionToken, CHANNEL_ROUTES.read);
    assert.equal(remainingReader.markerDisclosed, true);
    rows.push(
      await record(
        runDirectory,
        {
          id: "audience-route",
          caseId: "audience-and-derived-content",
          provider: "none",
          mode: "authenticated-route/agent-level-none",
          entryPoint: "TeamStore.authenticateSession/routeChannels",
          subject: "host",
          guarantee: "audience",
          support: "unsupported",
          basis: "service-fixture",
          source: ["src/main/team-api/route-channels.ts:74", "src/main/team-store.ts:1295"],
          observed:
            "Existing and newly added members read the channel result and memory with agent level none. Revoked membership fails authentication; the remaining member still reads the content.",
          limitation:
            "The HTTP wrapper is diagnostic wiring, not TeamApiServer. No project grant or restricted destination audience exists on these routes.",
        },
        {
          initial,
          added,
          revoked,
          remainingReader,
          summaryStored: host.channels.store.summary(host.channelId).text === marker,
        },
      ),
    );
    const forged = await read(SIGNED_OUT_CHANNEL_MEMBER_ID, CHANNEL_ROUTES.read);
    assert.equal(forged.status, 401);
    rows.push(
      await record(
        runDirectory,
        {
          id: "remote-principal",
          caseId: "local-owner-and-remote-principal",
          provider: "none",
          mode: "authentication-store/route-fixture",
          entryPoint: "TeamStore.authenticateSession",
          subject: "host",
          guarantee: "identity",
          support: "supported",
          basis: "service-fixture",
          source: ["src/main/team-store.ts:1295", "src/main/host-service.ts:1726"],
          observed: "A supplied local identity string is not a valid session token.",
          limitation:
            "This proves token authentication only. The full remote transport and local IPC identity continuity remain unverified.",
        },
        { forged },
      ),
    );
    for (const [path, source, reason] of [
      [
        "summary",
        "src/backend/channel-history.ts",
        "The summary is stored and read locally; no separate remote summary read exists in the selected channel route.",
      ],
      [
        "attachment",
        "src/main/team-api/route-files.ts",
        "Attachment access uses AgentService and streaming transport outside this selected route fixture; project containment is absent in the inspected route.",
      ],
      [
        "event",
        "src/main/team-api-server.ts",
        "WebSocket subscription and revocation need the complete TeamApiServer lifecycle; this fixture does not establish their filtering.",
      ],
      [
        "local-ipc",
        "src/main/host-service.ts:1726",
        "channelActor uses a shared signed-out identifier then account/member identity. A headless route fixture cannot prove persistent profile ownership or account linking.",
      ],
    ] as const)
      rows.push(
        sourceRow(
          `access-${path}`,
          path === "local-ipc" ? "local-owner-and-remote-principal" : "audience-and-derived-content",
          path === "local-ipc" ? "identity" : "audience",
          [source],
          "No runtime authorization claim for this path.",
          reason,
        ),
      );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await host.close();
  }
  return rows;
}

async function runCredentialProbes(runDirectory: string): Promise<EvidenceRow[]> {
  const { GitHubConnectorStore } = await import("../src/main/github-connector-store");
  const { GitHubConnectorService } = await import("../src/main/github-connector-service");
  const rows: EvidenceRow[] = [];
  const userToken = `s0-user-${randomUUID()}`;
  const repositoryToken = `s0-repository-${randomUUID()}`;
  registerSecretValue(userToken);
  registerSecretValue(repositoryToken);
  const cipher = { encrypt: (value: string) => Buffer.from(value), decrypt: (value: Buffer) => value.toString() };
  const directory = join(runDirectory, "synthetic-credentials");
  const makeStore = async (path: string) => {
    const store = new GitHubConnectorStore(path, cipher);
    await runCauseEffect(
      store.write({
        accessToken: userToken,
        accessTokenExpiresAt: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
        login: "s0-user",
        userId: 1,
        avatarUrl: null,
      }),
    );
    return store;
  };
  const answer = (present: boolean) =>
    Response.json({
      installations: present
        ? [
            {
              installationId: 1,
              account: "s0",
              token: repositoryToken,
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              repositories: ["s0/repository"],
            },
          ]
        : [],
    });
  try {
    for (const present of [true, false]) {
      const toolDirectory = join(directory, present ? "present" : "absent");
      const store = await makeStore(join(toolDirectory, "store.json"));
      let requests = 0;
      const connector = new GitHubConnectorService({
        store,
        toolDirectory,
        app: { clientId: "s0", slug: "s0" },
        apiUrl: "http://127.0.0.1:1",
        openExternal: async () => {
          throw new Error("No browser in S0");
        },
        fetch: async (url) => {
          assert.equal(url, "http://127.0.0.1:1/v1/github/installation-tokens");
          requests++;
          return answer(present);
        },
      });
      try {
        await runCauseEffect(connector.load());
        const tokens = await runCauseEffect(connector.repositoryTokens("s0/repository"));
        assert.ok(tokens);
        assert.equal(tokens.bot === repositoryToken, present);
        const mcp = connector.mcpServer();
        assert.ok(mcp);
        assert.equal(new URL(mcp.url).hostname, "127.0.0.1");
        const authorization = await runCauseEffect(connector.mcpAuthorization());
        assert.ok(authorization && authorization !== userToken);
        const environment = connector.agentEnvironment({});
        const credential = execFileSync("git", ["credential", "fill"], {
          cwd: ROOT,
          env: {
            PATH: process.env.PATH,
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_TERMINAL_PROMPT: "0",
            ...environment,
          },
          input: "protocol=https\nhost=github.com\npath=s0/repository.git\n\n",
          encoding: "utf8",
          timeout: DEADLINE_MS,
        });
        assert.ok(credential.includes(`password=${present ? repositoryToken : userToken}`));
        const gh = await readFile(join(environment.GH_CONFIG_DIR ?? "", "hosts.yml"), "utf8");
        assert.ok(gh.includes(userToken));
        const mode = `proxy-available/repository-token-${present ? "present" : "absent"}`;
        rows.push(
          await record(
            runDirectory,
            {
              id: `credentials-${present ? "present" : "absent"}`,
              caseId: "credential-fallback",
              provider: "github-connector",
              mode,
              entryPoint: "GitHubConnectorService/real Git credential helper",
              subject: "host",
              guarantee: "credential-selection",
              support: "unsupported",
              basis: "service-fixture",
              source: ["src/main/github-connector-service.ts:458", "src/main/github-connector-service.ts:497"],
              observed: `MCP selects a loopback secret; Git selects the ${present ? "repository" : "user"} token; gh configuration contains the user token.`,
              limitation:
                "No project-specific fail-closed policy. gh file selection is inspected, not a gh subprocess. The proxy upstream is hard-coded and is never contacted.",
            },
            {
              requests,
              mcp: "loopback-secret",
              git: present ? "repository-token" : "user-token",
              gh: "user-token-file",
              upstreamRequests: 0,
            },
          ),
        );
        const unavailable = sourceRow(
          `credentials-no-proxy-${present ? "present" : "absent"}`,
          "credential-fallback",
          "credential-selection",
          ["src/main/github-connector-service.ts:458", "src/main/github-connector-service.ts:953"],
          "Source falls back to the user token and public GitHub MCP URL when the local proxy does not start.",
          "No public failure injection for proxy startup. The proxy retries a busy port; S0 does not alter production adapters or contact the hard-coded upstream.",
        );
        unavailable.mode = `proxy-unavailable/repository-token-${present ? "present" : "absent"}`;
        rows.push(unavailable);
        await runCauseEffect(connector.disconnect(false));
        assert.equal(await runCauseEffect(connector.mcpAuthorization()), null);
        assert.equal(await runCauseEffect(connector.repositoryTokens("s0/repository")), null);
        assert.deepEqual(connector.agentEnvironment({}), {});
        const disconnected = await fetch(mcp.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${authorization}` },
          body: "{}",
          signal: AbortSignal.timeout(DEADLINE_MS),
        });
        assert.equal(disconnected.status, 503);
      } finally {
        await runCauseEffect(connector.dispose());
      }
    }
    const admitted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const store = await makeStore(join(directory, "revocation/store.json"));
    const connector = new GitHubConnectorService({
      store,
      toolDirectory: join(directory, "revocation"),
      app: { clientId: "s0", slug: "s0" },
      apiUrl: "http://127.0.0.1:1",
      openExternal: async () => {
        throw new Error("No browser in S0");
      },
      fetch: async (url) => {
        assert.equal(url, "http://127.0.0.1:1/v1/github/installation-tokens");
        admitted.resolve();
        await bounded(release.promise);
        return answer(true);
      },
    });
    try {
      const inFlight = runCauseEffect(connector.repositoryTokens("s0/repository"));
      await bounded(admitted.promise);
      await runCauseEffect(connector.disconnect(false));
      assert.equal(await runCauseEffect(connector.repositoryTokens("s0/repository")), null);
      release.resolve();
      const old = await bounded(inFlight);
      assert.equal(old?.user, userToken);
      assert.equal(old?.bot, null);
      assert.equal(await runCauseEffect(connector.repositoryTokens("s0/repository")), null);
      rows.push(
        await record(
          runDirectory,
          {
            id: "credential-revocation",
            caseId: "credential-revocation",
            provider: "github-connector",
            mode: "injected-fetch/admission-barrier",
            entryPoint: "GitHubConnectorService.repositoryTokens/disconnect",
            subject: "host",
            guarantee: "credential-selection",
            support: "supported",
            basis: "service-fixture",
            source: ["src/main/github-connector-service.ts:302", "src/main/github-bot-tokens.ts:113"],
            observed:
              "New credential requests return null after disconnect; an admitted request returns its previously captured user token and no newly renewed repository token. Loaded proxy rejects new calls with 503.",
            limitation:
              "This is local credential selection, not remote GitHub token revocation or cancellation of an admitted external effect.",
          },
          {
            newRequests: "no-token",
            admittedRequest: "previous-user-token",
            renewalOutcome: "discarded",
            proxyAfterDisconnect: 503,
          },
        ),
      );
    } finally {
      release.resolve();
      await runCauseEffect(connector.dispose());
    }
    for (const row of rows)
      for (const artifact of row.artifacts) {
        const data = await readFile(join(runDirectory, artifact), "utf8");
        assert.ok(!data.includes(userToken) && !data.includes(repositoryToken), "Raw synthetic token in artifact");
      }
  } finally {
    await rm(directory, { recursive: true, force: true });
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
      faultInjection: process.argv.includes("--fault-worker-exit") ? "worker-exit-after-start" : "none",
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
      const run = { lifecycle: runLifecycleProbes, access: runAccessProbes, credentials: runCredentialProbes }[group];
      report.rows.push(...(await run(runDirectory)));
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
