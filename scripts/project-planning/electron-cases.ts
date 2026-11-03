import assert from "node:assert/strict";
import type { PlanningReply, PlanningSession } from "@openbot/contracts/ipc";
import type { Browser, Page } from "playwright-core";
import { z } from "zod";
import type { InspectorClient } from "../dev-automation/inspector-client";

function unwrap<T>(reply: PlanningReply<T>): T {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply.value;
}
const objectReference = z.object({ result: z.object({ objectId: z.string() }) });
const properties = z.object({
  privateProperties: z.array(
    z.object({ name: z.string(), value: z.object({ objectId: z.string().optional() }).optional() }),
  ),
});
export async function exposePrivate(
  main: InspectorClient,
  expression: string,
  field: string,
  slot:
    | "options"
    | "remoteStore"
    | "remoteCipher"
    | "pendingExit"
    | "browserUploads"
    | "hostOptions"
    | "hostGateway"
    | "hostGatewayOptions"
    | "clientTransport"
    | "clientOptions"
    | "apiServer"
    | "receivingServer",
): Promise<void> {
  const object = objectReference.parse(await main.send("Runtime.evaluate", { expression })).result.objectId;
  const property = properties
    .parse(await main.send("Runtime.getProperties", { objectId: object, ownProperties: true }))
    .privateProperties.find((value) => value.name === field);
  assert.ok(property?.value?.objectId, `Missing fixture reference ${field}.`);
  await main.send("Runtime.callFunctionOn", {
    objectId: property.value.objectId,
    functionDeclaration: `function(){globalThis.__planningFixture.${slot}=this;}`,
  });
}
export async function installSyntheticRemoteCipher(main: InspectorClient): Promise<void> {
  await exposePrivate(main, "__planningFixture.services.remoteServers", "#store", "remoteStore");
  await exposePrivate(main, "__planningFixture.remoteStore", "#cipher", "remoteCipher");
  // Synthetic session tokens only. The fixture makes no claim about a system keyring.
  await main.evaluate(
    "Object.assign(__planningFixture.remoteCipher,{encrypt:value=>Buffer.from(value),decrypt:value=>value.toString()}) && true",
  );
}
async function enter(page: Page): Promise<PlanningSession> {
  return unwrap(await page.evaluate(() => window.openbot.localPlanning.enter()));
}
async function draft(page: Page, session: PlanningSession, title: string) {
  return unwrap(
    await page.evaluate(
      ({ session, title }) =>
        window.openbot.localPlanning.run({
          session: { generation: session.generation },
          input: {
            operationId: crypto.randomUUID(),
            action: {
              kind: "save_draft",
              draftId: null,
              expectedDraftRevision: null,
              target: { kind: "project", id: null },
              form: { title, goal: "" },
            },
          },
        }),
      { session, title },
    ),
  );
}
export async function signIn(main: InspectorClient, page: Page, email: string): Promise<void> {
  const challenge = await page.evaluate((email) => window.openbot.auth.requestEmailCode(email), email);
  assert.equal(challenge.status, "code_sent");
  if (challenge.status !== "code_sent") throw new Error("Synthetic account challenge failed.");
  const signed = await page.evaluate(
    (challengeId) => window.openbot.auth.verifyEmailCode({ challengeId, code: "123456" }),
    challenge.challengeId,
  );
  assert.equal(signed.status, "signed_in");
  await main.evaluate("__planningFixture.waitAccount()");
}
async function installDelay(main: InspectorClient): Promise<void> {
  await main.evaluate(`(()=>{
 const fixture=__planningFixture;const domain=fixture.options.domain;const E=require("effect").Effect;
 fixture.originalRead=domain.getProject;
 fixture.readStarted=new Promise(resolve=>fixture.readStartedResolve=resolve);
 fixture.readRelease=new Promise(resolve=>fixture.readReleaseResolve=resolve);
 domain.getProject=(context,id)=>E.gen(function*(){const value=yield* fixture.originalRead.call(domain,context,id);fixture.readStartedResolve();yield* E.promise(()=>fixture.readRelease);return value;});return true;
 })()`);
}
async function releaseDelay(main: InspectorClient): Promise<void> {
  await main.evaluate(
    "(()=>{__planningFixture.options.domain.getProject=__planningFixture.originalRead;__planningFixture.readReleaseResolve();return true;})()",
  );
}

