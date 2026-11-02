import assert from "node:assert/strict";
import { z } from "zod";

export const planningReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  platform: z.string(),
  runtime: z.string(),
  group: z.enum(["identity", "files-service", "admission", "domain", "reviews"]),
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
  const requirements = {
    identity: [
      "identity-reopen",
      "identity-copy",
      "identity-new-profile",
      "identity-concurrent",
      "identity-corruption",
    ],
    "files-service": [
      "protected-profile-paths",
      "protected-file-alias",
      "ordinary-file-control",
      "overlap-workspace-list",
      "replacement-guard",
      "protected-staging",
      "file-stream-refusal",
      "missing-file-metadata",
      "transfer-collision",
    ],
    reviews: [
      "review-submission",
      "review-decision",
      "criteria-superseded",
      "stale-review-decision",
      "archived-review-refusal",
      "review-history-reopen",
    ],
    domain: [
      "command-replay",
      "operation-conflict",
      "offline-planning",
      "revision-conflict",
      "archive-restore",
      "unicode-limit",
      "draft-consumption",
      "keyset-pages",
      "draft-limit",
      "authority-before-replay",
      "draft-byte-limit",
      "command-crash",
      "private-event-metadata",
      "channel-independent-replay",
    ],
    admission: [
      "public-lifetime",
      "private-denial",
      "exit-destruction",
      "admission-race",
      "capture-refusal",
      "capture-cancellation",
      "quiescence-refusal",
      "capture-delivery-lifetime",
    ],
  };
  const required = requirements[report.group];
  for (const id of required) assert.ok(report.cases.includes(id), `Missing planning case: ${id}`);
  assert.ok(Object.keys(report.sourceHashes).length > 0, "Missing source hashes");
  return report;
}
