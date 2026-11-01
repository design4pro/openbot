// Controlled processes and real host stores for the S0 diagnostic. No live provider is loaded.
import assert from "node:assert/strict";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ChannelTask } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import { AgentStore } from "../../src/backend/agent-store";
import { type ChannelHooks, ChannelService } from "../../src/backend/channel-service";
import type { ChannelAssignment } from "../../src/backend/channel-store";
import { runCauseEffect } from "../../src/backend/effect-boundary";
import { MailboxStore } from "../../src/backend/mailbox-store";
import { OpenBotDatabase } from "../../src/backend/openbot-database";

export async function openHost(
  directory: string,
  hooks: Partial<Pick<ChannelHooks, "interrupt" | "changed" | "busy">> = {},
) {
  const database = new OpenBotDatabase(join(directory, "profile"));
  const agents = new AgentStore(join(directory, "profile"), join(directory, "home"), database);
  await runCauseEffect(agents.initialize());
  let agent = agents.list()[0];
  if (!agent)
    agent = await runCauseEffect(
      agents.createAgent({ name: "S0 agent", description: "Synthetic diagnostic", avatarSeed: "s0", avatarHue: null }),
    );
  const mailbox = new MailboxStore(join(directory, "profile"), agents.sharedRoot, database);
  await runCauseEffect(mailbox.initialize());
  let schedules = 0;
  const errors: string[] = [];
  const channels = new ChannelService(database, mailbox, {
    agents: () => agents.list(),
    generate: () => {
      throw new Error("S0 must not call a model");
    },
    schedule: () => {
      schedules++;
    },
    busy: () => true,
    interrupt: () => Effect.void,
    changed: () => {},
    error: (error) => {
      errors.push(String(error));
    },
    ...hooks,
  });
  const channelId = "s0-channel";
  if (!channels.store.exists(channelId))
    channels.store.update(
      channels.store.create(channelId, {
        name: "S0",
        title: "Diagnostic",
        instructions: "",
        members: [{ agentId: agent.id }],
        leadAgentId: agent.id,
      }),
      {},
    );
  const input = {
    sender: { kind: "user" as const },
    recipientAgentIds: [agent.id],
    text: "S0 synthetic marker",
    channelId,
    idempotencyKey: "s0-delivery",
  };
  return {
    database,
    mailbox,
    channels,
    agent,
    input,
    channelId,
    errors,
    schedules: () => schedules,
    async seed() {
      await runCauseEffect(mailbox.enqueue(input));
      const delivery = mailbox.deliveryForKey(input.idempotencyKey);
      assert.ok(delivery);
      const task: ChannelTask = {
        id: "s0-task",
        channelId,
        parentTaskId: null,
        rootTaskId: "s0-task",
        ownerAgentId: agent.id,
        requestMessageId: delivery.delivery.messageId,
        instruction: input.text,
        attachmentDraftIds: [],
        expectedResult: "S0 result",
        sourceMessageIds: [],
        dependencies: [],
        resources: [],
        state: "queued",
        revision: 1,
        assignmentCount: 1,
        error: null,
      };
      const assignment: ChannelAssignment = {
        id: "s0-assignment",
        channelId,
        taskId: task.id,
        agentId: agent.id,
        taskRevision: 1,
        requestMessageId: task.requestMessageId,
        resources: [],
        deliveryId: delivery.delivery.id,
        turnId: null,
        state: "queued",
        throughSequence: 0,
        summaryVersion: 0,
        awaitedTaskIds: [],
        pendingRevision: null,
        pendingOutcome: null,
      };
      channels.store.update(channels.store.get(channelId), { tasks: [task], assignments: [assignment] });
      return delivery.delivery.id;
    },
    async close() {
      await runCauseEffect(channels.stop());
      database.close();
      assert.deepEqual(errors, []);
    },
  };
}

export const packetSchema = z.object({
  runId: z.string(),
  id: z.string(),
  type: z.enum(["ready", "start", "started", "effect-admitted", "finish", "completed", "stop", "stopped"]),
  action: z.enum(["enqueue", "running", "terminal", "recover"]).optional(),
  deliveryId: z.string().optional(),
  status: z.string().optional(),
  taskState: z.string().optional(),
  starts: z.number().optional(),
  schedules: z.number().optional(),
});
export type Packet = z.infer<typeof packetSchema>;

async function main() {
  const [role, runId, directory] = process.argv.slice(2);
  assert.ok(runId && directory);
  assert.ok(role === "host" || role === "worker");
  const host = role === "host" ? await openHost(directory) : null;
  let starts = 0;
  const emit = (packet: Packet) => {
    // Machine-readable: owned parent and child handshake.
    process.stdout.write(`${JSON.stringify(packet)}\n`);
  };
  emit({ runId, id: "ready", type: "ready" });
  const lines = createInterface({ input: process.stdin });
  try {
    for await (const line of lines) {
      const packet = packetSchema.parse(JSON.parse(line));
      assert.equal(packet.runId, runId);
      if (packet.type === "stop") {
        emit({ runId, id: packet.id, type: "stopped", starts });
        break;
      }
      if (!host) {
        if (packet.type === "start") starts++;
        emit({ runId, id: packet.id, type: packet.type === "finish" ? "completed" : "started", starts });
        continue;
      }
      if (packet.action === "enqueue") await host.seed();
      let delivery = host.mailbox.deliveryForKey(host.input.idempotencyKey);
      assert.ok(delivery);
      if (packet.action === "running") {
        await runCauseEffect(host.mailbox.markStarting(delivery.delivery.id));
        await runCauseEffect(host.mailbox.markRunning(delivery.delivery.id, "s0-turn"));
        await runCauseEffect(host.channels.accepted(delivery.delivery.id, "s0-session", "s0-turn"));
      }
      if (packet.action === "terminal")
        await runCauseEffect(host.mailbox.markTerminal(delivery.delivery.id, "completed"));
      if (packet.action === "recover") await runCauseEffect(host.channels.recover());
      delivery = host.mailbox.deliveryForKey(host.input.idempotencyKey);
      assert.ok(delivery);
      emit({
        runId,
        id: packet.id,
        type: "effect-admitted",
        deliveryId: delivery.delivery.id,
        status: delivery.delivery.status,
        taskState: host.channels.store.tasks(host.channelId)[0]?.state,
        schedules: host.schedules(),
      });
    }
  } finally {
    lines.close();
    await host?.close();
  }
}
if (import.meta.main) await main();
