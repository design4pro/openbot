import assert from "node:assert/strict";
import { z } from "zod";

export const planningReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  platform: z.string(),
  runtime: z.string(),
  group: z.literal("identity"),
  basis: z.literal("service"),
  sourceHashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  cases: z.array(z.string()),
  passed: z.boolean(),
  failure: z.string().nullable(),
});
export type PlanningReport = z.infer<typeof planningReportSchema>;

export function verifyPlanningReport(value: unknown): PlanningReport {
  const report = planningReportSchema.parse(value);
  assert.equal(report.passed, true, "Planning report did not pass");
  assert.equal(report.failure, null, "Planning report has a failure");
  assert.equal(new Set(report.cases).size, report.cases.length, "Duplicate planning cases");
  for (const id of [
    "identity-reopen",
    "identity-copy",
    "identity-new-profile",
    "identity-concurrent",
    "identity-corruption",
  ])
    assert.ok(report.cases.includes(id), `Missing planning case: ${id}`);
  assert.ok(Object.keys(report.sourceHashes).length > 0, "Missing source hashes");
  return report;
}
