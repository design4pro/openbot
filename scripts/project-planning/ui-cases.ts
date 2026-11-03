import assert from "node:assert/strict";
import type { DraftView, PlanningReply, PlanningSession, ProjectView } from "@openbot/contracts/ipc";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { z } from "zod";
import type { InspectorClient } from "../dev-automation/inspector-client";
import { exposePrivate } from "./electron-cases";

function value<T>(reply: PlanningReply<T>): T {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply.value;
}
function nextPage(context: BrowserContext): Promise<Page> {
  const pending = context.waitForEvent("page");
  void pending.catch(() => undefined);
  return pending;
}
export async function enterWork(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /^(Open local Work|Work)$/ })
    .first()
    .click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some(
      (button) =>
        (button.textContent === "Enter private planning" && !button.disabled) ||
        button.textContent === "Stop activity" ||
        button.textContent === "New project",
    ),
  );
  if (await page.getByRole("button", { name: "New project", exact: true }).isVisible()) return;
  for (const stop of await page.getByRole("button", { name: "Stop activity", exact: true }).all()) {
    await stop.click();
    await stop.waitFor({ state: "detached" });
  }
  await page.getByRole("button", { name: "Enter private planning", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).waitFor();
}
async function revealDraft(page: Page, title: string): Promise<void> {
  const row = page.getByRole("article", { name: title, exact: true });
  for (let pageIndex = 0; pageIndex < 5 && (await row.count()) === 0; pageIndex++) {
    await page.getByRole("button", { name: "Load more - Saved drafts", exact: true }).click();
    await page.getByRole("status", { name: "Saving or loading", exact: true }).waitFor({ state: "hidden" });
  }
  await row.waitFor();
}
export async function persistedUiPlanning(
  page: Page,
  title: string,
): Promise<{ session: PlanningSession; project: ProjectView }> {
  const session = value(await page.evaluate(() => window.openbot.localPlanning.enter()));
  let projects = value(
    await page.evaluate(
      (session) =>
        window.openbot.localPlanning.listProjects({
          session: { generation: session.generation },
          input: { limit: 100 },
        }),
      session,
    ),
  );
  let project = projects.items.find((project) => project.title === title);
  while (!project && projects.next) {
    projects = value(
      await page.evaluate(
        ({ session, after }) =>
          window.openbot.localPlanning.listProjects({
            session: { generation: session.generation },
            input: { limit: 100, after },
          }),
        { session, after: projects.next },
      ),
    );
    project = projects.items.find((project) => project.title === title);
  }
  assert.ok(project);
  const tickets = value(
    await page.evaluate(
      ({ session, projectId }) =>
        window.openbot.localPlanning.listTickets({ session: { generation: session.generation }, input: { projectId } }),
      { session, projectId: project.id },
    ),
  );
  assert.equal(tickets.items[0]?.status, "done");
  assert.equal(tickets.items[0]?.notes, "Private notes canary");
  const milestones = value(
    await page.evaluate(
      ({ session, projectId }) =>
        window.openbot.localPlanning.listMilestones({
          session: { generation: session.generation },
          input: { projectId },
        }),
      { session, projectId: project.id },
    ),
  );
  const milestone = milestones.items[0];
  assert.ok(milestone);
  assert.equal(milestone.gateState, "released");
  assert.ok(milestone.currentReviewId);
  const review = value(
    await page.evaluate(
      ({ session, input }) =>
        window.openbot.localPlanning.getReview({ session: { generation: session.generation }, input }),
      { session, input: milestone.currentReviewId },
    ),
  );
  assert.equal(review.review.evidenceNote, "Manual review canary");
  assert.equal(review.decision?.rationale, "Checked locally");
  return { session, project };
}

