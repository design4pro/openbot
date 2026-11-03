import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { redactText } from "@openbot/logging";
import { build } from "bun";
import WebSocket, { WebSocketServer } from "ws";
import { z } from "zod";
import type { InspectorClient } from "../dev-automation/inspector-client";
import { protocolHeaders } from "./app-fixture";
import { exposePrivate } from "./electron-cases";
import { type PeerReply, type PeerRequest, peerReplySchema } from "./remote-peer-protocol";

const claimsSchema = z.object({
  hostId: z.string(),
  sessionId: z.string(),
  userId: z.string(),
  membershipId: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  sessionExpiresAt: z.number(),
});
/** A loopback Signal substitute relays real SDP/ICE. It does not certify account ticket issuance. */
export async function webRtcPlanningCases(
  main: InspectorClient,
  apiUrl: string,
  ownerToken: string,
  agentId: string,
  canaries: string[],
  privateWrite: () => Promise<void>,
  record: (id: string) => void,
): Promise<void> {
  const output = resolve(".openbot-build/project-planning", randomUUID(), "webrtc-peer");
  await mkdir(output, { recursive: true, mode: 0o700 });
  const built = await build({
    entrypoints: [resolve("scripts/project-planning/remote-peer.ts")],
    outdir: output,
    naming: "peer.cjs",
    format: "cjs",
    target: "node",
    external: ["electron", "effect"],
  });
  assert.equal(built.success, true, "The focused peer fixture must compile.");
  const server = createServer();
  const signal = new WebSocketServer({ server });
  let host: WebSocket | null = null;
  const connections = new Map<string, WebSocket>();
  const sockets = new Set<WebSocket>();
  signal.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      for (const [id, peer] of connections)
        if (peer === socket) {
          connections.delete(id);
          host?.send(JSON.stringify({ type: "disconnect", version: 1, connectionId: id }));
        }
    });
    socket.on("message", (data) => {
      const message = z
        .object({
          type: z.string(),
          peer: z.string().optional(),
          token: z.string().optional(),
          connectionId: z.string().nullable().optional(),
        })
        .passthrough()
        .parse(JSON.parse(data.toString()));
      if (message.type === "hello" && message.peer === "host") {
        host = socket;
        socket.send(
          JSON.stringify({
            type: "ready",
            version: 1,
            connectionId: null,
            resumeToken: "planning-host-resume",
            iceServers: [],
          }),
        );
      } else if (message.type === "hello" && message.peer === "client") {
        const token = message.token;
        assert.ok(host);
        assert.ok(token);
        assert.ok(token.startsWith("planning."));
        const claims = claimsSchema.parse(JSON.parse(Buffer.from(token.slice(9), "base64url").toString("utf8")));
        const connectionId = randomUUID();
        connections.set(connectionId, socket);
        host.send(
          JSON.stringify({
            type: "peer-ready",
            version: 1,
            connectionId,
            sessionId: claims.sessionId,
            userId: claims.userId,
            membershipId: claims.membershipId,
            role: claims.role,
            sessionExpiresAt: claims.sessionExpiresAt,
            resumed: false,
          }),
        );
        socket.send(
          JSON.stringify({ type: "ready", version: 1, connectionId, resumeToken: message.token, iceServers: [] }),
        );
      } else if (message.connectionId) {
        const target = socket === host ? connections.get(message.connectionId) : host;
        if (target?.readyState === WebSocket.OPEN) target.send(data.toString());
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const signalUrl = `ws://127.0.0.1:${address.port}`;
  await exposePrivate(main, "__planningFixture.services.host", "#webrtcGateway", "hostGateway");
  await exposePrivate(main, "__planningFixture.hostGateway", "#options", "hostGatewayOptions");
  const config = z
    .object({
      hostId: z.string(),
      publicKey: z.string(),
      userId: z.string(),
      membershipId: z.string(),
      executable: z.string(),
      display: z.string(),
      xauthority: z.string(),
      rendererUrl: z.string(),
      preloadPath: z.string(),
    })
    .parse(
      await main.evaluate(
        `(()=>{const f=__planningFixture;const E=require("effect").Effect;const p=require("node:path");const identity=f.services.teamStore.getIdentity();const owner=f.services.teamStore.listMembers().find(m=>m.role==="owner");f.originalVerify=f.hostGatewayOptions.verifyClientTicket;f.hostGatewayOptions.verifyClientTicket=ticket=>E.sync(()=>{if(!ticket.startsWith("planning."))throw new Error("Invalid synthetic ticket");return JSON.parse(Buffer.from(ticket.slice(9),"base64url").toString("utf8"));});return {hostId:identity.serverId,publicKey:identity.publicKey,userId:f.services.centralAuth.getSignedInUser().id,membershipId:owner.id,executable:process.execPath,display:process.env.DISPLAY,xauthority:process.env.XAUTHORITY,rendererUrl:process.env.ELECTRON_RENDERER_URL,preloadPath:p.join(process.cwd(),"out-dev-app/preload/teamWebrtc.cjs")};})()`,
      ),
    );
  const apiPort = Number(new URL(apiUrl).port);
  await main.evaluate(
    `require("effect").Effect.runPromise(__planningFixture.hostGateway.start({hostId:${JSON.stringify(config.hostId)},signalUrl:${JSON.stringify(signalUrl)},ticket:"planning-host",localApiPort:${apiPort}}))`,
  );
  try {
    for (const role of ["member", "admin", "owner"] as const) {
      const profile = join(output, `profile-${role}`);
      await mkdir(profile, { mode: 0o700 });
      const child = spawn(config.executable, [join(output, "peer.cjs"), `--profile=${profile}`], {
        cwd: resolve("."),
        env: { ...process.env, DISPLAY: config.display, XAUTHORITY: config.xauthority },
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
      const exited = once(child, "close");
      void exited.catch(() => undefined);
      const pending = new Map<number, { resolve: (reply: PeerReply) => void; reject: (cause: Error) => void }>();
      const events: string[] = [];
      const eventWaiters: { text: string; resolve: () => void }[] = [];
      let disconnected: (() => void) | null = null;
      let sequence = 0;
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          return;
        }
        if (z.object({ type: z.literal("disconnected") }).safeParse(value).success) {
          disconnected?.();
          return;
        }
        const event = z.object({ type: z.literal("event"), event: z.json() }).safeParse(value);
        if (event.success) {
          const text = JSON.stringify(event.data.event);
          events.push(text);
          for (const waiter of eventWaiters) if (text.includes(waiter.text)) waiter.resolve();
          return;
        }
        const reply = peerReplySchema.safeParse(value);
        if (!reply.success) return;
        pending.get(reply.data.id)?.resolve(reply.data);
        pending.delete(reply.data.id);
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-4096);
      });
      const stopped = () => {
        for (const waiter of pending.values())
          waiter.reject(new Error(`The isolated peer stopped before its reply: ${redactText(stderr)}`));
        pending.clear();
      };
      child.once("close", stopped);
      child.once("error", stopped);
      const send = (input: PeerRequest): Promise<PeerReply> =>
        new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject });
          child.stdin.write(`${JSON.stringify({ id, ...input })}\n`);
        });
      try {
        process.stdout.write(`WebRTC role ${role}: start\n`);
        const ready = await send({ operation: "start", input: { ...config, role, signalUrl, profile } });
        assert.equal(
          ready.ok,
          true,
          `The ${role} peer must authenticate: ${ready.failure ?? "no failure reason"}; ${redactText(stderr)}`,
        );
        assert.equal(ready.sandboxForced, true);
        assert.equal((await send({ operation: "request", path: TEAM_API_ROUTES.agents.all })).response?.status, 200);
        process.stdout.write(`WebRTC role ${role}: authenticated\n`);
        await privateWrite();
        const barrier = `WebRTC barrier ${randomUUID()}`;
        const delivered = events.some((event) => event.includes(barrier))
          ? Promise.resolve()
          : new Promise<void>((resolve) => eventWaiters.push({ text: barrier, resolve }));
        await main.evaluate(
          `require("effect").Effect.runPromise(__planningFixture.services.service.updateAgent({agentId:${JSON.stringify(agentId)},name:${JSON.stringify(barrier)}}))`,
        );
        await delivered;
        for (const path of [TEAM_API_ROUTES.agent.conversation(agentId), TEAM_API_ROUTES.agent.memories(agentId)]) {
          const response = await send({ operation: "request", path });
          assert.equal(response.ok, true);
          assert.equal(response.response?.status, 200);
          const text = JSON.stringify(response.response);
          assert.equal(
            canaries.some((canary) => text.includes(canary)),
            false,
          );
        }
        const guessed = await send({ operation: "request", path: `/v1/projects/${randomUUID()}` });
        assert.ok(!guessed.ok || guessed.response?.status === 404);
        const capture = await send({
          operation: "request",
          path: TEAM_API_ROUTES.remoteScreen.sessions,
          method: "POST",
          body: {},
        });
        assert.equal(capture.ok, false);
        assert.equal(capture.failureStatus, 409);
        assert.equal(capture.failureCode, "session_capacity_reached");
        for (const event of events)
          assert.equal(
            canaries.some((canary) => event.includes(canary)),
            false,
          );
        process.stdout.write(`WebRTC role ${role}: private refusal passed\n`);
        if (role === "member") {
          assert.ok(ready.sessionId);
          const closed = new Promise<void>((resolve) => {
            disconnected = resolve;
          });
          const revoked = await fetch(`${apiUrl}${TEAM_API_ROUTES.team.session(ready.sessionId)}`, {
            method: "DELETE",
            headers: protocolHeaders(ownerToken),
          });
          assert.equal(revoked.status, 204);
          await closed;
          process.stdout.write("WebRTC member: revoked\n");
          const reconnected = await send({ operation: "reconnect" });
          assert.equal(reconnected.ok, true, `Reconnect failed: ${reconnected.failure}`);
          assert.notEqual(reconnected.sessionId, ready.sessionId);
          const after = await send({ operation: "request", path: TEAM_API_ROUTES.agents.all });
          assert.equal(after.response?.status, 200);
          assert.equal(
            canaries.some((canary) => JSON.stringify(after.response).includes(canary)),
            false,
          );
          record("remote-webrtc-revoke-reconnect");
        }
        assert.equal((await send({ operation: "stop" })).ok, true);
        assert.equal((await exited)[0], 0);
      } finally {
        if (child.exitCode === null && child.signalCode === null && child.pid) process.kill(-child.pid, "SIGKILL");
        await exited.catch(() => undefined);
        lines.close();
        await rm(profile, { recursive: true, force: true });
      }
    }
    record("remote-webrtc-event-and-rpc-absence");
  } finally {
    await main
      .evaluate(
        `(async()=>{const E=require("effect").Effect;const f=__planningFixture;await E.runPromise(f.hostGateway.stop());f.hostGatewayOptions.verifyClientTicket=f.originalVerify;return true;})()`,
      )
      .catch(() => undefined);
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => signal.close(() => server.close(() => resolve())));
  }
}
