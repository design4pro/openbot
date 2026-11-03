// Attaches only to the named disposable dev stack. Never launches Electron or changes a real profile.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { OpenBotDesktopApi, PlanningReply } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { InspectorClient } from "./dev-automation/inspector-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";
import { mainTarget, readApplicationRuntime } from "./project-planning/app-fixture";
import { platformRefusalCases } from "./project-planning/app-platform";
import { electronPlanningCases, electronWindowLifecycleCase } from "./project-planning/electron-cases";
import { type ApplicationRuntime, verifyPlanningEvidence } from "./project-planning/report";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}
const root = resolve(import.meta.dirname, "..");
const instance = process.argv.find((value) => value.startsWith("--instance="))?.slice(11);
assert.ok(instance, "Name a disposable test instance with --instance.");
assertMutationAllowed({
  command: "project-planning-electron-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance,
});
assert.equal(process.platform, "linux", "Use the isolated Linux desktop.");
assert.equal(process.env.OPENBOT_PLANNING_ISOLATED, "xvfb");
const inspectorPort = Number(process.env.V8_INSPECTOR_BRK_PORT);
assert.ok(Number.isInteger(inspectorPort) && inspectorPort >= 1024);
const publicFiles = process.argv.includes("--case=files-public");
const applicationGroup =
  process.argv.includes("--case=files") || publicFiles
    ? "files"
    : process.argv.includes("--case=remote")
      ? "remote"
      : null;
const runId = randomUUID();
const output = join(root, ".openbot-build/project-planning", runId, applicationGroup ?? "electron");
await mkdir(output, { recursive: true, mode: 0o700 });
const logger = createOpenBotLogger("project-planning-electron-e2e");
const cases: string[] = [];
const report: {
  schemaVersion: number;
  runId: string;
  commit: string;
  basis: string;
  platform: string;
  runtime: ApplicationRuntime | null;
  sourceHashes: Record<string, string>;
  cases: string[];
  passed: boolean;
  failure: string | null;
  liveAccountTransportTested: boolean;
  group?: "files" | "remote";
  diagnostics?: {
    support: Array<{ value: boolean; local: boolean; phase: string }>;
    io: Array<{ path: string; code: string }>;
    local: boolean[];
  };
} = {
  schemaVersion: 1,
  runId,
  runtime: null,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  basis: "electron",
  platform: `${process.platform}-${process.arch}`,
  sourceHashes: {},
  cases,
  passed: false,
  failure: null,
  liveAccountTransportTested: false,
  ...(applicationGroup ? { group: applicationGroup } : {}),
};
for (const path of [
  "scripts/project-planning/electron-cases.ts",
  "electron.vite.config.ts",
  "scripts/project-planning-electron-e2e.ts",
  "src/main/remote-server-store.ts",
  "src/main/remote-server-manager.ts",
  "src/backend/browser-host.ts",
  "src/main/browser-dock-overlay.ts",
  "src/main/browser-picture-in-picture.ts",
  "src/main/main-window.ts",
  "src/main/local-planning-service.ts",
  "src/main/local-planning-windows.ts",
  "src/main/ipc/local-planning-handlers.ts",
  "src/main/ipc/local-planning-inputs.ts",
  "src/main/application-services.ts",
  "src/main/index.ts",
  "src/preload/index.ts",
  "src/preload/local-planning-decoding.ts",
  "src/main/private-planning-support.ts",
  "scripts/project-planning/app-fixture.ts",
  "scripts/project-planning/app-platform.ts",
  "scripts/project-planning/app-files.ts",
  "scripts/project-planning/app-attachment-upload.ts",
  "scripts/project-planning/app-attachment-reads.ts",
  "src/main/ipc/attachment-handlers.ts",
  "src/main/file-preview.ts",
  "scripts/project-planning/app-file-races.ts",
  "src/main/file-response.ts",
  "src/main/session-configuration.ts",
  "src/main/maintenance-service.ts",
  "src/main/remote-screen-gateway.ts",
  "scripts/project-planning/remote.ts",
  "scripts/project-planning/remote-webrtc.ts",
  "scripts/project-planning/remote-peer.ts",
  "scripts/project-planning/remote-peer-protocol.ts",
  "src/backend/protected-profile-files.ts",
  "src/main/team-api-server.ts",
  "src/main/team-api/route-files.ts",
  "scripts/project-planning/report.ts",
  "out-dev-app/main/index.js",
  "out-dev-app/preload/index.cjs",
  "out-dev-app/preload/teamWebrtc.cjs",
])
  report.sourceHashes[path] = createHash("sha256")
    .update(await readFile(join(root, path)))
    .digest("hex");
