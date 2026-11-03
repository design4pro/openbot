import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import type { PlanningSession } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { TEAM_PROTOCOL_V1_WEBSOCKET } from "@openbot/contracts/team-protocol";
import { AGENT_NOTIFICATION_LEVELS_ROUTES } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { INSTANCE_TRANSFER_ROUTES } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { unzipSync } from "fflate";
import type { Browser, Page } from "playwright-core";
import WebSocket from "ws";
import { z } from "zod";
import type { InspectorClient } from "../dev-automation/inspector-client";
import { loopbackConnection, planningValue, privateSession, protocolHeaders } from "./app-fixture";
import { webRtcPlanningCases } from "./remote-webrtc";

function assertNoCanary(text: string, canaries: string[]): void {
  assert.equal(
    canaries.some((canary) => text.includes(canary)),
    false,
    "Private planning content reached a shared projection.",
  );
}
async function seedPlanning(page: Page, session: PlanningSession, canaries: string[]) {
  return page.evaluate(
    async ({ session, canaries }) => {
      const ref = { generation: session.generation };
      const run = async (action: import("@openbot/contracts/ipc").PlanningAction) => {
        const reply = await window.openbot.localPlanning.run({
          session: ref,
          input: { operationId: crypto.randomUUID(), action },
        });
        if (!reply.ok) throw new Error(`Planning fixture failed: ${reply.error.code}`);
        return reply.value;
      };
      const project = await run({ kind: "create_project", title: "Remote privacy evidence", goal: canaries[0] ?? "" });
      const milestone = await run({
        kind: "create_milestone",
        projectId: project.objectId,
        expectedRevision: project.revision,
        title: "Private milestone",
        criteria: canaries[1] ?? "",
      });
      const ticket = await run({
        kind: "create_ticket",
        projectId: project.objectId,
        expectedRevision: milestone.revision,
        milestoneId: milestone.objectId,
        title: "Private ticket",
        criteria: canaries[1] ?? "",
        notes: canaries[2] ?? "",
        status: "done",
      });
      const review = await run({
        kind: "submit_review",
        projectId: project.objectId,
        expectedRevision: ticket.revision,
        milestoneId: milestone.objectId,
        evidenceNote: canaries[4] ?? "",
      });
      const draft = await run({
        kind: "save_draft",
        draftId: null,
        expectedDraftRevision: null,
        target: { kind: "project", id: null, formId: crypto.randomUUID() },
        form: { title: "Private draft", goal: canaries[3] ?? "" },
      });
      return {
        projectId: project.objectId,
        milestoneId: milestone.objectId,
        ticketId: ticket.objectId,
        reviewId: review.objectId,
        draftId: draft.objectId,
      };
    },
    { session, canaries },
  );
}
async function eventStream(base: string, token: string) {
  const socket = new WebSocket(`${base.replace(/^http/u, "ws")}${TEAM_API_ROUTES.events}`, [
    TEAM_PROTOCOL_V1_WEBSOCKET,
    `openbot-token.${token}`,
  ]);
  const observed: string[] = [];
  const waiters: { text: string; resolve: () => void }[] = [];
  const closed = new Promise<number>((resolve) => socket.once("close", resolve));
  socket.on("message", (data) => {
    const text = data.toString();
    observed.push(text);
    for (const waiter of waiters) if (text.includes(waiter.text)) waiter.resolve();
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    socket,
    observed,
    closed,
    barrier(text: string) {
      return observed.some((value) => value.includes(text))
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiters.push({ text, resolve }));
    },
  };
}

