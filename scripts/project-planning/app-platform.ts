import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import type { InspectorClient } from "../dev-automation/inspector-client";
import { planningValue } from "./app-fixture";

/** Negative metadata probes exercise the real compiled gate; no positive capability is injected. */
export async function platformRefusalCases(
  main: InspectorClient,
  page: Page,
  record: (id: string) => void,
): Promise<void> {
  const baseline = planningValue(await page.evaluate(() => window.openbot.localPlanning.availability()));
  assert.notEqual(baseline.reason, "unavailable", "The actual tested configuration must be available first.");
  for (const blocker of baseline.blockers)
    planningValue(
      await page.evaluate((activityId) => window.openbot.localPlanning.stopActivity({ activityId }), blocker.id),
    );
  for (const variant of ["distribution", "release"] as const) {
    await main.evaluate(
      `(()=>{const fs=require("node:fs/promises");const node=require("node:module");const f=__planningFixture;const read=fs.readFile;f.restoreOsMetadata=()=>{fs.readFile=read;node.syncBuiltinESMExports();};fs.readFile=async(...args)=>{const value=await read(...args);if(args[0]!=="/etc/os-release")return value;const text=String(value);return ${JSON.stringify(variant)}==="distribution"?text.replace(/^ID=.*$/m,"ID=unreviewed"):text.replace(/^VERSION_ID=.*$/m,'VERSION_ID="24.10"');};node.syncBuiltinESMExports();return true;})()`,
    );
    try {
      const unavailable = planningValue(await page.evaluate(() => window.openbot.localPlanning.availability()));
      assert.equal(unavailable.reason, "unavailable", `An unproved ${variant} must stay closed.`);
      const entered = await page.evaluate(() => window.openbot.localPlanning.enter());
      assert.equal(entered.ok, false);
      if (!entered.ok) assert.equal(entered.error.code, "unavailable");
      record(variant === "distribution" ? "app-unknown-distribution-refusal" : "app-unproved-ubuntu-release-refusal");
    } finally {
      await main.evaluate("__planningFixture.restoreOsMetadata()");
    }
  }
  assert.notEqual(
    planningValue(await page.evaluate(() => window.openbot.localPlanning.availability())).reason,
    "unavailable",
  );
}
