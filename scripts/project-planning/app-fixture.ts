import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PlanningReply, PlanningSession } from "@openbot/contracts/ipc";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol";
import type { Browser, Page } from "playwright-core";
import { z } from "zod";
import type { InspectorClient } from "../dev-automation/inspector-client";
import { exposePrivate, signIn } from "./electron-cases";
import { type ApplicationRuntime, applicationRuntimeSchema } from "./report";

const appVersion = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))).version;
export function protocolHeaders(token: string, protocol = 9): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    [TEAM_APP_VERSION_HEADER]: appVersion,
    [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
    [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(protocol).join(","),
  };
}

export function planningValue<T>(reply: PlanningReply<T>): T {
  assert.equal(reply.ok, true, "The trusted planning operation must succeed.");
  return reply.value;
}
export async function mainTarget(main: InspectorClient): Promise<string> {
  return z
    .string()
    .parse(
      await main.evaluate(
        `(async()=>{const d=__planningFixture.windows.getMainWindow().webContents.debugger;d.attach("1.3");try{return (await d.sendCommand("Target.getTargetInfo")).targetInfo.targetId;}finally{d.detach();}})()`,
      ),
    );
}
export async function privateSession(page: Page): Promise<PlanningSession> {
  const availability = planningValue(await page.evaluate(() => window.openbot.localPlanning.availability()));
  assert.notEqual(availability.reason, "unavailable", "The compiled native configuration must be supported.");
  for (const blocker of availability.blockers)
    planningValue(
      await page.evaluate((activityId) => window.openbot.localPlanning.stopActivity({ activityId }), blocker.id),
    );
  return planningValue(await page.evaluate(() => window.openbot.localPlanning.enter()));
}
export async function loopbackConnection(main: InspectorClient, page: Page) {
  await signIn(main, page, "b@example.test");
  return z
    .object({ apiUrl: z.string().url(), sessionToken: z.string(), serverId: z.string() })
    .parse(
      await main.evaluate(
        `(async()=>{const E=require("effect").Effect;const f=__planningFixture;const s=f.services;if(!s.teamStore.configured)await E.runPromise(s.teamStore.configureWithAccount("Planning fixture host",s.centralAuth.getSignedInUser()));await E.runPromise(s.host.startLoopbackOnly());return await E.runPromise(s.host.createDevelopmentConnection());})()`,
      ),
    );
}

/** Test-only acknowledgement: these groups create no volatile form input. UI flushing has its own proof. */
export async function publicWindow(
  main: InspectorClient,
  browser: Browser,
  page: Page,
  session: PlanningSession,
): Promise<Page> {
  const exit = await page.evaluate(
    (privateEpoch) =>
      new Promise<import("@openbot/contracts/ipc").PlanningPrepareExit>((resolve, reject) => {
        const unsubscribe = window.openbot.localPlanning.onPrepareExit((exit) => {
          unsubscribe();
          resolve(exit);
        });
        void window.openbot.localPlanning.leave({ privateEpoch }).then((reply) => {
          if (!reply.ok) {
            unsubscribe();
            reject(new Error(reply.error.code));
          }
        }, reject);
      }),
    session.privateEpoch,
  );
  await exposePrivate(main, "__planningFixture.services.localPlanning", "#exit", "pendingExit");
  const context = browser.contexts()[0];
  assert.ok(context);
  const next = context.waitForEvent("page");
  void next.catch(() => undefined);
  const acknowledgement = page
    .evaluate((exit) => window.openbot.localPlanning.confirmExit({ ...exit, outcome: "saved" }), exit)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
  await main.evaluate(
    "require('effect').Effect.runPromise(require('effect').Deferred.await(__planningFixture.pendingExit.done))",
  );
  await exposePrivate(main, "__planningFixture.services.localPlanning", "#options", "options");
  assert.equal(await main.evaluate("__planningFixture.options.admission.snapshot().phase"), "public");
  const fresh = await next;
  await fresh.waitForFunction(() => Boolean(window.openbot));
  if (await acknowledgement) assert.ok(page.isClosed());
  assert.ok(page.isClosed());
  return fresh;
}

export async function readApplicationRuntime(main: InspectorClient): Promise<ApplicationRuntime> {
  return applicationRuntimeSchema.parse(
    await main.evaluate(
      `({electron:process.versions.electron,node:process.versions.node,kernelRelease:require("node:os").release()})`,
    ),
  );
}