export async function uiDraftErrorCases(
  main: InspectorClient,
  page: Page,
  selected: { session: PlanningSession; project: ProjectView },
  record: (id: string) => void,
): Promise<void> {
  const { session, project } = selected;
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  const title = page.getByLabel("Project title", { exact: true });
  const changed = `${project.title} retained`;
  await title.fill(changed);
  value(
    await page.evaluate(
      ({ session, project }) =>
        window.openbot.localPlanning.run({
          session: { generation: session.generation },
          input: {
            operationId: crypto.randomUUID(),
            action: {
              kind: "edit_project",
              projectId: project.id,
              expectedRevision: project.revision,
              title: `${project.title} concurrent`,
              goal: project.goal,
            },
          },
        }),
      { session, project },
    ),
  );
  await page.getByRole("heading", { name: `${project.title} concurrent`, exact: true }).waitFor();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await title.inputValue(), changed);
  await page.getByRole("button", { name: "Use current revision and retry", exact: true }).click();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page.getByRole("heading", { name: changed, exact: true }).waitFor();
  record("revision-conflict-preserves-input");

  await page.getByRole("button", { name: "New project", exact: true }).click();
  const recoveryTitle = `Recovery ${crypto.randomUUID()}`;
  await page.getByLabel("Project title", { exact: true }).fill(recoveryTitle);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved locally", { exact: true }).waitFor();
  const saved = value(
    await page.evaluate(
      (session) =>
        window.openbot.localPlanning.listDrafts({ session: { generation: session.generation }, input: { limit: 100 } }),
      session,
    ),
  ).items.find((draft) => "title" in draft.form && draft.form.title === recoveryTitle);
  assert.ok(saved);
  await page.reload();
  await enterWork(page);
  await revealDraft(page, recoveryTitle);
  await page
    .getByRole("article", { name: recoveryTitle, exact: true })
    .getByRole("button", { name: "Copy draft into form", exact: true })
    .click();
  assert.equal(await page.getByLabel("Project title", { exact: true }).inputValue(), recoveryTitle);
  const recoveredSession = value(await page.evaluate(() => window.openbot.localPlanning.enter()));
  assert.notEqual(recoveredSession.generation, session.generation);
  const recovered = value(
    await page.evaluate(
      (session) =>
        window.openbot.localPlanning.listDrafts({ session: { generation: session.generation }, input: { limit: 100 } }),
      recoveredSession,
    ),
  );
  assert.ok(recovered.items.some((draft) => draft.id === saved.id));
  record("draft-reload-recovery");

  await exposePrivate(main, "__planningFixture.services.localPlanning", "#options", "options");
  await main.evaluate(
    `(()=>{const E=require("effect").Effect;const f=__planningFixture;f.originalRun=f.options.domain.run;f.options.domain.run=(context,input)=>input.action.kind==="save_draft"?E.fail({_tag:"LocalPlanningFailure",code:"storage_failed"}):f.originalRun.call(f.options.domain,context,input);return true;})()`,
  );
  await page.getByLabel("Project title", { exact: true }).fill(`${recoveryTitle} unsaved`);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("Project title", { exact: true }).inputValue(), `${recoveryTitle} unsaved`);
  await main.evaluate("(()=>{const f=__planningFixture;f.options.domain.run=f.originalRun;return true;})()");
  record("failed-save-preserves-input");

  const created: { id: string; revision: number }[] = [];
  const initial = value(
    await page.evaluate(
      (session) =>
        window.openbot.localPlanning.listDrafts({ session: { generation: session.generation }, input: { limit: 100 } }),
      recoveredSession,
    ),
  );
  try {
    for (let index = initial.items.length; index < 100; index++) {
      const draft = value(
        await page.evaluate(
          (session) =>
            window.openbot.localPlanning.run({
              session: { generation: session.generation },
              input: {
                operationId: crypto.randomUUID(),
                action: {
                  kind: "save_draft",
                  draftId: null,
                  expectedDraftRevision: null,
                  target: { kind: "project", id: null, formId: crypto.randomUUID() },
                  form: { title: "Quota fixture", goal: "" },
                },
              },
            }),
          recoveredSession,
        ),
      );
      created.push({ id: draft.objectId, revision: draft.revision });
    }
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByText("Draft saved locally", { exact: true }).waitFor();
    record("existing-draft-update-at-quota");
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project title", { exact: true }).fill(`${recoveryTitle} unsaved`);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByLabel("Project title", { exact: true }).inputValue(), `${recoveryTitle} unsaved`);
    record("draft-quota-preserves-input");
  } finally {
    for (const draft of created)
      value(
        await page.evaluate(
          ({ session, draft }) =>
            window.openbot.localPlanning.run({
              session: { generation: session.generation },
              input: {
                operationId: crypto.randomUUID(),
                action: { kind: "discard_draft", draftId: draft.id, expectedDraftRevision: draft.revision },
              },
            }),
          { session: recoveredSession, draft },
        ),
      );
  }
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved locally", { exact: true }).waitFor();
}

