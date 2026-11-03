// Drives only the named, disposable Electron stack used by the planning evidence harness.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { InspectorClient } from "./dev-automation/inspector-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";
import { mainTarget, readApplicationRuntime } from "./project-planning/app-fixture";
import { type ApplicationRuntime, verifyPlanningEvidence } from "./project-planning/report";
import {
  persistedUiPlanning,
  uiDraftErrorCases,
  uiHostSwitch,
  uiPagination,
  uiRecoveredDecision,
  uiTasksUndo,
  uiTwoWindowExit,
} from "./project-planning/ui-cases";

const root = resolve(import.meta.dirname, "..");
const instance = process.argv.find((value) => value.startsWith("--instance="))?.slice(11);
assert.ok(instance, "Name the isolated planning instance.");
assertMutationAllowed({
  command: "project-planning-ui-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance,
});
assert.equal(process.env.OPENBOT_PLANNING_ISOLATED, "xvfb");
const runId = randomUUID();
const output = join(root, ".openbot-build/project-planning", runId, "ui");
await mkdir(output, { recursive: true, mode: 0o700 });
const logger = createOpenBotLogger("project-planning-ui-e2e");
const report: {
  runId: string;
  platform: string;
  runtime: ApplicationRuntime | null;
  schemaVersion: number;
  basis: string;
  commit: string;
  cases: string[];
  passed: boolean;
  failure: string | null;
  activity: { providerCalls: number; githubCalls: number } | null;
  activityBasis: string;
  liveAccountTransportTested: boolean;
  systemKeyringTested: boolean;
  sourceHashes: Record<string, string>;
} = {
  runId,
  platform: `${process.platform}-${process.arch}`,
  runtime: null,
  schemaVersion: 1,
  basis: "electron-ui",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  cases: [],
  passed: false,
  failure: null,
  activity: null,
  activityBasis: "agent-service-send-message-and-start-task-and-github-connector-network-operations",
  liveAccountTransportTested: false,
  systemKeyringTested: false,
  sourceHashes: {},
};
const sourceFiles = [
  "scripts/project-planning-ui-e2e.ts",
  "scripts/project-planning/app-fixture.ts",
  "scripts/project-planning/report.ts",
  "out-dev-app/main/index.js",
  "out-dev-app/preload/index.cjs",
  "scripts/project-planning/ui-cases.ts",
  "src/main/local-planning-windows.ts",
  "packages/contracts/src/ipc-local-planning.ts",
  "src/backend/local-planning/local-planning-schemas.ts",
  "src/backend/database/local-planning-drafts.ts",
  "src/main/ipc/local-planning-handlers.ts",
  "src/preload/local-planning-decoding.ts",
  "src/renderer/src/app-providers.tsx",
  "src/renderer/src/AppView.tsx",
  "packages/i18n/src/messages/en/work.ts",
];
for (const directory of ["src/renderer/src/features/work", "packages/ui/src/features/work"])
  for (const name of await readdir(join(root, directory))) sourceFiles.push(`${directory}/${name}`);
for (const path of sourceFiles)
  report.sourceHashes[path] = createHash("sha256")
    .update(await readFile(join(root, path)))
    .digest("hex");
