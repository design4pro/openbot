// A separate sandboxed Electron process runs the production client transport on the isolated display.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { app } from "electron";
import { z } from "zod";
import { TeamWebRtcBridge } from "../../src/main/team-webrtc-bridge";
import { TeamWebRtcClientTransport } from "../../src/main/team-webrtc-client-transport";
import { type PeerOutput, peerCommandSchema } from "./remote-peer-protocol";

const profile = process.argv.find((value) => value.startsWith("--profile="))?.slice(10);
if (!profile) throw new Error("Name the disposable peer profile.");
app.setName("OpenBot planning peer");
app.setPath("userData", profile);
app.enableSandbox();
app.on("window-all-closed", () => {});
let bridge: TeamWebRtcBridge | null = null;
let client: TeamWebRtcClientTransport | null = null;
let hostId: string | null = null;
let activeSessionId: string | null = null;
function send(value: PeerOutput): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
const unused = () => Effect.die(new Error("Unexpected account operation in the isolated peer proof."));
async function command(line: string): Promise<void> {
  const request = peerCommandSchema.parse(JSON.parse(line));
  try {
    if (request.operation === "start") {
      const input = request.input;
      if (!input || client) throw new Error("Invalid isolated peer startup.");
      if (input.profile !== app.getPath("userData")) throw new Error("The peer profile does not match.");
      await app.whenReady();
      bridge = new TeamWebRtcBridge({ developmentUrl: input.rendererUrl, preloadPath: input.preloadPath });
      hostId = input.hostId;
      const expiresAt = Date.now() + 600_000;
      client = new TeamWebRtcClientTransport({
        bridge,
        listHosts: unused,
        startSession: () =>
          Effect.sync(() => {
            activeSessionId = randomUUID();
            return { sessionId: activeSessionId, hostId: input.hostId, expiresAt };
          }),
        issueTicket: (sessionId, clientPublicKey) => {
          const claims = {
            hostId: input.hostId,
            userId: input.userId,
            membershipId: input.membershipId,
            role: input.role,
            authEpoch: 1,
            sessionId,
            clientPublicKey,
            sessionExpiresAt: Math.floor(expiresAt / 1000),
          };
          return Effect.succeed({
            ticket: `planning.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`,
            expiresAt,
            signalUrl: input.signalUrl,
          });
        },
        endSession: () => Effect.void,
        createInvite: unused,
        listInvites: unused,
        previewInvite: unused,
        acceptInvite: unused,
        revokeInvite: unused,
        listMembers: unused,
        updateMember: unused,
        removeMember: unused,
        removeOwnedHost: unused,
        downloadHostLogo: unused,
        getPrincipalId: () => input.userId,
        controlPlaneUrl: "http://127.0.0.1",
        transferDirectory: join(input.profile, "transfers"),
      });
      client.pinHostKey(input.hostId, input.publicKey);
      client.on("event", (_host, event) => send({ type: "event", event }));
      client.on("disconnected", () => send({ type: "disconnected" }));
      await Effect.runPromise(client.connect(input.hostId));
      send({ type: "reply", id: request.id, ok: true, sandboxForced: true, sessionId: activeSessionId });
    } else if (request.operation === "request") {
      if (!client || !hostId || !request.path) throw new Error("The isolated peer is not ready.");
      const response = await Effect.runPromise(
        client.requestResponse(hostId, request.path, { timeoutMs: 15000, method: request.method, body: request.body }),
      );
      send({ type: "reply", id: request.id, ok: true, response });
    } else if (request.operation === "reconnect") {
      if (!client || !hostId) throw new Error("The isolated peer is not ready.");
      await Effect.runPromise(client.disconnect(hostId));
      await Effect.runPromise(client.connect(hostId));
      send({ type: "reply", id: request.id, ok: true, sessionId: activeSessionId });
    } else {
      if (client) await Effect.runPromise(client.stop());
      if (bridge) await Effect.runPromise(bridge.stop());
      send({ type: "reply", id: request.id, ok: true });
      app.exit(0);
    }
  } catch (cause) {
    const failure = z.object({ cause: z.object({ status: z.number(), code: z.string().optional() }) }).safeParse(cause);
    send({
      ...(failure.success ? { failureStatus: failure.data.cause.status, failureCode: failure.data.cause.code } : {}),
      type: "reply",
      id: request.id,
      ok: false,
      failure:
        request.operation === "start" && cause instanceof Error ? redactText(cause.message) : "PeerOperationFailed",
    });
  }
}
const lines = createInterface({ input: process.stdin });
let pending = Promise.resolve();
lines.on("line", (line) => {
  pending = pending
    .then(() => command(line))
    .catch(() => {
      send({ type: "fatal" });
      app.exit(1);
    });
});