export async function savedDrafts(page: Page): Promise<DraftView[]> {
  const session = value(await page.evaluate(() => window.openbot.localPlanning.enter()));
  return value(
    await page.evaluate(
      (session) =>
        window.openbot.localPlanning.listDrafts({ session: { generation: session.generation }, input: { limit: 100 } }),
      session,
    ),
  ).items;
}

export async function uiPagination(page: Page, record: (id: string) => void): Promise<void> {
  const session = value(await page.evaluate(() => window.openbot.localPlanning.enter()));
  for (let index = 0; index < 21; index++)
    value(
      await page.evaluate(
        ({ session, index }) =>
          window.openbot.localPlanning.run({
            session: { generation: session.generation },
            input: {
              operationId: crypto.randomUUID(),
              action: { kind: "create_project", title: `Paging fixture ${index} ${crypto.randomUUID()}`, goal: "" },
            },
          }),
        { session, index },
      ),
    );
  const first = value(
    await page.evaluate(
      (session) =>
        window.openbot.localPlanning.listProjects({
          session: { generation: session.generation },
          input: { limit: 20 },
        }),
      session,
    ),
  );
  assert.ok(first.next);
  const next = value(
    await page.evaluate(
      ({ session, after }) =>
        window.openbot.localPlanning.listProjects({
          session: { generation: session.generation },
          input: { limit: 20, after },
        }),
      { session, after: first.next },
    ),
  );
  const candidate = next.items[0];
  assert.ok(candidate);
  await page.getByRole("button", { name: "Load more - Projects", exact: true }).click();
  await page.getByRole("button", { name: candidate.title, exact: true }).waitFor();
  record("paged-project-list");
}

export async function uiTasksUndo(main: InspectorClient, page: Page, record: (id: string) => void): Promise<void> {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved locally", { exact: true }).waitFor();
  await main.evaluate(
    `(async()=>{const E=require("effect").Effect;const f=__planningFixture;f.uiOriginalStartTask=f.services.service.startTask;f.services.service.startTask=()=>{f.uiActivity.providerCalls++;return E.die(new Error("Unexpected task commit in the Undo proof."));};await E.runPromise(f.services.service.createAgentProfile({name:"Planning Undo fixture",description:"Disposable offline profile",avatarSeed:"planning-undo",avatarHue:null}));return true;})()`,
  );
  const setup = await page.evaluate(() =>
    window.openbot.saveSetup({ preferredProvider: "codex", preferredModel: null }),
  );
  // The host preference owner sends this same existing notification after a remote setup save.
  await main.evaluate(
    `__planningFixture.windows.getMainWindow().webContents.send("app:setup-state",${JSON.stringify(setup)})`,
  );
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Tasks", exact: true }).click();
  const tasks = page.locator(".tasks-page");
  const input = tasks.locator(".tasks-page-composer").getByRole("textbox").first();
  const text = `Undo without a provider ${crypto.randomUUID()}`;
  await input.fill(text);
  await tasks.getByRole("button", { name: "Start task", exact: true }).click();
  await tasks.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await input.innerText(), text);
  assert.equal(await main.evaluate("__planningFixture.uiActivity.providerCalls"), 0);
  await enterWork(page);
  record("tasks-navigation-and-undo-without-provider");
}