/** Uses the production service graph, IPC, preload, window controller, account manager and loopback Team API. */
export async function electronPlanningCases(
  main: InspectorClient,
  browser: Browser,
  firstPage: Page,
  initial: PlanningSession,
  projectId: string,
  reportCase: (id: string) => void,
): Promise<void> {
  const first = firstPage;
  const context = browser.contexts()[0];
  assert.ok(context);
  let unexpectedCrashes = 0;
  let intentionalCrash = false;
  const observe = (page: Page) =>
    page.on("crash", () => {
      if (!intentionalCrash) unexpectedCrashes++;
    });
  for (const page of context.pages()) observe(page);
  context.on("page", observe);
  const recordCase = (id: string) => {
    assert.equal(unexpectedCrashes, 0, "An unexpected renderer crash invalidates this proof.");
    reportCase(id);
  };

  await exposePrivate(main, "__planningFixture.services.localPlanning", "#options", "options");
  await main.evaluate(`(()=>{
    const f=__planningFixture;const fs=require("node:fs/promises");const node=require("node:module");const E=require("effect").Effect;
    const read=fs.readFile;const supported=f.options.supported;const local=f.options.isLocal;f.supportDiagnostics={support:[],io:[],local:[]};
    fs.readFile=async(...args)=>{try{return await read(...args);}catch(cause){if(typeof args[0]==="string" && args[0].startsWith("/proc/"))f.supportDiagnostics.io.push({path:args[0],code:typeof cause.code==="string"?cause.code:"unknown"});throw cause;}};
    node.syncBuiltinESMExports();
    f.options.isLocal=()=>{const value=local();f.supportDiagnostics.local.push(value);return value;};
    f.options.supported=()=>supported().pipe(E.tap(value=>E.sync(()=>f.supportDiagnostics.support.push({value,local:f.options.isLocal(),phase:f.options.admission.snapshot().phase}))));
    f.restoreDiagnostics=()=>{f.options.supported=supported;f.options.isLocal=local;fs.readFile=read;node.syncBuiltinESMExports();};return true;
  })()`);

  await installSyntheticRemoteCipher(main);
  await signIn(main, first, "a@example.test");
  let session = await enter(first);
  assert.equal(session.localScopeId, initial.localScopeId);
  const milestone = unwrap(
    await first.evaluate(
      ({ session, projectId }) =>
        window.openbot.localPlanning.run({
          session,
          input: {
            operationId: crypto.randomUUID(),
            action: {
              kind: "create_milestone",
              projectId,
              expectedRevision: 1,
              title: "Offline milestone",
              criteria: "Manual evidence recorded",
            },
          },
        }),
      { session: { generation: session.generation }, projectId },
    ),
  );
  const review = unwrap(
    await first.evaluate(
      ({ session, projectId, milestoneId }) =>
        window.openbot.localPlanning.run({
          session,
          input: {
            operationId: crypto.randomUUID(),
            action: {
              kind: "submit_review",
              projectId,
              expectedRevision: 2,
              milestoneId,
              evidenceNote: "Synthetic evidence",
            },
          },
        }),
      { session: { generation: session.generation }, projectId, milestoneId: milestone.objectId },
    ),
  );
  assert.equal((await first.evaluate(() => window.openbot.auth.logout())).status, "signed_out");
  await main.evaluate("__planningFixture.waitAccount()");
  session = await enter(first);
  assert.equal(session.localScopeId, initial.localScopeId);
  unwrap(
    await first.evaluate(
      ({ session, projectId, milestoneId, reviewId }) =>
        window.openbot.localPlanning.run({
          session,
          input: {
            operationId: crypto.randomUUID(),
            action: {
              kind: "decide_review",
              projectId,
              expectedRevision: 3,
              milestoneId,
              reviewId,
              gateGeneration: 1,
              criteriaRevision: 1,
              decision: "release",
              rationale: "Offline owner decision",
            },
          },
        }),
      {
        session: { generation: session.generation },
        projectId,
        milestoneId: milestone.objectId,
        reviewId: review.objectId,
      },
    ),
  );
  await signIn(main, first, "b@example.test");
  session = await enter(first);
  assert.equal(session.localScopeId, initial.localScopeId);
  const project = unwrap(
    await first.evaluate(
      ({ session, projectId }) => window.openbot.localPlanning.getProject({ session, input: projectId }),
      { session: { generation: session.generation }, projectId },
    ),
  );
  assert.equal(project.id, projectId);
  assert.equal(project.revision, 4);
  recordCase("electron-account-continuity");

  await main.evaluate(
    `(async()=>{const f=__planningFixture;const E=require("effect").Effect;f.auxiliaryAgent=await E.runPromise(f.services.service.createAgentProfile({name:"Auxiliary evidence",description:"Disposable window evidence",avatarSeed:"planning-auxiliary",avatarHue:null}));return true;})()`,
  );
  const auxiliaryCreated = context.waitForEvent("page");
  await main.evaluate(
    '__planningFixture.windows.openChatWindow({serverId:"local",agentId:__planningFixture.auxiliaryAgent.id})',
  );
  const auxiliary = await auxiliaryCreated;
  await auxiliary.waitForFunction(() => Boolean(window.openbot));
  await assert.rejects(auxiliary.evaluate(() => window.openbot.localPlanning.availability()));
  recordCase("electron-auxiliary-refusal");
  await auxiliary.close();

  await assert.rejects(first.evaluate(() => window.openbot.servers.select("missing-planning-fixture-host")));
  const stale = await first.evaluate((session) => window.openbot.localPlanning.listProjects({ session, input: {} }), {
    generation: session.generation,
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error.code, "stale_scope");
  session = await enter(first);
  const saved = await draft(first, session, "Scope switch draft");
  // Host operations remain the production ones. This is a loopback host of the disposable account.
  const remoteId = z.string().parse(
    await main.evaluate(`(async()=>{
 const E=require("effect").Effect;const s=__planningFixture.services;const user=s.centralAuth.getSignedInUser();
 if(!s.teamStore.configured)await E.runPromise(s.teamStore.configureWithAccount("Planning fixture host",user));
 await E.runPromise(s.host.startLoopbackOnly());
 const connection=await E.runPromise(s.host.createDevelopmentConnection());
 __planningFixture.connection=connection;
 await E.runPromise(s.remoteServers.connectDevelopmentServer(connection));return connection.serverId;
 })()`),
  );
  await first.evaluate(() => window.openbot.servers.select("local"));
  session = await enter(first);
  await installDelay(main);
  const delayed = first.evaluate(
    ({ session, projectId }) => window.openbot.localPlanning.getProject({ session, input: projectId }),
    { session: { generation: session.generation }, projectId },
  );
  await main.evaluate("__planningFixture.readStarted");
  await first.evaluate((id) => window.openbot.servers.select(id), remoteId);
  const unavailable = unwrap(await first.evaluate(() => window.openbot.localPlanning.availability()));
  assert.equal(unavailable.reason, "unavailable");
  assert.equal((await first.evaluate(() => window.openbot.localPlanning.enter())).ok, false);
  await releaseDelay(main);
  const delayedReply = await delayed;
  assert.equal(delayedReply.ok, false);
  if (!delayedReply.ok) assert.equal(delayedReply.error.code, "stale_scope");
  await first.evaluate(() => window.openbot.servers.select("local"));
  const returned = await enter(first);
  assert.notEqual(returned.generation, session.generation);
  assert.equal(returned.localScopeId, session.localScopeId);
  assert.equal(returned.windowDraftId, session.windowDraftId);
  const recovered = unwrap(
    await first.evaluate((session) => window.openbot.localPlanning.listDrafts({ session, input: {} }), {
      generation: returned.generation,
    }),
  );
  assert.ok(recovered.items.some((item) => item.id === saved.objectId));
  recordCase("electron-host-generation");

  const secondCreated = context.waitForEvent("page");
  await main.evaluate(
    "(async()=>{const window=__planningFixture.windows.openMainWindow();await __planningFixture.windows.loadRenderer(window);return true;})()",
  );
  const second = await secondCreated;
  await second.waitForFunction(() => Boolean(window.openbot));
  const secondSession = await enter(second);
  session = await enter(first);
  assert.equal(session.privateEpoch, secondSession.privateEpoch);
  assert.notEqual(session.windowDraftId, secondSession.windowDraftId);
  const secondDraft = await draft(second, secondSession, "Second window draft");
  const crossWrite = await first.evaluate(
    ({ session, draftId }) =>
      window.openbot.localPlanning.run({
        session,
        input: {
          operationId: crypto.randomUUID(),
          action: {
            kind: "save_draft",
            draftId,
            expectedDraftRevision: 1,
            target: { kind: "project", id: null },
            form: { title: "Implicit overwrite", goal: "" },
          },
        },
      }),
    { session: { generation: session.generation }, draftId: secondDraft.objectId },
  );
  assert.equal(crossWrite.ok, false);
  await main.evaluate(
    "require('electron').BrowserWindow.getAllWindows().filter(window=>window.webContents!==__planningFixture.windows.getMainWindow().webContents).forEach(window=>window.hide())",
  );
  assert.equal(
    z.boolean().parse(await main.evaluate("__planningFixture.options.windows.privateRenderersDestroyed()")),
    false,
  );
  recordCase("electron-window-drafts");

  const missing = unwrap(
    await first.evaluate((privateEpoch) => window.openbot.localPlanning.leave({ privateEpoch }), session.privateEpoch),
  );
  const timedOut = await first.evaluate((input) => window.openbot.localPlanning.confirmExit(input), {
    privateEpoch: session.privateEpoch,
    exitId: missing.exitId,
    outcome: "saved" as const,
  });
  assert.equal(timedOut.ok, false);
  assert.equal(first.isClosed(), false);
  assert.equal(second.isClosed(), false);
  recordCase("electron-missing-exit-ack");

  let exit = unwrap(
    await first.evaluate((privateEpoch) => window.openbot.localPlanning.leave({ privateEpoch }), session.privateEpoch),
  );
  const firstAck = first
    .evaluate((input) => window.openbot.localPlanning.confirmExit(input), {
      privateEpoch: session.privateEpoch,
      exitId: exit.exitId,
      outcome: "saved" as const,
    })
    .then(
      (reply) => ({ reply }),
      (cause) => ({ error: cause instanceof Error ? cause : new Error("A fixture confirmation failed.") }),
    );
  const blocked = await second.evaluate((input) => window.openbot.localPlanning.confirmExit(input), {
    privateEpoch: session.privateEpoch,
    exitId: exit.exitId,
    outcome: "blocked" as const,
  });
  assert.equal(blocked.ok, false);
  const firstOutcome = await firstAck;
  if ("error" in firstOutcome) throw firstOutcome.error;
  assert.equal(firstOutcome.reply.ok, false);
  assert.equal(first.isClosed(), false);
  assert.equal(second.isClosed(), false);
  recordCase("electron-blocked-exit");

  await main.evaluate(
    `(async()=>{const f=__planningFixture;const E=require("effect").Effect;f.survivingAgent=await E.runPromise(f.services.service.createAgentProfile({name:"Surviving auxiliary evidence",description:"Disposable ordinary input evidence",avatarSeed:"planning-surviving",avatarHue:null}));return true;})()`,
  );
  const survivingAuxiliaryCreated = context.waitForEvent("page");
  await main.evaluate(
    '__planningFixture.windows.openChatWindow({serverId:"local",agentId:__planningFixture.survivingAgent.id})',
  );
  const survivingAuxiliary = await survivingAuxiliaryCreated;
  await survivingAuxiliary.waitForFunction(() => Boolean(window.openbot));
  const ordinaryInput = await survivingAuxiliary.evaluateHandle(() => ({ text: "Unsaved ordinary auxiliary input" }));

  await main.evaluate(
    `(()=>{const f=__planningFixture;f.exitTrace=[];for(const window of require("electron").BrowserWindow.getAllWindows()) {if(window.webContents.getURL().includes("localhost:"))window.webContents.once("destroyed",()=>f.exitTrace.push("destroyed"));}return true;})()`,
  );
  await installDelay(main);
  const pending = first
    .evaluate(({ session, projectId }) => window.openbot.localPlanning.getProject({ session, input: projectId }), {
      session: { generation: session.generation },
      projectId,
    })
    .catch(() => null);
  await main.evaluate("__planningFixture.readStarted");
  exit = unwrap(
    await first.evaluate((privateEpoch) => window.openbot.localPlanning.leave({ privateEpoch }), session.privateEpoch),
  );
  await exposePrivate(main, "__planningFixture.services.localPlanning", "#exit", "pendingExit");
  const newPage = context.waitForEvent("page");
  const replies = [
    first
      .evaluate((input) => window.openbot.localPlanning.confirmExit(input), {
        privateEpoch: session.privateEpoch,
        exitId: exit.exitId,
        outcome: "saved" as const,
      })
      .catch(() => null),
    second
      .evaluate((input) => window.openbot.localPlanning.confirmExit(input), {
        privateEpoch: session.privateEpoch,
        exitId: exit.exitId,
        outcome: "saved" as const,
      })
      .catch(() => null),
  ];
  const shell = await newPage;
  await shell.waitForFunction(() => Boolean(window.openbot));
  await Promise.all(replies);
  await main.evaluate(
    "require('effect').Effect.runPromise(require('effect').Deferred.await(__planningFixture.pendingExit.done))",
  );
  await releaseDelay(main);
  const fenced = await pending;
  assert.ok(fenced === null || fenced.ok === false);
  assert.ok(first.isClosed() && second.isClosed());
  assert.equal(
    survivingAuxiliary.isClosed(),
    false,
    "Deliberate private replacement must retain ordinary auxiliary input.",
  );
  assert.equal(await ordinaryInput.evaluate((value) => value.text), "Unsaved ordinary auxiliary input");
  await ordinaryInput.dispose();
  const trace = z
    .array(z.string())
    .parse(
      await main.evaluate(
        `(async()=>{const f=__planningFixture;const lease=await require("effect").Effect.runPromise(f.options.admission.acquirePublic("electron-public-proof","capture"));f.exitTrace.push("public");lease.releaseVerified();return f.exitTrace;})()`,
      ),
    );
  assert.ok(trace.filter((item) => item === "destroyed").length >= 2);
  assert.equal(trace.at(-1), "public");
  recordCase("electron-private-destruction");
  await shell.evaluate(() => window.openbot.browserDock.publishPresentation(null));
  const pip = await shell.evaluate(() => window.openbot.browser.openPictureInPicture(undefined));
  assert.ok(pip.width > 0 && pip.height > 0);
  await shell.evaluate(() => window.openbot.browser.closePictureInPicture());
  recordCase("electron-public-window-rebind");

  const crashSession = await enter(shell);
  const crashDraft = await draft(shell, crashSession, "Crash recovery draft");
  await main.evaluate("(()=>{globalThis.__planningCrash=__planningFixture.windows.getMainWindow();return true;})()");
  intentionalCrash = true;
  const crashedEvent = shell.waitForEvent("crash");
  await main.evaluate("__planningCrash.webContents.forcefullyCrashRenderer()");
  await crashedEvent;
  assert.equal(
    z.boolean().parse(await main.evaluate("__planningFixture.options.windows.privateRenderersDestroyed()")),
    false,
  );
  const recoveredPage = context.waitForEvent("page");
  // Explicit fixture recovery destroys only the crashed renderer. Admission remains private.
  await main.evaluate("__planningFixture.windows.replacePrivateRenderers([__planningCrash.webContents])");
  const crashRecovered = await recoveredPage;
  await crashRecovered.waitForFunction(() => Boolean(window.openbot));
  const crashRecoveredSession = await enter(crashRecovered);
  const crashRecoveredDrafts = unwrap(
    await crashRecovered.evaluate((session) => window.openbot.localPlanning.listDrafts({ session, input: {} }), {
      generation: crashRecoveredSession.generation,
    }),
  );
  assert.ok(crashRecoveredDrafts.items.some((item) => item.id === crashDraft.objectId));
  assert.equal(crashRecoveredSession.privateEpoch, crashSession.privateEpoch);
  const crashRecoveredExit = unwrap(
    await crashRecovered.evaluate(
      (privateEpoch) => window.openbot.localPlanning.leave({ privateEpoch }),
      crashRecoveredSession.privateEpoch,
    ),
  );
  await exposePrivate(main, "__planningFixture.services.localPlanning", "#exit", "pendingExit");
  const finalShell = context.waitForEvent("page");
  const finalAck = crashRecovered
    .evaluate((input) => window.openbot.localPlanning.confirmExit(input), {
      privateEpoch: crashRecoveredSession.privateEpoch,
      exitId: crashRecoveredExit.exitId,
      outcome: "saved" as const,
    })
    .catch(() => null);
  await finalShell;
  await finalAck;
  await main.evaluate(
    "require('effect').Effect.runPromise(require('effect').Deferred.await(__planningFixture.pendingExit.done))",
  );
  assert.equal(
    z.boolean().parse(await main.evaluate("__planningFixture.options.windows.privateRenderersDestroyed()")),
    true,
  );
  recordCase("electron-renderer-crash");
}

/** Narrow lifecycle reproducer; it cannot replace the full Electron report. */
export async function electronWindowLifecycleCase(
  main: InspectorClient,
  browser: Browser,
  page: Page,
  session: PlanningSession,
): Promise<void> {
  const context = browser.contexts()[0];
  assert.ok(context);
  const browserUrl = z
    .string()
    .parse(await main.evaluate("__planningFixture.services.centralAuth.resolveApiUrl('/health/live')"));
  const tab = await page.evaluate((url) => window.openbot.browser.open({ url, focus: false }), browserUrl);
  await main.evaluate(
    `(async()=>{const f=__planningFixture;const E=require("effect").Effect;f.auxiliaryAgent=await E.runPromise(f.services.service.createAgentProfile({name:"Auxiliary evidence",description:"Disposable window evidence",avatarSeed:"planning-auxiliary",avatarHue:null}));return true;})()`,
  );
  const auxiliaryCreated = context.waitForEvent("page");
  await main.evaluate(
    '__planningFixture.windows.openChatWindow({serverId:"local",agentId:"planning-lifecycle-auxiliary"})',
  );
  const auxiliary = await auxiliaryCreated;
  await auxiliary.waitForFunction(() => Boolean(window.openbot));
  const exit = unwrap(
    await page.evaluate((privateEpoch) => window.openbot.localPlanning.leave({ privateEpoch }), session.privateEpoch),
  );
  const created = context.waitForEvent("page");
  const confirming = page
    .evaluate((input) => window.openbot.localPlanning.confirmExit(input), {
      privateEpoch: session.privateEpoch,
      exitId: exit.exitId,
      outcome: "saved" as const,
    })
    .catch(() => null);
  const shell = await created;
  await shell.waitForFunction(() => Boolean(window.openbot));
  await confirming;
  const failures: string[] = [];
  if (auxiliary.isClosed()) failures.push("ordinary auxiliary input was destroyed");
  try {
    await shell.evaluate(() => window.openbot.browserDock.publishPresentation(null));
  } catch {
    failures.push("dock still authorizes the destroyed parent");
  }
  try {
    await shell.evaluate(() => window.openbot.browser.openPictureInPicture(undefined));
    await shell.evaluate(() => window.openbot.browser.closePictureInPicture());
  } catch {
    failures.push("picture in picture still uses the destroyed parent");
  }
  try {
    await shell.evaluate((tabId) => window.openbot.browser.activate(tabId), tab.id);
    await shell.evaluate(() =>
      window.openbot.browser.setVisible({
        visible: true,
        target: "main",
        bounds: { x: 0, y: 0, width: 640, height: 480 },
      }),
    );
    assert.equal(
      z
        .boolean()
        .parse(
          await main.evaluate(
            "(()=>{const window=__planningFixture.windows.getMainWindow();return window.contentView.children.some(view=>'webContents' in view && view.webContents!==window.webContents && view.webContents.getURL().includes('/health/live'));})()",
          ),
        ),
      true,
    );
    await shell.evaluate((tabId) => window.openbot.browser.close(tabId), tab.id);
  } catch {
    failures.push("browser view still uses the destroyed parent");
  }
  assert.deepEqual(failures, []);
}
