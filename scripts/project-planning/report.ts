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
      "recovered-draft-discard",
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

export const applicationRuntimeSchema = z.object({
  electron: z.string().min(1),
  node: z.string().min(1),
  kernelRelease: z.string().min(1),
});
export type ApplicationRuntime = z.infer<typeof applicationRuntimeSchema>;

const appReportSchema = z.object({
  runId: z.string().uuid(),
  platform: z.string().min(1),
  runtime: applicationRuntimeSchema,
  schemaVersion: z.literal(1),
  basis: z.enum(["electron", "electron-ui", "electron-app"]),
  group: z.enum(["files", "remote"]).optional(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  cases: z.array(z.string()),
  passed: z.literal(true),
  failure: z.null(),
  sourceHashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
});
const appCases = {
  electron: [
    "app-unknown-distribution-refusal",
    "app-unproved-ubuntu-release-refusal",
    "electron-sandbox",
    "electron-public-activity",
    "electron-local-owner",
    "electron-account-continuity",
    "electron-auxiliary-refusal",
    "electron-host-generation",
    "electron-window-drafts",
    "electron-missing-exit-ack",
    "electron-blocked-exit",
    "electron-private-destruction",
    "electron-public-window-rebind",
    "electron-renderer-crash",
  ],
  ui: [
    "signed-out-ui",
    "keyboard-private-entry",
    "manual-planning-offline",
    "keyboard-manual-review",
    "announced-validation-preserves-input",
    "archive-restore",
    "persisted-manual-values",
    "revision-conflict-preserves-input",
    "draft-reload-recovery",
    "failed-save-preserves-input",
    "existing-draft-update-at-quota",
    "draft-quota-preserves-input",
    "recovered-decision-retains-target-and-input",
    "paged-project-list",
    "server-menu-remains-usable",
    "host-switch-draft-and-delayed-response",
    "remote-work-zero-planning-requests",
    "tasks-navigation-and-undo-without-provider",
    "private-exit-stay-and-focus",
    "other-window-failed-save-keeps-exclusion",
    "all-window-save-destroy-and-draft-recovery",
    "explicit-discard-destroys-without-saving-input",
    "zero-provider-github-calls",
  ],
  files: [
    "electron-sandbox",
    "app-private-admission",
    "app-local-workspace-preview-control",
    "app-local-shared-preview-control",
    "app-local-workspace-save-control",
    "app-local-shared-save-control",
    "app-local-attachment-save-control",
    "app-local-archive-control",
    "app-local-workspace-open-control",
    "app-local-shared-open-control",
    "app-local-attachment-open-control",
    "app-local-workspace-preview-replacement",
    "app-local-shared-preview-replacement",
    "app-local-workspace-save-replacement",
    "app-local-shared-save-replacement",
    "app-local-attachment-save-replacement",
    "app-local-archive-replacement",
    "app-local-workspace-open-replacement",
    "app-local-shared-open-replacement",
    "app-local-attachment-open-replacement",
    "app-remote-picker-control",
    "app-remote-import-control",
    "app-remote-picker-protected-refusal",
    "app-remote-import-protected-refusal",
    "app-ordinary-http-control",
    "app-protected-http-downloads",
    "app-replacement-before-open",
    "app-overlap-additional-folder",
    "app-browser-upload-refusal",
    "app-browser-upload-control",
    "app-staged-transfer-refusal",
    "app-managed-protocol-control",
    "app-managed-protocol-replacement",
    "app-backup-copy-control",
    "app-backup-replacement",
    "app-instance-export-refusal",
    "app-instance-export-control",
    "app-public-mode-profile-refusal",
  ],
  remote: [
    "electron-sandbox",
    "remote-private-admission",
    "remote-websocket-event-absence",
    "remote-released-http-adapters",
    "remote-derived-content-canaries",
    "remote-guessed-route-absence",
    "remote-storage-and-transfer-absence",
    "remote-mute-unmute-control",
    "remote-revoke-reconnect",
    "remote-webrtc-event-and-rpc-absence",
    "remote-webrtc-revoke-reconnect",
    "remote-diagnostics-absence",
    "remote-private-capture-refusal",
  ],
} as const;
export function verifyPlanningEvidence(value: unknown): void {
  const basis = z.object({ basis: z.string() }).parse(value).basis;
  if (basis === "service" || basis === "native") {
    verifyPlanningReport(value);
    return;
  }
  const report = appReportSchema.parse(value);
  const group = report.basis === "electron-app" ? report.group : report.basis === "electron-ui" ? "ui" : "electron";
  assert.ok(group, "Application evidence needs its group.");
  assert.equal(new Set(report.cases).size, report.cases.length, "Duplicate application cases.");
  for (const id of appCases[group]) assert.ok(report.cases.includes(id), `Missing application case: ${id}`);
  assert.ok(Object.keys(report.sourceHashes).length > 0, "Missing application source hashes.");
}