export async function uiRecoveredDecision(page: Page, record: (id: string) => void): Promise<void> {
  const milestone = `Recovery milestone ${crypto.randomUUID()}`;
  const rationale = `Recovered decision ${crypto.randomUUID()}`;
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project title", { exact: true }).fill(`Decision project ${crypto.randomUUID()}`);
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page.getByRole("button", { name: "New milestone", exact: true }).click();
  await page.getByLabel("Milestone title", { exact: true }).fill(milestone);
  await page.getByLabel("Acceptance criteria", { exact: true }).fill("Recover this exact milestone review");
  await page.getByRole("button", { name: "Save milestone", exact: true }).click();
  await page.getByRole("button", { name: milestone, exact: true }).click();
  await page.getByRole("button", { name: "Submit review", exact: true }).click();
  await page.getByLabel("Review evidence", { exact: true }).fill("Offline recovery evidence");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await page.getByRole("button", { name: "Review details", exact: true }).click();
  await page.getByLabel("Decision rationale", { exact: true }).fill(rationale);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved locally", { exact: true }).waitFor();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await revealDraft(page, rationale);
  await page
    .getByRole("article", { name: rationale, exact: true })
    .getByRole("button", { name: "Copy draft into form", exact: true })
    .click();
  await page.waitForFunction(
    (rationale) => Array.from(document.querySelectorAll("textarea")).some((input) => input.value === rationale),
    rationale,
  );
  assert.equal(await page.getByLabel("Decision rationale", { exact: true }).inputValue(), rationale);
  assert.equal(await page.getByRole("button", { name: "Release milestone", exact: true }).isEnabled(), false);
  await page.getByRole("button", { name: "Use current revision and retry", exact: true }).click();
  await page.getByRole("button", { name: "Release milestone", exact: true }).click();
  await page.getByText("Released", { exact: true }).waitFor();
  record("recovered-decision-retains-target-and-input");
}

