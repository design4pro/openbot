import assert from "node:assert/strict";
import { z } from "zod";

export const planningReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  platform: z.string(),
  runtime: z.string(),
  group: z.enum(["identity", "files-service", "admission", "domain", "reviews", "native"]),
  basis: z.enum(["service", "native"]),
  nativeRuntime: z
    .object({
      driverDigest: z.string().regex(/^[a-f0-9]{64}$/),
      driverVersion: z.string(),
      displayBackend: z.literal("x11"),
      osMajor: z.string(),
      kernelRelease: z.string(),
      executionEnvironment: z.string(),
      remoteDigests: z.object({
        sunshine: z.string().regex(/^[a-f0-9]{64}$/),
        moonlightWebServer: z.string().regex(/^[a-f0-9]{64}$/),
        moonlightStreamer: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    })
    .optional(),
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
    native: [
      "native-public-lifetime",
      "stale-native-client",
      "native-private-restart",
      "native-delayed-start",
      "native-uncertain-stop",
      "native-public-resume",
      "native-remote-runtime",
      "native-daemon-query",
      "native-queued-input",
      "native-restart-reconciliation",
      "native-unexpected-exit",
    ],
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
  if (report.group === "native") {
    assert.equal(report.basis, "native");
    assert.ok(report.nativeRuntime);
  } else assert.equal(report.basis, "service");
  const required = requirements[report.group];
  for (const id of required) assert.ok(report.cases.includes(id), `Missing planning case: ${id}`);
  assert.ok(Object.keys(report.sourceHashes).length > 0, "Missing source hashes");
  return report;
}