let inspector: InspectorClient | null = null;
let closeBrowser: (() => Promise<void>) | null = null;
const watchdog = setTimeout(() => {
  report.passed = false;
  report.failure = "ElectronDeadlineExceeded";
  logger.error("Electron proof exceeded its deadline.");
  void writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }).finally(() =>
    process.exit(1),
  );
}, 180000);
function unwrap<T>(reply: PlanningReply<T>): T {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply.value;
}
try {
  inspector = await InspectorClient.connect(inspectorPort);
  const main = inspector;
  const attached = z
    .object({ result: z.object({ value: z.boolean() }) })
    .parse(
      await main.send("Runtime.evaluate", { expression: "Boolean(globalThis.__planningFixture)", returnByValue: true }),
    ).result.value;
  if (!attached) {
    const pauseSchema = z.object({
      callFrames: z.array(z.object({ callFrameId: z.string(), location: z.object({ lineNumber: z.number() }) })),
    });
    type Pause = z.infer<typeof pauseSchema>;
    let paused: (value: Pause) => void = () => {};
    main.on("Debugger.paused", (value) => paused(pauseSchema.parse(value)));
    await main.send("Debugger.enable");
    const bundle = await readFile(join(root, "out-dev-app/main/index.js"), "utf8");
    const lines = bundle.split("\n");
    const builtLine = lines.findIndex((line) => line.trim() === "services = built;");
    const authLine = lines.findIndex((line) => line.includes("const fetcher = detectBlockingNetwork(options.fetch"));
    assert.ok(builtLine > 0 && authLine > 0, "The dev bundle must expose the production composition points.");
    await main.send("Debugger.setBreakpointByUrl", { urlRegex: "out-dev-app/main/index\\.js$", lineNumber: authLine });
    await main.send("Debugger.setBreakpointByUrl", { urlRegex: "out-dev-app/main/index\\.js$", lineNumber: builtLine });
    // Only the disposable process receives this synthetic transport through its Node debugger.
    // Production code has no test flag, debug hook, privacy override, or alternate identity issuer.
    await main.send("Runtime.evaluate", {
      expression: `globalThis.__planningAuth={email:"",user:null,requests:[]};globalThis.__planningAuthFetch=async(input,init)=>{
 const fixture=globalThis.__planningAuth;const path=new URL(String(input)).pathname;fixture.requests.push(path);
 const json=value=>new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});
 if(path==="/health/live")return json({ok:true});
 if(path==="/v1/me")return json(fixture.user);
 if(path==="/v1/auth/email/start"){fixture.email=JSON.parse(init.body).email;return json({challengeId:"planning-challenge",expiresAt:Date.now()+60000,developmentCode:"123456"});}
 if(path==="/v1/auth/email/verify"){fixture.user={id:fixture.email==="a@example.test"?"account-a":"account-b",email:fixture.email,name:"Fixture",avatarUrl:null,analyticsEnabled:false};return json({sessionToken:"synthetic-planning-session",user:fixture.user});}
 if(path==="/v1/auth/logout")return new Response(null,{status:204});
 if(path.startsWith("/v2/remote/sessions/")&&path.endsWith("/end"))return new Response(null,{status:204});
 if(path==="/v1/auth/me")return json({user:fixture.user});
 if(path==="/v2/remote/hosts/")return json({hosts:[]});
 return new Response(JSON.stringify({code:"fixture_unavailable",message:"Synthetic transport only."}),{status:503,headers:{"content-type":"application/json"}});
 }`,
    });
    let nextPause = new Promise<Pause>((resolvePause) => {
      paused = resolvePause;
    });
    await main.send("Runtime.runIfWaitingForDebugger");
    for (;;) {
      const value = await nextPause;
      const frames = value.callFrames;
      assert.ok(Array.isArray(frames) && isDynamicRecord(frames[0]));
      const frame = frames[0];
      assert.ok(isString(frame.callFrameId));
      const location = frame.location;
      assert.ok(isDynamicRecord(location));
      const line = location.lineNumber;
      logger.info("Main composition checkpoint.", { line });
      if (line === authLine) {
        await main.send("Debugger.evaluateOnCallFrame", {
          callFrameId: frame.callFrameId,
          expression:
            "options.fetch=globalThis.__planningAuthFetch;options.encrypt=value=>Buffer.from(value);options.decrypt=value=>value.toString();options.canPersist=()=>true",
        });
      } else if (line === builtLine) {
        const result = await main.send("Debugger.evaluateOnCallFrame", {
          callFrameId: frame.callFrameId,
          expression:
            "globalThis.__planningFixture={services:built,windows,waitAccount:()=>require('effect').Effect.runPromise(remoteAccountGate.withPermit(require('effect').Effect.void))};true",
          returnByValue: true,
        });
        assert.ok(isDynamicRecord(result) && !result.exceptionDetails);
        await main.send("Debugger.resume");
        break;
      }
      nextPause = new Promise((resolvePause) => {
        paused = resolvePause;
      });
      await main.send("Debugger.resume");
    }
    await main.send("Debugger.disable");
  }
  await main.evaluate(
    `(async()=>{const contents=__planningFixture.windows.getMainWindow().webContents;if(contents.isLoadingMainFrame())await new Promise(resolve=>contents.once("did-finish-load",resolve));return true;})()`,
  );
  report.runtime = await readApplicationRuntime(main);
  const records = readDevInstanceRecords().filter(
    (record) => resolve(record.projectRoot) === root && record.instanceId === instance && record.service === "app",
  );
  assert.equal(records.length, 1);
  const record = records[0];
  assert.ok(record);
  const connected = await connectToDevApp(record.remoteDebuggingPort, logger, {
    expectedRendererPort: record.rendererPort,
    ownerPid: record.pid,
    pageSelector: await mainTarget(main),
  });
  closeBrowser = connected.close;
  const page = connected.page;
  page.setDefaultTimeout(15000);
  await page.waitForFunction(() => Boolean(window.openbot?.localPlanning));
  const state = await main.evaluate(
    `(()=>{const window=__planningFixture.windows.getMainWindow();return {sandbox:window.webContents.getLastWebPreferences().sandbox,contextIsolation:window.webContents.getLastWebPreferences().contextIsolation,nodeIntegration:window.webContents.getLastWebPreferences().nodeIntegration,profile:require("electron").app.getPath("userData")};})()`,
  );
  assert.ok(isDynamicRecord(state));
  assert.equal(state.sandbox, true);
  assert.equal(state.contextIsolation, true);
  assert.equal(state.nodeIntegration, false);
  assert.ok(isString(state.profile) && state.profile.endsWith(`OpenBot Dev ${instance}`));
  cases.push("electron-sandbox");
  if (process.argv.includes("--case=bootstrap")) {
    report.basis = "electron-bootstrap";
  } else if (process.argv.includes("--case=platform")) {
    report.basis = "electron-platform";
    await platformRefusalCases(main, page, (id) => cases.push(id));
  } else if (process.argv.includes("--case=unsupported")) {
    report.basis = "electron-unsupported";
    assert.equal(unwrap(await page.evaluate(() => window.openbot.localPlanning.availability())).reason, "unavailable");
    const refused = await page.evaluate(() => window.openbot.localPlanning.enter());
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error.code, "unavailable");
    cases.push("unsupported-configuration-refusal");
  } else if (applicationGroup === "files") {
    report.basis = publicFiles ? "electron-public-files" : "electron-app";
    const { applicationFileCases } = await import("./project-planning/app-files");
    await applicationFileCases(
      main,
      connected.browser,
      page,
      (id) => {
        report.cases.push(id);
        logger.info("Application file case passed.", { id });
      },
      !publicFiles,
    );
  } else if (applicationGroup === "remote") {
    report.basis = "electron-app";
    const { remotePlanningCases } = await import("./project-planning/remote");
    await remotePlanningCases(main, connected.browser, page, (id) => {
      report.cases.push(id);
      logger.info("Remote case passed.", { id });
    });
  } else {
    await platformRefusalCases(main, page, (id) => cases.push(id));
    await main.evaluate("require('effect').Effect.runPromise(__planningFixture.services.cuaDriver.state())");
    const initial = unwrap(await page.evaluate(() => window.openbot.localPlanning.availability()));
    assert.notEqual(
      initial.reason,
      "unavailable",
      "Reviewed native configuration must pass production support admission.",
    );
    assert.ok(initial.blockers.length > 0, "The real public CUA daemon must hold its lifetime.");
    const blocked = await page.evaluate(() => window.openbot.localPlanning.enter());
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.error.code, "privacy_busy");
    for (const blocker of initial.blockers)
      unwrap(
        await page.evaluate((activityId) => window.openbot.localPlanning.stopActivity({ activityId }), blocker.id),
      );
    assert.equal(unwrap(await page.evaluate(() => window.openbot.localPlanning.availability())).ready, true);
    cases.push("electron-public-activity");
    const session = unwrap(await page.evaluate(() => window.openbot.localPlanning.enter()));
    const project = unwrap(
      await page.evaluate(
        (session) =>
          window.openbot.localPlanning.run({
            session: { generation: session.generation },
            input: {
              operationId: crypto.randomUUID(),
              action: { kind: "create_project", title: "Private fixture canary", goal: "Private goal" },
            },
          }),
        session,
      ),
    );
    const detail = unwrap(
      await page.evaluate(
        ({ session, id }) =>
          window.openbot.localPlanning.getProject({ session: { generation: session.generation }, input: id }),
        { session, id: project.objectId },
      ),
    );
    assert.equal(detail.title, "Private fixture canary");
    cases.push("electron-local-owner");
    if (process.argv.includes("--case=window-lifecycle")) {
      report.basis = "electron-window-lifecycle";
      await electronWindowLifecycleCase(main, connected.browser, page, session);
      cases.push("electron-window-lifecycle");
    } else {
      await electronPlanningCases(main, connected.browser, page, session, project.objectId, (id) => {
        report.cases.push(id);
        logger.info("Electron case passed.", { id });
      });
    }
  }
  report.passed = true;
  if (report.basis === "electron" || report.basis === "electron-app") verifyPlanningEvidence(report);
} catch (cause) {
  report.passed = false;
  report.failure = cause instanceof Error ? cause.message : "ElectronProofFailure";
  process.exitCode = 1;
  logger.error("Electron proof failed.", { failure: report.failure });
} finally {
  await inspector?.evaluate("__planningFixture.restoreRemoteEvidence?.()").catch(() => undefined);
  if (inspector) {
    const diagnostics = await inspector
      .evaluate("globalThis.__planningFixture?.supportDiagnostics ?? null")
      .catch(() => null);
    if (diagnostics !== null)
      report.diagnostics = z
        .object({
          support: z.array(z.object({ value: z.boolean(), local: z.boolean(), phase: z.string() })),
          local: z.array(z.boolean()),
          io: z.array(z.object({ path: z.string().regex(/^\/proc\//u), code: z.string() })),
        })
        .parse(diagnostics);
    await inspector
      .send("Runtime.evaluate", { expression: "globalThis.__planningFixture?.restoreDiagnostics?.()" })
      .catch(() => undefined);
  }

  await inspector
    ?.send("Runtime.evaluate", {
      expression:
        "(()=>{const f=globalThis.__planningFixture;if(f?.originalRead)f.options.domain.getProject=f.originalRead;f?.readReleaseResolve?.();})()",
    })
    .catch(() => undefined);
  await closeBrowser?.();
  inspector?.close();
  await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  logger.info("Electron evidence written.", { output, passed: report.passed });
  clearTimeout(watchdog);
}