export async function uiHostSwitch(main: InspectorClient, page: Page, record: (id: string) => void): Promise<void> {
  const discard = page.getByRole("button", { name: "Discard form input", exact: true });
  if (await discard.isVisible()) await discard.click();
  const challenge = await page.evaluate(() => window.openbot.auth.requestEmailCode("b@example.test"));
  assert.equal(challenge.status, "code_sent");
  if (challenge.status !== "code_sent") throw new Error("Synthetic account challenge failed.");
  assert.equal(
    (
      await page.evaluate(
        (challengeId) => window.openbot.auth.verifyEmailCode({ challengeId, code: "123456" }),
        challenge.challengeId,
      )
    ).status,
    "signed_in",
  );
  await main.evaluate("__planningFixture.waitAccount()");
  await exposePrivate(main, "__planningFixture.services.remoteServers", "#store", "remoteStore");
  await exposePrivate(main, "__planningFixture.remoteStore", "#cipher", "remoteCipher");
  await main.evaluate(
    "Object.assign(__planningFixture.remoteCipher,{encrypt:value=>Buffer.from(value),decrypt:value=>value.toString()}) && true",
  );
  const remoteId = z
    .string()
    .parse(
      await main.evaluate(
        `(async()=>{const E=require("effect").Effect;const s=__planningFixture.services;if(!s.teamStore.configured)await E.runPromise(s.teamStore.configureWithAccount("Planning fixture host",s.centralAuth.getSignedInUser()));await E.runPromise(s.host.startLoopbackOnly());const connection=await E.runPromise(s.host.createDevelopmentConnection());await E.runPromise(s.remoteServers.connectDevelopmentServer(connection));return connection.serverId;})()`,
      ),
    );
  await page.evaluate(() => window.openbot.servers.select("local"));
  await page.reload();
  await enterWork(page);
  await page.getByRole("button", { name: "New project", exact: true }).waitFor();
  const before = value(await page.evaluate(() => window.openbot.localPlanning.enter()));
  await page.getByRole("button", { name: /^Open server menu for / }).click();
  await page.getByRole("menu", { name: /^Open server menu for / }).waitFor();
  await page.keyboard.press("Escape");
  record("server-menu-remains-usable");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const title = `Host switch ${crypto.randomUUID()}`;
  await page.getByLabel("Project title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved locally", { exact: true }).waitFor();
  await exposePrivate(main, "__planningFixture.services.localPlanning", "#options", "options");
  await main.evaluate(
    `(()=>{const E=require("effect").Effect;const f=__planningFixture;f.uiOriginalRead=f.options.domain.getProject;f.uiReadStarted=new Promise(resolve=>f.uiReadStartedResolve=resolve);f.uiReadRelease=new Promise(resolve=>f.uiReadReleaseResolve=resolve);f.uiReadUsed=false;f.options.domain.getProject=(context,id)=>E.gen(function*(){const result=yield* f.uiOriginalRead.call(f.options.domain,context,id);if(f.uiReadUsed)return result;f.uiReadUsed=true;f.uiReadStartedResolve();yield* E.promise(()=>f.uiReadRelease);return {...result,title:"Delayed private UI canary"};});return true;})()`,
  );
  // A selected project gives the refresh a real delayed detail request.
  const projectPage = value(
    await page.evaluate(
      (session) =>
        window.openbot.localPlanning.listProjects({
          session: { generation: session.generation },
          input: { limit: 20 },
        }),
      before,
    ),
  );
  const selectedProject = projectPage.items.find((project) => project.title.startsWith("UI project "));
  assert.ok(selectedProject);
  await page.getByRole("button", { name: selectedProject.title, exact: true }).click();
  await main.evaluate("__planningFixture.uiReadStarted");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const unsavedTitleBeforeSwitch = `${title} unsaved on switch`;
  await page.getByLabel("Project title", { exact: true }).fill(unsavedTitleBeforeSwitch);
  await main.evaluate(
    `(()=>{const f=__planningFixture;f.uiPlanningCalls=0;f.uiPlanningOriginals={};for(const name of ["availability","enter","listProjects","getProject","listMilestones","listTickets","listReviews","getReview","listDrafts","run"]){f.uiPlanningOriginals[name]=f.services.localPlanning[name];f.services.localPlanning[name]=function(...args){if(f.services.remoteServers.activeServerId!=="local")f.uiPlanningCalls++;return f.uiPlanningOriginals[name].apply(this,args);};}return true;})()`,
  );
  await page.keyboard.press("Control+2");
  await page.waitForFunction(
    async (remoteId) => (await window.openbot.servers.list()).find((server) => server.active)?.id === remoteId,
    remoteId,
  );
  await page
    .getByText("Private local planning is unavailable on this host or desktop configuration.", { exact: true })
    .waitFor();
  assert.equal((await page.locator("body").innerText()).includes(title), false);
  assert.equal(await main.evaluate("__planningFixture.uiPlanningCalls"), 0);
  await page.keyboard.press("Control+1");
  await page.waitForFunction(
    async () => (await window.openbot.servers.list()).find((server) => server.active)?.id === "local",
  );
  await page.getByRole("button", { name: "Enter private planning", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).waitFor();
  const after = value(await page.evaluate(() => window.openbot.localPlanning.enter()));
  assert.equal(after.localScopeId, before.localScopeId);
  assert.notEqual(after.generation, before.generation);
  await main.evaluate(
    "(()=>{const f=__planningFixture;f.options.domain.getProject=f.uiOriginalRead;f.uiReadReleaseResolve();for(const [name,original] of Object.entries(f.uiPlanningOriginals))f.services.localPlanning[name]=original;return true;})()",
  );
  assert.equal((await page.locator("body").innerText()).includes("Delayed private UI canary"), false);
  const draft = (await savedDrafts(page)).find(
    (draft) => "title" in draft.form && draft.form.title === unsavedTitleBeforeSwitch,
  );
  assert.ok(draft);
  await page.getByRole("heading", { name: selectedProject.title, exact: true }).waitFor();
  await revealDraft(page, unsavedTitleBeforeSwitch);
  await page
    .getByRole("article", { name: unsavedTitleBeforeSwitch, exact: true })
    .getByRole("button", { name: "Copy draft into form", exact: true })
    .click();
  assert.equal(await page.getByLabel("Project title", { exact: true }).inputValue(), unsavedTitleBeforeSwitch);
  record("host-switch-draft-and-delayed-response");
  record("remote-work-zero-planning-requests");
}

export async function uiTwoWindowExit(
  main: InspectorClient,
  browser: Browser,
  first: Page,
  record: (id: string) => void,
): Promise<void> {
  const context = browser.contexts()[0];
  assert.ok(context);
  const created = nextPage(context);
  await main.evaluate(
    "(async()=>{const window=__planningFixture.windows.openMainWindow();await __planningFixture.windows.loadRenderer(window);return true;})()",
  );
  const second = await created;
  second.setDefaultTimeout(15000);
  await enterWork(second);
  await first.getByLabel("Project title", { exact: true }).fill(`Stale session input ${crypto.randomUUID()}`);
  await first.getByRole("button", { name: "Save draft", exact: true }).click();
  await first.getByRole("button", { name: "Renew private session", exact: true }).click();
  await first.getByRole("button", { name: "New project", exact: true }).click();
  const firstTitle = `First window input ${crypto.randomUUID()}`;
  const secondTitle = `Second window input ${crypto.randomUUID()}`;
  await first.getByLabel("Project title", { exact: true }).fill(firstTitle);
  await second.getByRole("button", { name: "New project", exact: true }).click();
  await second.getByLabel("Project title", { exact: true }).fill(secondTitle);
  await first.getByRole("button", { name: "Leave private planning", exact: true }).click();
  await first.getByRole("alertdialog", { name: "Leave private planning?", exact: true }).waitFor();
  await second.getByRole("alertdialog", { name: "Leave private planning?", exact: true }).waitFor();
  await first.waitForFunction(() => document.activeElement?.textContent === "Stay private");
  await first.getByRole("button", { name: "Stay private", exact: true }).click();
  await second.getByRole("button", { name: "Stay private", exact: true }).click();
  await first.waitForFunction(() => document.activeElement?.textContent === "Leave private planning");
  assert.equal(await first.getByLabel("Project title", { exact: true }).inputValue(), firstTitle);
  assert.equal(await second.getByLabel("Project title", { exact: true }).inputValue(), secondTitle);
  record("private-exit-stay-and-focus");

  await exposePrivate(main, "__planningFixture.services.localPlanning", "#options", "options");
  await main.evaluate(
    `(()=>{const E=require("effect").Effect;const f=__planningFixture;f.originalRun=f.options.domain.run;f.options.domain.run=(context,input)=>input.action.kind==="save_draft"?E.fail({_tag:"LocalPlanningFailure",code:"storage_failed"}):f.originalRun.call(f.options.domain,context,input);return true;})()`,
  );
  const finalFirstTitle = `${firstTitle} pending`;
  const finalSecondTitle = `${secondTitle} pending`;
  await first.getByLabel("Project title", { exact: true }).fill(finalFirstTitle);
  await second.getByLabel("Project title", { exact: true }).fill(finalSecondTitle);
  await first.getByRole("button", { name: "Leave private planning", exact: true }).click();
  await first.getByRole("button", { name: "Save drafts and leave", exact: true }).click();
  await second.getByRole("button", { name: "Save drafts and leave", exact: true }).click();
  await first.getByRole("alert").filter({ hasText: "A draft could not be saved" }).waitFor();
  assert.equal(first.isClosed(), false);
  assert.equal(second.isClosed(), false);
  assert.equal(await second.getByLabel("Project title", { exact: true }).inputValue(), finalSecondTitle);
  await main.evaluate("(()=>{const f=__planningFixture;f.options.domain.run=f.originalRun;return true;})()");
  record("other-window-failed-save-keeps-exclusion");

  const next = nextPage(context);
  await first.getByRole("button", { name: "Leave private planning", exact: true }).click();
  await exposePrivate(main, "__planningFixture.services.localPlanning", "#exit", "pendingExit");
  await first.getByRole("button", { name: "Save drafts and leave", exact: true }).click();
  const saveClick = second
    .getByRole("button", { name: "Save drafts and leave", exact: true })
    .click()
    .then(
      () => null,
      (cause: unknown) => cause,
    );
  const shell = await next;
  await shell.waitForFunction(() => Boolean(window.openbot));
  await main.evaluate(
    "require('effect').Effect.runPromise(require('effect').Deferred.await(__planningFixture.pendingExit.done))",
  );
  if (await saveClick) assert.ok(second.isClosed(), "Only the expected old-window closure may interrupt this click.");
  assert.ok(first.isClosed() && second.isClosed());
  const publicText = await shell.locator("body").innerText();
  assert.equal(publicText.includes(firstTitle) || publicText.includes(secondTitle), false);
  await enterWork(shell);
  const drafts = await savedDrafts(shell);
  const firstDraft = drafts.find((draft) => "title" in draft.form && draft.form.title === finalFirstTitle);
  const secondDraft = drafts.find((draft) => "title" in draft.form && draft.form.title === finalSecondTitle);
  assert.ok(firstDraft && secondDraft);
  assert.notEqual(firstDraft.windowDraftId, secondDraft.windowDraftId);
  record("all-window-save-destroy-and-draft-recovery");
  await shell.getByRole("button", { name: "New project", exact: true }).click();
  const discardedTitle = `Discarded input ${crypto.randomUUID()}`;
  await shell.getByLabel("Project title", { exact: true }).fill(discardedTitle);
  // Focus leaving Work can autosave. Keep this input volatile with an expected storage refusal.
  await main.evaluate(
    `(()=>{const E=require("effect").Effect;const f=__planningFixture;f.originalRun=f.options.domain.run;f.options.domain.run=(context,input)=>input.action.kind==="save_draft"?E.fail({_tag:"LocalPlanningFailure",code:"storage_failed"}):f.originalRun.call(f.options.domain,context,input);return true;})()`,
  );
  const replacement = nextPage(context);
  await shell.getByRole("button", { name: "Leave private planning", exact: true }).click();
  await exposePrivate(main, "__planningFixture.services.localPlanning", "#exit", "pendingExit");
  const discardClick = shell
    .getByRole("button", { name: "Discard unsaved planning input and leave", exact: true })
    .click()
    .then(
      () => null,
      (cause: unknown) => cause,
    );
  const publicShell = await replacement;
  await publicShell.waitForFunction(() => Boolean(window.openbot));
  await main.evaluate(
    "require('effect').Effect.runPromise(require('effect').Deferred.await(__planningFixture.pendingExit.done))",
  );
  if (await discardClick) assert.ok(shell.isClosed(), "Only the expected old-window closure may interrupt this click.");
  await main.evaluate("(()=>{const f=__planningFixture;f.options.domain.run=f.originalRun;return true;})()");
  assert.ok(shell.isClosed());
  await enterWork(publicShell);
  assert.equal(
    (await savedDrafts(publicShell)).some((draft) => "title" in draft.form && draft.form.title === discardedTitle),
    false,
  );
  record("explicit-discard-destroys-without-saving-input");
}