let unexpectedCrashes = 0;
function recordCase(id: string): void {
  assert.equal(unexpectedCrashes, 0, "An unexpected renderer crash invalidates UI evidence.");
  report.cases.push(id);
  logger.info("UI case passed.", { id });
}
const watchdog = setTimeout(() => {
  report.passed = false;
  report.failure ??= "PlanningUiDeadlineExceeded";
  logger.error("Planning UI deadline exceeded.", { output });
  void writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`).finally(() => process.exit(1));
}, 180000);
let main: InspectorClient | null = null;
let close: (() => Promise<void>) | null = null;
try {
  main = await InspectorClient.connect(Number(process.env.V8_INSPECTOR_BRK_PORT));
  report.runtime = await readApplicationRuntime(main);
  const profile = z.string().parse(await main.evaluate("require('electron').app.getPath('userData')"));
  assert.ok(profile.endsWith(`OpenBot Dev ${instance}`));
  const records = readDevInstanceRecords().filter(
    (record) => resolve(record.projectRoot) === root && record.instanceId === instance && record.service === "app",
  );
  assert.equal(records.length, 1);
  const record = records[0];
  assert.ok(record);
  const pageSelector = await mainTarget(main);
  const connected = await connectToDevApp(record.remoteDebuggingPort, logger, {
    expectedRendererPort: record.rendererPort,
    ownerPid: record.pid,
    pageSelector,
  });
  close = connected.close;
  for (const context of connected.browser.contexts()) {
    const observe = (page: import("playwright-core").Page) => page.on("crash", () => unexpectedCrashes++);
    for (const page of context.pages()) observe(page);
    context.on("page", observe);
  }
  await main.evaluate(
    `(()=>{const E=require("effect").Effect;const f=__planningFixture;f.uiActivity={providerCalls:0,githubCalls:0};f.uiOriginalSend=f.services.service.sendMessage;f.services.service.sendMessage=()=>{f.uiActivity.providerCalls++;return E.die(new Error("Unexpected provider entry in the planning proof."));};f.uiGithubOriginals={};for(const name of ["connect","repositories","workflowCatalog","openInstall","openVerification","accessToken","repositoryTokens","mcpAuthorization"]){f.uiGithubOriginals[name]=f.services.githubConnector[name];f.services.githubConnector[name]=()=>{f.uiActivity.githubCalls++;return E.die(new Error("Unexpected GitHub entry in the planning proof."));};}return true;})()`,
  );
  const page = connected.page;
  page.on("console", (message) => {
    if (message.type() === "error") logger.error("Renderer console.", { message: message.text() });
  });
  let sampledResources = false;
  page.on("requestfailed", (request) => {
    logger.error("Renderer request failed.", { url: request.url(), failure: request.failure() });
    if (!sampledResources && request.failure()?.errorText.includes("INSUFFICIENT_RESOURCES")) {
      sampledResources = true;
      void main
        ?.evaluate(
          `(async()=>{const fs=require("node:fs/promises");return Promise.all(require("electron").app.getAppMetrics().map(async({pid,type})=>({pid,type,fdCount:await fs.readdir("/proc/"+pid+"/fd").then(rows=>rows.length).catch(()=>null),limit:await fs.readFile("/proc/"+pid+"/limits","utf8").then(text=>text.split("\\n").find(line=>line.startsWith("Max open files"))).catch(()=>null)})));})()`,
        )
        .then((value) => logger.warn("Application resource limits at request refusal.", { value }))
        .catch(() => undefined);
    }
  });
  page.on("pageerror", (cause) => logger.error("Renderer error.", { message: cause.message }));
  page.setDefaultTimeout(15000);
  assert.equal((await page.evaluate(() => window.openbot.auth.logout())).status, "signed_out");
  await main.evaluate("__planningFixture.waitAccount()");
  await page
    .getByRole("button", { name: /^(Open local Work|Work)$/ })
    .first()
    .waitFor({ state: "visible" });
  await page.waitForLoadState("load");
  recordCase("signed-out-ui");
  // The fixture starts from a public shell. Wait for its actual UI instead of reloading a cold module graph.
  const open = page.getByRole("button", { name: "Open local Work", exact: true });
  await open.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Private local planning", exact: true }).waitFor();
  assert.ok((await page.getByRole("status").allTextContents()).join(" ").includes("screen"));
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some(
      (button) =>
        (button.textContent === "Enter private planning" && !button.disabled) || button.textContent === "Stop activity",
    ),
  );
  for (const stop of await page.getByRole("button", { name: "Stop activity", exact: true }).all()) {
    await stop.click();
    await stop.waitFor({ state: "detached" });
  }
  await page.getByRole("button", { name: "Enter private planning", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).waitFor();
  recordCase("keyboard-private-entry");
  async function keyboardButton(name: string): Promise<void> {
    await page.getByRole("button", { name, exact: true }).focus();
    await page.keyboard.press("Enter");
  }
  const title = `UI project ${randomUUID()}`;
  await keyboardButton("New project");
  await page.getByLabel("Project title", { exact: true }).fill(title);
  await page.getByLabel("Goal", { exact: true }).fill("Offline goal canary");
  await keyboardButton("Save project");
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  await keyboardButton("New milestone");
  await page.getByLabel("Milestone title", { exact: true }).fill("Manual milestone");
  await page.getByLabel("Acceptance criteria", { exact: true }).fill("Review the offline evidence");
  await keyboardButton("Save milestone");
  await page.getByRole("button", { name: "Manual milestone", exact: true }).waitFor();
  await keyboardButton("New ticket");
  await page.getByLabel("Ticket title", { exact: true }).fill("Manual ticket");
  await page.getByLabel("Acceptance criteria", { exact: true }).fill("Keep local evidence");
  await page.getByLabel("Notes", { exact: true }).fill("Private notes canary");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await keyboardButton("Save ticket");
  await page.getByRole("button", { name: "Manual ticket", exact: true }).waitFor();
  recordCase("manual-planning-offline");
  await page.getByRole("button", { name: "Manual milestone", exact: true }).click();
  await page.getByRole("button", { name: "Submit review", exact: true }).click();
  await page.getByLabel("Review evidence", { exact: true }).fill("Manual review canary");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await page.getByRole("button", { name: "Review details", exact: true }).click();
  await page.getByLabel("Decision rationale", { exact: true }).fill("Checked locally");
  await page.getByRole("button", { name: "Release milestone", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByText("Released", { exact: true }).waitFor();
  recordCase("keyboard-manual-review");
  await keyboardButton("Edit project");
  const projectTitle = page.getByLabel("Project title", { exact: true });
  await projectTitle.fill("x".repeat(257));
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await projectTitle.inputValue(), "x".repeat(257));
  await projectTitle.fill(`${title} edited`);
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page.getByRole("heading", { name: `${title} edited`, exact: true }).waitFor();
  recordCase("announced-validation-preserves-input");
  await keyboardButton("Archive project");
  await page.getByRole("button", { name: "Restore project", exact: true }).waitFor();
  await keyboardButton("Restore project");
  await page.getByRole("button", { name: "Archive project", exact: true }).waitFor();
  recordCase("archive-restore");
  const persisted = await persistedUiPlanning(page, `${title} edited`);
  recordCase("persisted-manual-values");
  await uiDraftErrorCases(main, page, persisted, recordCase);
  await uiRecoveredDecision(page, recordCase);
  await uiPagination(page, recordCase);
  await uiHostSwitch(main, page, recordCase);
  await uiTasksUndo(main, page, recordCase);
  await uiTwoWindowExit(main, connected.browser, page, recordCase);
  report.activity = z
    .object({ providerCalls: z.number().int().nonnegative(), githubCalls: z.number().int().nonnegative() })
    .parse(await main.evaluate("__planningFixture.uiActivity"));
  assert.equal(report.activity.providerCalls + report.activity.githubCalls, 0);
  recordCase("zero-provider-github-calls");
  report.passed = true;
  verifyPlanningEvidence(report);
} catch (cause) {
  report.passed = false;
  report.failure = cause instanceof Error ? cause.message : "PlanningUiFailure";
  process.exitCode = 1;
} finally {
  if (main)
    await main
      .evaluate(
        `(()=>{const f=globalThis.__planningFixture;if(!f)return true;if(f.uiOriginalStartTask)f.services.service.startTask=f.uiOriginalStartTask;if(f.uiOriginalSend)f.services.service.sendMessage=f.uiOriginalSend;if(f.uiGithubOriginals)for(const [name,original] of Object.entries(f.uiGithubOriginals))f.services.githubConnector[name]=original;if(f.originalRun&&f.options)f.options.domain.run=f.originalRun;if(f.uiOriginalRead&&f.options)f.options.domain.getProject=f.uiOriginalRead;f.uiReadReleaseResolve?.();if(f.uiPlanningOriginals)for(const [name,original] of Object.entries(f.uiPlanningOriginals))f.services.localPlanning[name]=original;return true;})()`,
      )
      .catch(() => undefined);
  main?.close();
  await close?.();
  await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  clearTimeout(watchdog);
  logger.info("Planning UI evidence written.", { output, passed: report.passed, failure: report.failure });
}