/** Real app HTTP and event consumers; account issuance uses disposable synthetic identities. */
export async function remotePlanningCases(
  main: InspectorClient,
  browser: Browser,
  page: Page,
  record: (id: string) => void,
): Promise<void> {
  const connection = await loopbackConnection(main, page);
  const session = await privateSession(page);
  record("remote-private-admission");
  const fixture = z
    .object({
      agentId: z.string(),
      roles: z.array(z.object({ role: z.string(), token: z.string(), sessionId: z.string(), username: z.string() })),
    })
    .parse(
      await main.evaluate(
        `(async()=>{const E=require("effect").Effect;const uuid=require("node:crypto").randomUUID;const f=__planningFixture;const s=f.services;const a=await E.runPromise(s.service.createAgentProfile({name:"Remote evidence agent",description:"Disposable remote consumer",avatarSeed:"planning-remote",avatarHue:null}));const roles=[];f.remoteCreatedMembers=[];f.restoreRemoteEvidence=async()=>{for(const id of f.remoteCreatedMembers)await E.runPromise(s.teamStore.removeMember(id));for(const role of roles)if(!role.username)s.teamStore.closeRemoteSession(role.sessionId);f.restoreRemoteEvidence=null;};for(const role of ["member"]){const username="planning-"+uuid().slice(0,8);const invite=await E.runPromise(s.teamStore.createInvite(role));const auth=await E.runPromise(s.teamStore.acceptInvite(invite.token,username,"planning-local-proof-password"));f.remoteCreatedMembers.push(auth.member.id);roles.push({role,token:auth.sessionToken,sessionId:s.teamStore.authenticateSession(auth.sessionToken).sessionId,username});}const adminId=uuid();const admin=s.teamStore.openRemoteSession({sessionId:adminId,membershipId:uuid(),userId:uuid(),role:"admin"});roles.push({role:"admin",token:admin.sessionToken,sessionId:adminId,username:""});const owner=s.teamStore.listMembers().find(m=>m.role==="owner");const sessionId=uuid();const auth=s.teamStore.openRemoteSession({sessionId,membershipId:owner.id,userId:s.centralAuth.getSignedInUser().id,role:"owner"});roles.push({role:"owner",token:auth.sessionToken,sessionId,username:""});f.remoteFixture={agentId:a.id,roles};return f.remoteFixture;})()`,
      ),
    );
  const roles = [
    { role: "existing-member", token: connection.sessionToken, sessionId: "", username: "" },
    ...fixture.roles,
  ];
  const streams: Awaited<ReturnType<typeof eventStream>>[] = [];
  const canaries = Array.from({ length: 5 }, (_, index) => `private-${index}-${randomUUID()}`);
  const call = async (
    token: string,
    protocol: number,
    path: string,
    body?: TeamProtocolV2Json,
    method = body ? "POST" : "GET",
  ) => {
    const response = await fetch(`${connection.apiUrl}${path}`, {
      method,
      headers: { ...protocolHeaders(token, protocol), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertNoCanary(Buffer.from(bytes).toString("utf8"), canaries);
    assert.ok(response.status < 500, "The projection must answer through its real route, not a server fault.");
    return { status: response.status, bytes, text: Buffer.from(bytes).toString("utf8") };
  };
  try {
    for (const role of roles) streams.push(await eventStream(connection.apiUrl, role.token));
    const privateIds = await seedPlanning(page, session, canaries);
    const barrier = `Remote barrier ${randomUUID()}`;
    const pending = streams.map((stream) => stream.barrier(barrier));
    await main.evaluate(
      `require("effect").Effect.runPromise(__planningFixture.services.service.updateAgent({agentId:${JSON.stringify(fixture.agentId)},name:${JSON.stringify(barrier)}}))`,
    );
    await Promise.all(pending);
    for (const stream of streams)
      for (const event of stream.observed) {
        assertNoCanary(event, canaries);
        assert.equal(
          Object.values(privateIds).some((id) => event.includes(id)),
          false,
        );
      }
    record("remote-websocket-event-absence");
    for (const role of roles) {
      for (let protocol = 1; protocol <= 9; protocol++) {
        assert.equal((await call(role.token, protocol, TEAM_API_ROUTES.agents.all)).status, 200);
        for (const path of [
          TEAM_API_ROUTES.agent.conversation(fixture.agentId),
          TEAM_API_ROUTES.agent.memories(fixture.agentId),
          `${TEAM_API_ROUTES.messages.search}?q=private&botId=${encodeURIComponent(fixture.agentId)}`,
        ])
          assert.equal((await call(role.token, protocol, path)).status, 200);
        for (const id of [privateIds.projectId, randomUUID()])
          assert.equal((await call(role.token, protocol, `/v1/projects/${id}`)).status, 404);
      }
      const usage = await call(role.token, 9, STORAGE_ROUTES.usage, { scope: "host" });
      assert.equal(usage.status, 200);
      assert.equal(
        Object.values(privateIds).some((id) => usage.text.includes(id)),
        false,
      );
      const summary = await call(role.token, 9, INSTANCE_TRANSFER_ROUTES.summary, {});
      assert.equal(summary.status, role.role.includes("member") ? 403 : 200);
      if (!role.role.includes("member")) {
        const archive = await call(role.token, 9, INSTANCE_TRANSFER_ROUTES.export, {
          agentIds: [fixture.agentId],
          includeFiles: true,
          includeSettings: false,
        });
        assert.equal(archive.status, 200);
        for (const bytes of Object.values(unzipSync(archive.bytes)))
          assertNoCanary(Buffer.from(bytes).toString("utf8"), canaries);
      }
    }
    record("remote-released-http-adapters");
    record("remote-derived-content-canaries");
    record("remote-guessed-route-absence");
    record("remote-storage-and-transfer-absence");
    for (const level of ["nothing", null]) {
      const result = await call(connection.sessionToken, 9, AGENT_NOTIFICATION_LEVELS_ROUTES.set, {
        agentId: fixture.agentId,
        level,
      });
      assert.equal(result.status, 200);
      const snapshot = z
        .object({ agents: z.array(z.object({ agentId: z.string(), level: z.string() })) })
        .parse(JSON.parse(result.text));
      assert.equal(snapshot.agents.find((agent) => agent.agentId === fixture.agentId)?.level ?? null, level);
    }
    record("remote-mute-unmute-control");
    const member = fixture.roles.find((role) => role.role === "member");
    const owner = fixture.roles.find((role) => role.role === "owner");
    assert.ok(member && owner);
    assert.ok(streams[1]);
    const native = z
      .object({ status: z.string(), message: z.string().nullable() })
      .parse(await main.evaluate(`require("effect").Effect.runPromise(__planningFixture.services.cuaDriver.state())`));
    assert.equal(native.status, "error");
    assert.equal(native.message, sourceText("error.agent.privatePlanning"));
    const capture = await call(owner.token, 9, TEAM_API_ROUTES.remoteScreen.sessions, {});
    assert.equal(capture.status, 409);
    assert.equal(
      z.object({ error: z.string() }).parse(JSON.parse(capture.text)).error,
      sourceText("error.remote.controlUnavailable"),
    );
    record("remote-private-capture-refusal");
    assert.equal(
      (await call(owner.token, 9, TEAM_API_ROUTES.team.session(member.sessionId), undefined, "DELETE")).status,
      204,
    );
    assert.equal(await streams[1].closed, 1008);
    assert.equal((await call(member.token, 9, TEAM_API_ROUTES.agents.all)).status, 401);
    const token = z
      .string()
      .parse(
        await main.evaluate(
          `require("effect").Effect.runPromise(__planningFixture.services.teamStore.login(${JSON.stringify(member.username)},"planning-local-proof-password")).then(value=>value.sessionToken)`,
        ),
      );
    const reconnected = await eventStream(connection.apiUrl, token);
    streams.push(reconnected);
    assert.equal((await call(token, 9, TEAM_API_ROUTES.agents.all)).status, 200);
    const reconnectBarrier = `Reconnected barrier ${randomUUID()}`;
    const delivered = reconnected.barrier(reconnectBarrier);
    await main.evaluate(
      `require("effect").Effect.runPromise(__planningFixture.services.service.updateAgent({agentId:${JSON.stringify(fixture.agentId)},name:${JSON.stringify(reconnectBarrier)}}))`,
    );
    await delivered;
    for (const event of reconnected.observed) assertNoCanary(event, canaries);
    record("remote-revoke-reconnect");
    await main.evaluate(
      `(()=>{const f=__planningFixture;const electron=require("electron");const p=require("node:path");f.originalProofSaveDialog=electron.dialog.showSaveDialog;f.proofDiagnostics=p.join(electron.app.getPath("userData"),"planning-diagnostics-${randomUUID()}.json");electron.dialog.showSaveDialog=async()=>({canceled:false,filePath:f.proofDiagnostics});return true;})()`,
    );
    try {
      assert.equal((await page.evaluate(() => window.openbot.maintenance.exportDiagnostics())).saved, true);
      const diagnostics = z
        .string()
        .parse(await main.evaluate(`require("node:fs/promises").readFile(__planningFixture.proofDiagnostics,"utf8")`));
      assertNoCanary(diagnostics, canaries);
      const publicLogControl = `planning-public-log-control-${randomUUID()}`;
      const expectedLog = process.env.OPENBOT_PLANNING_STACK_LOG ?? "/tmp/planning-dev.log";
      await main.evaluate(`console.info(${JSON.stringify(publicLogControl)})`);
      await logControl(expectedLog, publicLogControl);
      const logs = z
        .string()
        .parse(
          await main.evaluate(
            `(async()=>{const fs=require("node:fs/promises");const path=require("node:path");const profile=require("electron").app.getPath("userData");const texts=[];async function scan(root){for(const item of await fs.readdir(root,{withFileTypes:true}).catch(()=>[])){const full=path.join(root,item.name);if(item.isDirectory())await scan(full);else if(item.isFile()&&/.(log|jsonl)$/.test(item.name)){const stat=await fs.stat(full);if(stat.size<=20*1024*1024)texts.push(await fs.readFile(full,"utf8"));}}}await scan(path.join(profile,"logs"));texts.push(await fs.readFile(${JSON.stringify(expectedLog)},"utf8").catch(()=>""));return texts.join("\\n");})()`,
          ),
        );
      assert.ok(logs.includes(publicLogControl), "Inspect this stack log, not an earlier app log.");
      assertNoCanary(logs, canaries);
      record("remote-diagnostics-absence");
    } finally {
      await main.evaluate(
        `(async()=>{const f=__planningFixture;const fs=require("node:fs/promises");require("electron").dialog.showSaveDialog=f.originalProofSaveDialog;await fs.rm(f.proofDiagnostics,{force:true});return true;})()`,
      );
    }
    void browser;
    const currentSession = planningValue(await page.evaluate(() => window.openbot.localPlanning.enter()));
    await webRtcPlanningCases(
      main,
      connection.apiUrl,
      owner.token,
      fixture.agentId,
      canaries,
      async () => {
        await page.evaluate(
          async ({ session, projectId, goal }) => {
            const ref = { generation: session.generation };
            const project = await window.openbot.localPlanning.getProject({ session: ref, input: projectId });
            if (!project.ok) throw new Error("The private project is not readable locally.");
            const changed = await window.openbot.localPlanning.run({
              session: ref,
              input: {
                operationId: crypto.randomUUID(),
                action: {
                  kind: "edit_project",
                  projectId,
                  expectedRevision: project.value.revision,
                  title: project.value.title,
                  goal,
                },
              },
            });
            if (!changed.ok) throw new Error("The private write was refused.");
          },
          { session: currentSession, projectId: privateIds.projectId, goal: `${canaries[0]}-${randomUUID()}` },
        );
      },
      record,
    );
  } finally {
    for (const stream of streams) stream.socket.close();
    await main.evaluate("__planningFixture.restoreRemoteEvidence?.()");
  }
}

async function logControl(path: string, marker: string): Promise<void> {
  const ready = Promise.withResolvers<void>();
  const check = async () => {
    try {
      if ((await readFile(path, "utf8")).includes(marker)) ready.resolve();
    } catch {
      ready.reject(new Error("The owned stack log is not readable."));
    }
  };
  const observer = watch(path, () => {
    void check();
  });
  const deadline = setTimeout(
    () => ready.reject(new Error("The current app did not reach its owned stack log.")),
    10000,
  );
  try {
    await check();
    await ready.promise;
  } finally {
    clearTimeout(deadline);
    observer.close();
  }
}
