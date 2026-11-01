# S1-local Identity and Protected Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable profile ownership and private manual project planning without an account, provider or network connection.

**Architecture:** Keep identity, plans, drafts and command history in the existing host SQLite database. Main derives local authority from registered application windows and owns mutual exclusion between private planning and native viewing/control. Separate local IPC projections never enter Team API, agent context or shared events.

**Tech Stack:** Repository-pinned Effect 4.0.0, node:sqlite, Electron IPC, SolidJS 2, shared `@openbot/ui`, existing i18n and E2E tooling. No new runtime dependency.

**Spec:** [Accepted design](../specs/2026-11-01-local-identity-protected-planning-design.md).
**Context:** [S0 evidence](../../../plans/011-project-workspaces/s0-evidence.md), [blocked execution handoff](2026-11-01-project-workspaces-s1.md).
**State:** Ready for plan review. Design approved on 2026-11-01; implementation has not started.
**Source baseline:** `d3f381835`. Recheck source locations and the next unused migration before execution.

## Global Constraints

- Full local operation, including milestone release, needs no OpenBot account.
- The owner belongs to the application profile. Sign-in and sign-out do not change ownership.
- A complete, consistent profile copy preserves ownership and local project access. A new empty profile receives a new identity. An account alone cannot recover a lost profile.
- Protection applies to OpenBot application interfaces, including screen viewing/control. Local processes with the operating-system user's full permissions remain outside this protection.
- A protected planning view and remote screen viewing/control must exclude each other.
- Work shows projects of the active host only.
- Existing Tasks, approvals, Undo and conversation links keep their behavior.
- Bound text fields to 256 Unicode code points for titles and 32,768 for each goal, criteria, note or draft text field. Never truncate silently.
- Use the repository's pinned dependencies and PolyForm Noncommercial 1.0.0 license; no new runtime dependency is selected by this design.
- Preserve every released source schema, frozen Team API meaning, agent identity, Electron security boundary and teardown ordinal. Never assume an automatic database backup.
- No execution, agent assignment, repository provisioning, GitHub, remote sharing, account-link UI, attachments, export, hard deletion or drag-and-drop board.
- E2E scripts are the default. Vitest is permitted here only for migration, renderer/main trust-boundary and redaction fixtures. No component/unit tests or story play functions.
- Run focused checks sequentially. Leave broad lint, aggregate typechecks, builds and suites to CI. Do not bypass commit hooks.

## Review Focus

1. A stale native client or startup race must not view or control private content after the UI reports entry - Tasks 3, 4 and 9.
2. A hard link, overlapping workspace root or staged file must not disclose the live database after a path check - Tasks 2 and 9.
3. A lost response followed by a duplicate command must return the original result, while a changed payload must conflict - Tasks 5 and 6.
4. Local -> remote -> local and renderer destruction must fence old responses without losing saved drafts - Tasks 7 and 8.
5. A missing post-upgrade identity or criteria change must never silently create a new owner or release an old review - Tasks 1 and 6.

---

## Delivery and verification rules

Tasks 1-4 establish boundaries before any private content is reachable from the UI. Tasks 5-6 add the
manual domain; Tasks 7-8 expose it locally; Task 9 establishes release evidence. Keep the entry point
unavailable until every adapter required for the current platform has passed its native proof.
A developer flag, saved report path or renderer-supplied capability must not bypass that condition.
Unsupported configurations show a generic refusal and receive no project data.

Use a worktree created through `using-git-worktrees` when execution starts, and run
`bun install --frozen-lockfile` first in a fresh worktree. Read each owner's `AGENTS.md` and
`CONTRIBUTING.md#security-sensitive-changes`. Read installed Effect source for APIs actually used.
Contracts remain platform-independent and do not acquire an Effect dependency: plain wire DTOs live
in contracts; backend domain types derive from Effect schemas. Main input schemas and preload result
decoders protect separate boundaries.

New scripts use `.openbot-build/project-planning/<run-id>/<group>/report.json`, with run ID,
checkout revision, source hashes, runtime/platform, case results and evidence basis. Exit 0 means
all required cases passed; skip, timeout, missing case, unexpected worker exit and unknown native
state fail the applicable gate. Reports contain synthetic IDs and safe codes, never profile contents
or credentials. Use barriers/events, owned PIDs and bounded cleanup. Do not copy S0's busy hook as a
replacement for real admission or process-exit evidence.
Harness case deadlines are 30,000 ms for service/file cases, 120,000 ms for native cases and 15,000 ms
for a UI state wait. They are failure bounds, never sleeps or retry policies. Keep production runtime
deadlines unchanged; cancellation or an expired harness deadline does not establish native quiescence.

Pure service groups (`identity`, `admission`, `domain`, `reviews`) run under the installed Node runtime
through the existing `tsx` pattern in `scripts/project-workspaces-s0-e2e.ts`; Bun orchestrates the CLI.
Full application groups (`files`, `remote`, Electron and UI) attach to this worktree's named,
disposable dev stack through `dev-automation` and the existing CDP helpers. They do not replace the
real Team API server with a loopback wrapper or a fake Electron module. Start/reuse the registered
stack through the existing dev supervisor; never start Electron directly for local app smoke checks.
Do not infer Node/Bun/Electron compatibility from one another. Every task adds its focused E2E
selection to the CI owner specified below in the same commit, not only at the end.

For app commands below, `PLANNING_TEST_INSTANCE` is the verified registry ID of the worktree's
disposable dev stack; `PLANNING_TEST_DISPLAY` is its isolated synthetic desktop. Use the stack's
reported values. Empty or mismatched values fail. Reuse `scripts/channel-e2e-support.ts` and
`scripts/dev-automation/cdp-client.ts` guards. Before Task 7, native service probes call the production
admission coordinator directly and drive real owned native clients; they need no future planning IPC.
They do not certify the later application/window integration. The native probe may run as a Node
service process on the isolated display; Electron integration is separately required in Task 9.

## File and ownership map

| Owner | New files | Existing integration files |
| --- | --- | --- |
| Host persistence | `src/backend/local-planning/local-planning-schema.ts`, `src/backend/database/local-profile-identity.ts`, `src/backend/database/local-planning-records.ts`, `src/backend/database/local-planning-drafts.ts` | `src/backend/openbot-database-schema.ts`, `src/backend/openbot-database-schema-history.json`, `src/backend/openbot-database.ts`, `src/backend/database/database-core.ts` |
| Domain | `src/backend/local-planning/local-planning-schemas.ts`, `local-planning-authority.ts`, `local-planning-errors.ts`, `local-planning-service.ts`, `local-planning-commands.ts`, `local-planning-reviews.ts` in the same directory | Existing `DatabaseCore.dispatch`; do not change released receipt semantics |
| File protection | `src/backend/protected-profile-files.ts` | Attachment gateway/files, workspace paths, storage usage, instance transfer, Team API file delivery and browser navigation owners in Task 2 |
| Private admission | `src/main/private-planning-admission.ts`, `src/main/private-planning-native.ts`, `src/main/private-planning-support.ts` | Screen capture, CUA runtime/client, remote screen gateway and service construction |
| Trusted sessions | `src/main/local-planning-service.ts`, `src/main/local-planning-windows.ts`, `src/main/ipc/local-planning-handlers.ts`, `src/main/ipc/local-planning-inputs.ts` | Main window, server selection, endpoint registrar and forwarders |
| IPC and preview | `packages/contracts/src/ipc-local-planning.ts`, `src/preload/local-planning-decoding.ts`, `src/renderer/src/preview/mock-local-planning.ts` | Contracts IPC exports/manifest, preload bridge and preview root |
| Work | `src/renderer/src/features/work/{work-context.tsx,work-privacy-context.tsx,work-port.ts,WorkPage.tsx}`, `packages/ui/src/features/work/{WorkPlanning.tsx,ProjectForm.tsx,TicketForm.tsx,MilestoneReview.tsx,work.css}` | Host selection, keyed providers, page rail, lazy view, shared UI exports/styles and catalogs |
| Evidence | `scripts/project-planning-e2e.ts`, `scripts/project-planning/{identity.ts,files.ts,admission.ts,native.ts,domain.ts,reviews.ts,remote.ts,report.ts}`, `scripts/project-planning-electron-e2e.ts`, `scripts/project-planning-ui-e2e.ts` | `.github/workflows/ci.yml`, `.github/workflows/cua-driver.yml`, README, privacy/architecture docs and changelog |

Paths without an existing line reference are intentional new modules. Do not add barrel modules or
refactor unrelated owners. Small harness/report utilities are shared only by these E2E scripts.

## Fixed implementation contracts

### Persistence

Use one appended migration and mirror its DDL in `LATEST_SCHEMA_SQL`. The migration's `up` and
the fresh-database creation path both call `initializeLocalProfile(db, createdAt)` inside their
existing transaction. Ordinary startup only reads identity; it never repairs it. Generate two
UUIDs with `node:crypto.randomUUID`. A separate singleton marker distinguishes corruption from
first initialization. If either identity/marker record is missing after the migration is stamped,
refuse planning. Do not run bootstrap from auth or `TeamStore`.

| Table | Required columns and keys |
| --- | --- |
| `local_profile_identity` | `singleton=1` PK/CHECK, unique `principal_id`, unique `local_scope_id`, `created_at` |
| `local_profile_identity_bootstrap` | `singleton=1` PK/CHECK, `initialized_at`; no cascading deletion with identity |
| `projection_local_projects` | `project_id` PK, `local_scope_id`, `owner_principal_id`, `title`, `goal`, `revision`, `archived_at`, `created_at`, `updated_at`, `last_event_sequence` |
| `projection_local_project_milestones` | `milestone_id` PK, `project_id`, `title`, `criteria`, `criteria_revision`, `revision`, `gate_state`, `gate_generation`, nullable `current_review_id`, timestamps/sequence |
| `projection_local_project_tickets` | `ticket_id` PK, `project_id`, nullable `milestone_id`, `title`, `criteria`, `notes`, `status`, `revision`, timestamps/sequence |
| `local_project_reviews` | `review_id` PK, project/milestone IDs, criteria snapshot/revision, gate generation, evidence note, submitter principal/time; immutable |
| `local_project_decisions` | `decision_id` PK, unique `review_id`, principal, `decision`, rationale, command ID/time; immutable |
| `local_project_command_keys` | `(principal_id, local_scope_id, operation_id)` PK, unique `command_id`, `fingerprint`, `aggregate_type`, `aggregate_id` |
| `local_project_drafts` | `draft_id` PK, principal/scope, `window_draft_id`, non-null canonical `target_key`, target kind/ID, validated form JSON, revision, byte count, timestamps; unique scope/window/target key |

Use restrictive ownership FKs and same-project milestone/ticket constraints; no references to channels,
accounts, TeamStore host IDs or agents. No cascading project deletion. Revisions start at 1 and grow
monotonically. Gate generation starts at 0; criteria revision starts at 1. Each project mutation bumps
the project revision and writes the affected child's revision to that new value. Immutable review and
decision rows retain their own snapshots. Schema constraints supplement domain authorization.

Draft writes use their own `local-planning-draft` aggregate and ID/revision-only events/receipts,
separate from committed `local-project` events. Draft text stays in the draft projection; no draft
save changes a project revision. This specifies the design's separation from project events without
losing atomic mutation receipts. No draft event enters a generic renderer or remote event stream.

### Limits and query shapes

Titles must contain a non-whitespace character. Preserve user text after validation; count Unicode
code points, not UTF-16 units. Body fields may be empty except criteria/evidence on review submission.
Whitespace-only review criteria/evidence are invalid. IDs and operation IDs are UUIDs. Revisions
and generations are safe nonnegative integers, with entity revisions at least 1.

All lists use keyset pages, default 50 and maximum 100 rows, ordered by `(created_at, id)` ascending.
`PageRequest={after?:{createdAt:string,id:string},limit?:number}`;
`Page<T>={items:T[],next:PageRequest['after']|null}`. Validate an RFC3339 timestamp and UUID cursor.
Project queries choose `archive: 'active'|'archived'|'all'` (default active). Detail reads return
one object, never an unbounded child/history array. Milestones, tickets, reviews and drafts have
separate paged queries. Every query filters owner and local scope before looking up object IDs.

Retain at most 100 saved drafts and 32 MiB of UTF-8 form JSON per profile. Reject an increase beyond
either limit as `limit_reached`, preserving existing drafts and input. Do not expire or evict drafts.
The owner can discard a selected draft. List recoverable drafts after restart; resume explicitly
with its draft revision. Two windows have distinct main-issued `windowDraftId` UUIDs. Explicit
draft save, field blur, host switch and private exit flush the current form; no timer is required.
Do not promise survival of a keystroke that has not reached a completed draft save.

### Domain and boundary types

Define these pure IPC DTOs in `ipc-local-planning.ts`, exported by `packages/contracts/src/ipc.ts`:

```ts
type PlanningSessionRef = { generation: string };
type PlanningSession = PlanningSessionRef & { localScopeId: string; windowDraftId: string; privateEpoch: string };
type NativeBlocker = { id: string; kind: 'cua_runtime' | 'remote_screen_runtime' | 'capture' | 'capture_sources'; state: 'starting' | 'active' | 'uncertain' };
type PlanningErrorCode = 'unavailable' | 'identity_invalid' | 'forbidden' | 'privacy_busy'
  | 'stale_scope' | 'not_found' | 'revision_conflict' | 'operation_conflict'
  | 'invalid_transition' | 'invalid_input' | 'limit_reached' | 'storage_failed';
type PlanningReply<T> = { ok: true; value: T }
  | { ok: false; error: { code: PlanningErrorCode; message: string } };
type PlanningChange = { localScopeId: string; generation: string; objectId: string; revision: number };
```

`ProjectView` carries `id, title, goal, revision, archivedAt, createdAt, updatedAt`.
`MilestoneView` carries `id, projectId, title, criteria, criteriaRevision, revision, gateState,
gateGeneration, currentReviewId, createdAt, updatedAt`.
`TicketView` carries `id, projectId, milestoneId, title, criteria, notes, status, revision, createdAt,
updatedAt`. Nullable IDs and archive timestamps use `null`, not absent keys. `ReviewView` and
`DecisionView` expose their immutable table values through local DTOs, without account IDs.
`DraftView` carries `id, windowDraftId, target, form, revision, updatedAt` and no authority fields.

`TicketStatus='todo'|'in_progress'|'done'`.
`PlanningCommand={operationId:string,action:PlanningAction,consumedDraft?:{id:string,revision:number}}`.
`consumedDraft` is valid only on a non-draft action and removes that window's saved draft in the same
successful project transaction. It participates in the fingerprint; absent optional fields normalize
to null for fingerprinting. Action tags and exact fields are:

| `kind` | Other fields |
| --- | --- |
| `create_project` | `title, goal` |
| `edit_project` | `projectId, expectedRevision, title, goal` |
| `archive_project`, `restore_project` | `projectId, expectedRevision` |
| `create_milestone` | `projectId, expectedRevision, title, criteria` |
| `edit_milestone` | `projectId, expectedRevision, milestoneId, title, criteria` |
| `create_ticket` | `projectId, expectedRevision, milestoneId:string|null, title, criteria, notes, status` |
| `edit_ticket` | Same fields as create ticket, plus `ticketId` |
| `submit_review` | `projectId, expectedRevision, milestoneId, evidenceNote` |
| `decide_review` | `projectId, expectedRevision, milestoneId, reviewId, gateGeneration, criteriaRevision, decision:'release'|'request_changes', rationale` |
| `save_draft` | `draftId:string|null, expectedDraftRevision:number|null, target, form` |
| `discard_draft` | `draftId, expectedDraftRevision` |

`target` is `{kind:'project',id:string|null}`, `{kind:'milestone',projectId,id:string|null}`,
`{kind:'ticket',projectId,id:string|null}`, `{kind:'review',projectId,milestoneId}` or
`{kind:'decision',projectId,milestoneId,reviewId}`. Form variants match that target: project fields;
milestone fields; ticket fields; `{evidenceNote}`; or `{decision,rationale}` respectively. Draft
forms permit incomplete/empty fields, within the same size limits. Validate target ownership even
for drafts. A draft save can update its existing window-owned row; reopening another window's draft
creates a separate copy under the new main-issued window ID, never an implicit overwrite.
Derive `target_key` from a fixed tuple of kind, project ID and target ID (use a fixed `new` sentinel
for null IDs). A window has at most one new form of each kind per project; SQLite NULL uniqueness
must not permit duplicate create drafts.

`PlanningCommandResult={objectId:string,revision:number,projectId:string|null}`. A draft result uses
its draft revision; discard returns the removed draft ID and the last revision. Command receipts
remain for replay after discard. Non-draft commands use the project revision.

Backend `LocalPlanningContext` is a non-serializable authority issued by `LocalPlanningAuthority`
from `LocalProfileIdentity.read()`. Only main receives that issuer; no endpoint takes a context or
principal ID. Public methods are:

```ts
// All domain methods return Effect<result, LocalPlanningFailure>.
LocalPlanningService.listProjects(ctx: LocalPlanningContext, query: ProjectQuery): Effect<Page<ProjectView>, LocalPlanningFailure>;
LocalPlanningService.getProject(ctx: LocalPlanningContext, projectId: string): Effect<ProjectView, LocalPlanningFailure>;
LocalPlanningService.listMilestones(ctx: LocalPlanningContext, query: ProjectPageQuery): Effect<Page<MilestoneView>, LocalPlanningFailure>;
LocalPlanningService.listTickets(ctx: LocalPlanningContext, query: TicketQuery): Effect<Page<TicketView>, LocalPlanningFailure>;
LocalPlanningService.listReviews(ctx: LocalPlanningContext, query: MilestonePageQuery): Effect<Page<ReviewView>, LocalPlanningFailure>;
LocalPlanningService.getReview(ctx: LocalPlanningContext, reviewId: string): Effect<{review:ReviewView,decision:DecisionView|null}, LocalPlanningFailure>;
LocalPlanningService.listDrafts(ctx: LocalPlanningContext, page: PageRequest): Effect<Page<DraftView>, LocalPlanningFailure>;
LocalPlanningService.run(ctx: LocalPlanningContext, command: PlanningCommand): Effect<PlanningCommandResult, LocalPlanningFailure>;
```

`ProjectQuery=PageRequest & {archive?:'active'|'archived'|'all'}`;
`ProjectPageQuery=PageRequest & {projectId:string}`;
`TicketQuery=ProjectPageQuery & {milestoneId?:string,status?:TicketStatus}`;
`MilestonePageQuery=ProjectPageQuery & {milestoneId:string}`.
Schema-derived domain aliases and wire DTOs must be structurally compatible without assertions.
Keep `LocalPlanningFailure` as a backend `Schema.TaggedError` with a safe code and private cause.
Map expected failures once in main to the reply envelope and `sourceText` keys; never serialize
causes, SQL parameters or request bodies. No paired Promise methods on domain services.

## Task 1: Durable profile identity and schema preservation

**Files:** Create the schema and identity controller from the map; create
`src/backend/local-planning-migration.test.ts`; modify database facade/schema/history and
`src/backend/openbot-database-schema-parity.test.ts` only where the new version requires it.
Create the report/CLI/identity E2E files and select `--group identity` in CI `team-api-routes-e2e`.

**Interfaces:** Produce `ProfileIdentity={principalId:string,localScopeId:string,createdAt:string}`,
`initializeLocalProfile(db:DatabaseSync,createdAt:string):void`,
`LocalProfileIdentity.read():ProfileIdentity`, and facade-owned `localIdentity` holding `DatabaseCore`.
Task 5 adds the records/drafts controllers when they gain real consumers. Constructors only assign dependencies.

- [ ] **Step 1:** Add migration fixtures and identity E2E assertions: two UUIDs persist across reopen;
  two concurrent opens observe one record; a closed-profile copy preserves both; an empty profile
  differs; deleting identity or marker after initialization causes `identity_invalid` with no rewrite.
  Reuse every released-schema fixture from the existing migration tests. Assert old conversations,
  sessions, receipts and schema markers remain intact, plus rollback/retry, missing-version,
  downgrade refusal, FK and integrity behavior. Do not invent a backup fixture as a migration escape.

  ```ts
  // Cases: identity-reopen, identity-copy, identity-corruption.
  assert.deepEqual(afterReopen.identity, beforeClose.identity);
  assert.deepEqual(copiedProfile.identity, beforeClose.identity);
  assert.equal(afterDeletedIdentity.code, 'identity_invalid');
  assert.equal(afterDeletedIdentity.identityRows, 0);
  ```
- [ ] **Step 2:** Run `bun run test:desktop -- src/backend/local-planning-migration.test.ts --maxWorkers=1`,
  then `bun scripts/project-planning-e2e.ts --group identity`. Expected RED: absent schema/identity.
- [ ] **Step 3:** Append the next contiguous migration (49 is the current end, not a reservation),
  add the fixed tables, indexes and both bootstrap paths. Keep schema creation/identity/marker atomic;
  subsequent reads fail closed. Do not alter auth, provider identities or old channel actors.
- [ ] **Step 4:** Repeat the two focused commands, then the schema parity file separately. Expected
  PASS with matching latest/upgraded schemas and no data loss. Add the generated schema-history entry
  only for the new version. Read the E2E artifact, including the post-corruption row count.
- [ ] **Step 5:** Lint only changed supported files, run `bun run typecheck:node`, then commit
  `feat: persist account-independent local profile identity` through the normal hook.

## Task 2: Protect live planning storage on application file paths

**Files:** Create `src/backend/protected-profile-files.ts` and the files E2E group. Modify
`src/backend/agent/attachment-gateway.ts`, `src/backend/attachment-files.ts`,
`src/backend/workspace-paths.ts`, `src/backend/agent-service.ts`, `src/backend/storage-usage.ts`,
`src/main/team-api/route-files.ts`, `route-workspace-directory.ts` in that directory,
`src/main/instance-transfer-service.ts` and `src/main/application-services.ts`.
Inspect/preserve the existing browser file-URL refusal in `src/backend/browser-host.ts` and managed
protocol boundaries in `src/main/session-configuration.ts`; change them only if a failing case
demonstrates a protected-file bypass.
Add protected redaction/boundary fixtures only where their existing owners require them.

**Interfaces:** Produce one injected `ProtectedProfileFiles` policy:
`assertPathAllowed(path:string):Effect<void,ProtectedProfileFileError>` for metadata/enumeration,
and `assertOpenedFileAllowed(path:string,stat:Stats):Effect<void,ProtectedProfileFileError>` before
any read/copy/stream, using `Stats` from `node:fs`. The policy owns canonical protected DB/WAL/SHM/
journal paths and current file identities, independent of private mode. No whole-profile directory ban.

- [ ] **Step 1:** Add files-group E2E cases for direct DB/WAL/SHM reads, symlink and hard-link aliases,
  overlapping workspace/shared/additional-folder roots, browser upload, instance export and staged
  transfer. Replace a resolved source before open and require refusal before any protected bytes or
  headers reach the destination. Ordinary workspace attachments/drafts still transfer. Existing
  aggregate DB byte counts remain available; project-specific names/counts do not appear.

  ```ts
  // Cases: protected-file-alias, ordinary-file-control.
  assert.equal(protectedTransfer.bytesWritten, 0);
  assert.equal(protectedTransfer.refused, true);
  assert.deepEqual(ordinaryTransfer.bytes, ordinarySource.bytes);
  ```
- [ ] **Step 2:** Run `bun scripts/project-planning-e2e.ts --group files --instance="$PLANNING_TEST_INSTANCE" --allow-mutations`. Expected RED: the current
  `allowAnyReadablePath` upload or an overlapping root accepts a protected source.
- [ ] **Step 3:** Install the policy before agent/file services become available. Reuse the gateway's
  opened-handle dev/ino checks; protect the same handle from which bytes are read, not a checked path
  reopened later. Check staged imports at their source as well as registered attachment delivery.
  Apply the policy at actual stream/copy reads and directory/storage projections; preserve the existing
  browser file-URL refusal and verify no other browser file route bypasses it. Keep ordinary browser
  web access and managed attachment protocol rules. Never log the source's contents.
- [ ] **Step 4:** Repeat the files group, including a real loopback Team API download and local browser
  upload destination. Require zero protected bytes, no leaked metadata and positive ordinary-file
  controls. A browser-owned file route that cannot be mediated must be unavailable when protected
  planning storage exists; do not certify it with a path-only fixture.
- [ ] **Step 5:** Add this group to CI `team-api-routes-e2e`, run changed-file lint and node types,
  then commit `fix: exclude protected profile files from application transfers`.

## Task 3: Atomic private admission and short-lived screen operations

**Files:** Create `src/main/private-planning-admission.ts` and the admission E2E group; modify
`src/main/screen-capture.ts` and service construction. Use the existing backend screen-capture
error type and localized source keys for safe refusals; do not add a parallel capture service.

**Interfaces:** `PublicActivityKind='capture'|'capture_sources'|'cua_runtime'|'remote_screen_runtime'`.
`PrivatePlanningAdmission.acquirePublic(id:string,kind:PublicActivityKind)` returns an Effect of an
internal lease with `releaseVerified():void` and `markUncertain():void`.
`enterPrivate():Effect<void,PrivatePlanningError>` changes public -> entering-private -> private
only when all participants are known quiescent. `finishPrivateExit():Effect<void,PrivatePlanningError>`
requires the window registry to confirm all private renderers/deliveries destroyed. No lease crosses IPC.

- [ ] **Step 1:** Add admission E2E barriers that race private entry with public acquisition. Assert
  exactly one succeeds; active, starting, uncertain and in-flight capture leases block entry;
  entering-private/private block new leases. An exception, cancellation or unexpected native exit
  never silently releases uncertainty. Reentrant private entry must not reset the exclusion epoch.

  ```ts
  // Cases: admission-race, uncertain-stop.
  assert.equal(Number(race.privateEntered) + Number(race.publicAdmitted), 1);
  assert.equal(afterUncertainStop.privateEntry.code, 'privacy_busy');
  ```
- [ ] **Step 2:** Run `bun scripts/project-planning-e2e.ts --group admission`. Expected RED: absent coordinator.
- [ ] **Step 3:** Implement synchronous state reservation before asynchronous work. Keep a small explicit
  main-owned state machine, not a generic permissions framework. Wrap `ScreenCapturer.listSources`
  and capture from before native access through final result/cleanup, including the approval delay
  at its caller. Results started in public cannot be delivered into a later private epoch. Failed
  private entry returns to public only if it exposed no data and no participant is uncertain.
- [ ] **Step 4:** Repeat the group and assert no native capture invocation after refusal, plus one
  successful public invocation. These are service race tests, not native platform certification.
- [ ] **Step 5:** Add the group to CI `team-api-routes-e2e`, run changed-file lint and node types,
  then commit `feat: serialize private planning and screen admission`.

## Task 4: Mediate persistent native control lifetimes

**Files:** Create `src/main/private-planning-native.ts`, `src/main/private-planning-support.ts` and the native group; modify
`src/main/cua-driver-runtime.ts`, `src/main/cua-driver-daemon-client.ts`,
`src/main/cua-driver-action-tap.ts`, `src/main/remote-screen-gateway.ts`,
`src/main/application-services.ts`. Extend the Electron E2E entry and the native CI lane specified below.

**Interfaces:** `PrivatePlanningNative.blockers():NativeBlocker[]`, with safe kind/ID/state only;
`stopOwnedActivity(id:string):Effect<void,PrivatePlanningError>` is an explicit owner action and
returns only after verified termination, closed handles and drained input. Admission leases are held
from before native start through verified stop, including daemon warm-up, setup/test and queued starts.
`private-planning-support.ts` owns a reviewed mapping of tested platform, architecture, OS major,
display backend and pinned native driver digest; a runtime override must match the tested digest.
The mapping starts closed and gains an entry only with the corresponding passing real report.

- [ ] **Step 1:** Add a real native probe on an isolated desktop: a stale proxy and direct socket client,
  delayed start, daemon client window query, remote desktop/test session and queued input all block
  private entry. After explicit stop, old handles fail and a private session refuses restart, capture,
  accessibility and control. A deliberately unconfirmed stop leaves entry blocked. Verify new public
  control works after a clean private exit. Record exact native binary digest/version and platform.

  ```ts
  // Cases: stale-native-client, native-private-restart.
  assert.equal(staleClient.usableAfterVerifiedStop, false);
  assert.equal(privateRestart.nativeProcessStarted, false);
  assert.equal(privateRestart.code, 'privacy_busy');
  ```
- [ ] **Step 2:** Run `bun scripts/project-planning-e2e.ts --group native --isolated-display="$PLANNING_TEST_DISPLAY"`
  with real owned service processes on the synthetic display. Expected RED: native startup currently ignores private admission.
  Missing driver, permissions or a safe display is a failed release gate, not a skip/pass. Do not
  interact with the user's regular desktop or invoke a live provider.
- [ ] **Step 3:** Hold public leases for entire CUA daemon and remote-screen runtime lifetimes. All
  start paths, including `state()`, `warmUp`, local tests and setup, pass through the reservation.
  A CUA process still alive without a reported session remains a blocker. The tap's direct-socket
  fallback and previously created proxies gain no bypass: private entry requires the daemon actually
  stopped, and all app-managed restart paths are refused. Guard the daemon client as well as tools.
  Preserve agent threads and provider sessions; do not reconnect/reset them to simplify stopping CUA.
- [ ] **Step 4:** Keep existing lifecycle gates, deadlines and teardown ordinals. Preserve a separate
  uncertain blocker if a method clears its child field before stop fails. Observe actual exit and
  owned descendants/handles; a lease timeout, socket deletion or `running()===false` is insufficient.
  After main restart, reconcile this profile's native runtime identity before allowing private entry.
  Never kill a process by name or adopt an unverified PID. Unsupported runtime recovery refuses entry.
- [ ] **Step 5:** Repeat the native probe and race it with Task 3. Add real Linux/X11 proof to the
  CI browser lane under Xvfb. Keep macOS/Windows focused native reports as platform release gates;
  the current `cua-driver.yml` installer lane validates digests only and must not count as native proof.
  Run changed-file lint and node types; commit `feat: fence native control during private planning`.

## Task 5: Owner-scoped planning commands, queries and drafts

**Files:** Create domain schemas/authority/errors/service/commands and persistence controllers from
the map, plus `packages/contracts/src/ipc-local-planning.ts`; update its IPC export and the database
core/facade. Add the domain E2E group. No IPC endpoint or renderer entry is added yet.

**Interfaces:** Produce the fixed domain/query contracts above. `LocalPlanningAuthority.issue()` reads
the persisted identity and returns a context recognizable by that issuer; deserialized objects fail.
The service owns current-identity/owner checks and delegates synchronous writes to the existing core.
Add `DatabaseCore.dispatchChecked<T>(commandId:string,events:OrchestrationEventInput[],check:(db:DatabaseSync,replay:boolean)=>void,project:(db:DatabaseSync,sequences:number[])=>T):T`
and the facade delegation. It owns a transaction only when none exists, runs the synchronous check
inside that transaction before receipt replay, and then calls existing `dispatch` inside the same
transaction. The old `dispatch` signature and behavior stay unchanged. No controller opens `BEGIN`.

- [ ] **Step 1:** Add domain E2E assertions for offline project/milestone/ticket CRUD, manual status,
  archive/restore and draft save/discard/reopen. A foreign/forged context and unknown object ID
  disclose nothing. The pure service does not need auth or an account-host registration. Task 7
  exercises actual account/host lifecycle rather than substituting an unused fixture account value.
- [ ] **Step 2:** Add same-operation/same-payload replay, changed-payload conflict, two writers at one
  expected revision and process termination before/after command commit. Assert one event/result,
  current authorization before replay and no dependency on channel receipts. Delete an unrelated
  channel, reopen DB, and replay a project command successfully. Add 256/257-code-point titles,
  32,768/32,769 body values, empty/incomplete drafts, page boundaries and draft-count/byte-limit cases.

  ```ts
  // Cases: command-replay, operation-conflict, unicode-limit, draft-limit.
  assert.deepEqual(replayed.value, first.value);
  assert.equal(projectEventsForOperation.length, 1);
  assert.equal(changedPayload.error.code, 'operation_conflict');
  assert.equal(title257.error.code, 'invalid_input');
  assert.equal(draft101.error.code, 'limit_reached');
  ```
- [ ] **Step 3:** Run `bun scripts/project-planning-e2e.ts --group domain`. Expected RED: absent domain operations.
- [ ] **Step 4:** Implement named Effect operations and schema-derived domain types. Owner/scope checks,
  fingerprint comparison, expected revisions, events, projection and receipt stay in one transaction
  through `dispatchChecked` under the existing core. Its check validates current authority and
  fingerprint on replay, and expected revisions only for a new command. The existing `dispatch`
  returns receipts before invoking projectors, so a projector-only fingerprint check is insufficient.
  A command key without its required receipt is an integrity failure, not permission to retry. Derive
  `command_id` deterministically from scope/principal/operation UUID; fingerprint a fixed-order tuple
  of the decoded command kind and every action field, including revisions and nulls. Property order
  in the submitted JSON must not change it. Do not modify generic `dispatch()` behavior.
- [ ] **Step 5:** Implement paged SQL queries with owner/scope predicates and matching indexes. Drafts
  retain incomplete validated form data, use their own metadata events, and enforce both quotas in
  the same transaction. Archives reject mutation of plans; allow saved-draft recovery/discard without
  making archived data editable. A submitted saved draft is removed atomically with its successful
  project command only through the fixed `consumedDraft` field and a matching current draft revision.
- [ ] **Step 6:** Repeat domain E2E. Add CI selection to `team-api-routes-e2e`, lint changed files,
  run contracts types then node types sequentially, and commit `feat: add owner-scoped local planning`.

## Task 6: Version-bound milestone reviews and decisions

**Files:** Create `src/backend/local-planning/local-planning-reviews.ts`, add review schemas/records
to the domain modules, and create the reviews E2E group. Reuse Task 5's command transaction owner.

**Interfaces:** Implement `submit_review` and `decide_review` through `LocalPlanningService.run`.
`gateState='open'|'in_review'|'released'|'changes_requested'`; ticket status is independent.

- [ ] **Step 1:** Add reviews E2E assertions: submission requires nonblank criteria/evidence, creates
  one immutable snapshot, increments generation and enters `in_review`. Only its owner may release
  or request changes for the exact review/generation/criteria revision/project revision. Duplicate
  operations replay once; a different second decision conflicts. No provider or scheduler is called.
- [ ] **Step 2:** Edit criteria while in review and after release; require `changes_requested`, preserved
  old decision, increased criteria revision and a new review ID/generation on resubmission. A title-only
  edit bumps project/milestone revision but does not invalidate unchanged criteria. Two windows using
  an old review, or an archived project, cannot release. Reopen the database and assert all history.

  ```ts
  // Cases: criteria-superseded, stale-review-decision.
  assert.equal(afterCriteriaEdit.gateState, 'changes_requested');
  assert.notEqual(resubmitted.reviewId, firstReview.id);
  assert.equal(staleDecision.ok, false);
  assert.equal(savedFirstDecision.reviewId, firstReview.id);
  ```
- [ ] **Step 3:** Run `bun scripts/project-planning-e2e.ts --group reviews`. Expected RED: missing review behavior.
- [ ] **Step 4:** Implement atomic snapshot/decision transitions and the fixed action fields. The
  previous current review is historical as soon as criteria change; retain its ID in its immutable
  row, clear `current_review_id`, and require a new submit. No generic reopen or automatic resume.
  A release records human application authority under the accepted OS/renderer boundary, not
  independent proof that arbitrary same-user automation was absent.
- [ ] **Step 5:** Repeat reviews E2E, add CI selection, lint changed files and run node types; commit
  `feat: bind milestone decisions to current review generations`.

## Task 7: Trusted local IPC, scope freshness and private window lifecycle

**Files:** Create main service/window/session/input/handler and preload decoder modules from the map.
Modify `packages/contracts/src/ipc-endpoints.ts`, `src/preload/index.ts`,
`src/renderer/src/preview/mock-openbot.ts`, `src/main/index.ts`, `src/main/main-window.ts`,
`src/main/ipc/team-handlers.ts`, `src/main/renderer-forwarders.ts`, `src/main/application-services.ts`.
Create `src/main/ipc/local-planning-handlers.test.ts` and `src/preload/local-planning-decoding.test.ts`
as protected boundary fixtures, plus the real Electron E2E script and preview domain mock.

**Interfaces:** Add `localPlanning` to `IPC_ENDPOINTS`/`IPC_GROUP_PATHS`, with these ordinary `request`
endpoints (not scoped requests and never `AgentIpcRequest`): `availability`, `enter`, `leave`,
`confirmExit`, `stopActivity`, `listProjects`, `getProject`, `listMilestones`, `listTickets`, `listReviews`,
`getReview`, `listDrafts`, `run`, plus `changed` and `prepareExit` events.
Wire names use `local-planning:<kebab-name>`.
Read/run payloads are `{session:PlanningSessionRef,input:<the fixed query/command/ID>}`; availability
and enter take `undefined`; stop takes `{activityId:string}`. Leave takes `{privateEpoch:string}`
and returns `{exitId:string}`; confirmExit takes `{privateEpoch:string,exitId:string,outcome:'saved'|'discarded'|'blocked'}`
and returns void. `prepareExit={privateEpoch:string,exitId:string}` is sent only to enrolled windows.
All request results are `PlanningReply<T>`. `enter` returns `PlanningSession`; stop returns void.
Availability returns `{ready:boolean,reason:PlanningErrorCode|null,blockers:NativeBlocker[],privateEpoch:string|null}`
without profile IDs or private content. `changed` uses `PlanningChange` and refetches through authorization.
The epoch is main-issued and binds to the registered window, not a bearer credential. It survives host
changes for exit coordination; it grants no data read after the current scope generation is invalidated.

- [ ] **Step 1:** Add boundary tests: a registered main top frame succeeds; browser dock, chat/auxiliary
  window, subframe, destroyed/replaced renderer and forged principal/owner fields fail before decoding
  or reads. Validate generation mismatch, oversized input and malformed replies. Separate main
  request decoding from preload result decoding; no test merely repeats manifest/type coverage.
- [ ] **Step 2:** Add real Electron E2E cases for entry blocked by public activity; one authorized local
  window; host selection local -> remote -> local with old responses/events fenced; a second enrolled
  fixture window with its own draft ID; hidden view, failed draft flush, renderer crash and pending
  response during leave. Verify every data-bearing `WebContents` is destroyed before public admission.
  Exercise account A -> signed-out -> account B through production auth/host operations with an
  injected synthetic account transport. Assert unchanged principal/scope/project IDs and signed-out
  review release; mark live remote account transport untested. No production credentials are used.

  ```ts
  // Cases: sender-refused-before-decode, private-exit-destruction.
  assert.equal(rejectedSender.decoderCalls, 0);
  assert.equal(rejectedSender.projectReads, 0);
  assert.ok(exitTrace.lastPrivateRendererDestroyed < exitTrace.firstPublicAdmission);
  ```
- [ ] **Step 3:** Run each protected fixture file separately with `--maxWorkers=1`, then
  `bun scripts/project-planning-electron-e2e.ts --instance="$PLANNING_TEST_INSTANCE" --allow-mutations`. Expected RED: absent trusted endpoints/lifecycle.
- [ ] **Step 4:** Use `authorizedHandler` with registered main-window/top-frame checks before decoding.
  Main reads the selected host from the existing server manager; no payload establishes locality.
  Invalidate generations before `servers.select` begins, including failed/retried selection, without
  changing that released method's caller permissions. Derive local context only after private entry.
  Authorize again before returning a delayed response or forwarding a private event. No generic host
  snapshot, Team API adapter, channel capability or event broadcast receives these DTOs.
- [ ] **Step 5:** Register private data-bearing windows before delivering their first payload. Retain
  privacy across host changes and hidden views. Leave starts an exit ID and sends `prepareExit` to all
  enrolled windows. Each flushes planning and existing conversation/channel draft persistence or asks
  for explicit discard, then confirms the same exit ID/epoch. A blocked outcome, missing response or
  new edit keeps privacy and input; abort that exit and require a fresh exit ID for another attempt.
  Freeze edits during final acknowledgement so they cannot race confirmed saves. After every window
  confirms, fence all requests/subscriptions and destroy/recreate enrolled renderers through
  `main-window.ts` under a generic shell. Release public admission only after observed destruction,
  regardless of whether the last IPC reply reaches its old renderer. Do not merely reload a hidden
  private DOM. Auxiliary chat windows never gain planning authority.
- [ ] **Step 6:** Complete bridgeGroup result decoding and behavioral preview mocks in the same change.
  The preview mock exercises revisions, drafts, conflicts and gate transitions; it is not security
  evidence. Add safe localized errors in existing English source error catalogs, with no raw causes.
  The initial public shell does not restore a Work payload or draft before private admission.
- [ ] **Step 7:** Repeat boundary files/Electron E2E and `src/main/ipc-channel-coverage.test.ts` separately;
  add Electron selection to CI browser lane. Run changed-file lint, node types and renderer types in
  sequence, then commit `feat: expose protected local planning through trusted IPC`.

## Task 8: Accessible Work page and durable form drafts

**Files:** Create Work renderer/shared files from the map, plus
`src/renderer/stories/WorkPlanning.stories.tsx` and `scripts/project-planning-ui-e2e.ts`. Modify
`src/renderer/src/app-providers.tsx`, `src/renderer/src/features/servers/server-selection.tsx`,
`src/renderer/src/features/window/window-page-context.tsx`, `WindowPageView.tsx` in that directory,
`src/renderer/src/lazy-views.ts`, `src/renderer/src/WorkspaceShell.tsx`,
`packages/ui/src/features/window/PageRail.tsx`, `packages/ui/package.json`,
`src/renderer/src/styles/app-shell.css`, `packages/i18n/src/messages/en/app.ts`,
`packages/i18n/src/messages/en/work.ts` (new) and English catalog joins described in `docs/i18n.md`.
Read existing `src/renderer/src/features/conversation/composer-draft-storage.ts` and
`src/renderer/src/features/channels/channels-draft.ts`; expose their existing flush/discard behavior
to private exit only where necessary, without moving their storage into the planning domain.

**Interfaces:** `work-port.ts` exposes `Pick<OpenBotDesktopApi,'localPlanning'>` through an injectable
port. `WorkProvider` lives inside the keyed host scope; it owns one coherent store for admission,
pages, selection, forms/drafts, pending operations and errors. Add `beforeScopeExit():Promise<boolean>`
as a provider prop to the existing server-selection leaf so it can await draft save/discard without
an upward context import. `WorkPrivacyProvider` lives above the keyed scope, stores only epoch/exit
coordination and registers the current scope's flush callback through a provider prop; it retains no
project text. It also flushes existing composer/channel draft adapters before confirming exit.
Shared components receive typed views, form state and named callbacks.

- [ ] **Step 1:** Add UI E2E behavior: keyboard entry into Work, explicit privacy explanation/admission,
  create/edit project/milestone/ticket, manual status, review/decision, archive/restore, paged lists and
  draft recovery. Assert persisted values and zero provider/GitHub calls. Input survives validation,
  revision conflict, draft quota and failed save. A remote host shows only generic unsupported text
  and triggers no planning request. Keep existing Tasks navigation and Undo behavior working.
- [ ] **Step 2:** Add local -> remote -> local and two-window draft cases with delayed responses. Assert
  fresh generations, distinct drafts and no stale value after return. Test privacy exit while another
  window has dirty input: save all, explicit discard or stay private; no silent overwrite. Announced
  errors, labels, focus return and keyboard review actions are acceptance observations, not snapshots.

  ```ts
  // Cases: host-switch-draft, manual-review-offline.
  assert.equal(restoredDraft.form.title, unsavedTitleBeforeSwitch);
  assert.equal(currentHostState.containsStaleReply, false);
  assert.equal(activity.providerCalls + activity.githubCalls, 0);
  ```
- [ ] **Step 3:** Run `bun scripts/project-planning-ui-e2e.ts --instance="$PLANNING_TEST_INSTANCE" --allow-mutations`
  against a named worktree instance from `bun run dev:automation`. Expected RED: no Work flow.
  Reuse that instance. The script must verify worktree/profile identity before mutations and use
  disposable synthetic planning data; never drive another worktree's app.
- [ ] **Step 4:** Add the active-host Work page and a distinct rail item, preserving Tasks. The public
  entry explains that private mode blocks OpenBot screen/control and that leaving may recreate the
  window. Show current blockers and explicit stop/retry actions; never stop native work silently.
  Keep the stable local scope separate from account TeamStore IDs and guard all async results with
  the scope generation. Save drafts on blur/save/scope exit; preserve unsaved input on failures.
- [ ] **Step 5:** Build list/detail forms from existing shared controls, text-only rendering and brand
  tokens. Add `work.*` i18n keys through the English module/joins; optional translations follow the
  catalog rules without introducing literal UI text. Storybook uses the actual preview shell/mock,
  no copied navigation and no play functions. Add no `data-testid` or unit/component tests.
- [ ] **Step 6:** Repeat the focused UI script; collect report observations for keyboard, focus and
  errors plus optional visual artifacts outside Git. Select it in CI browser using a disposable named
  dev instance managed by the existing stack supervisor. Run changed-file lint and renderer types,
  then contracts/i18n package types only if changed. Commit `feat: add private local Work planning`.

## Task 9: End-to-end privacy evidence, CI selection and release handoff

**Files:** Add `scripts/project-planning/remote.ts` and final CLI/report verification; extend
`scripts/team-api-routes-e2e.ts`, `scripts/team-api-legacy-clients-e2e.ts`,
`scripts/team-session-revoke-e2e.ts`, `.github/workflows/ci.yml` and
`.github/workflows/cua-driver.yml` only for selected evidence wiring. Add
`plans/011-project-workspaces/s1-local-evidence.md`, `docs/architecture/local-planning.md`,
`changelog.d/project-workspaces-s1-local.md`; update `README.md`, `PRIVACY.md`, `docs/glossary.md`
and the S1 handoff with verified outcomes, not promises.

**Interfaces:** The CLI accepts exactly one `--group identity|files|admission|native|domain|reviews|remote`
or `--verify-report <path>`. Application groups (`files`, `remote`) require `--instance` and `--allow-mutations`;
native additionally requires `--isolated-display`. Report verification
requires the selected cases and evidence basis; service fixtures cannot certify Electron/native
behavior. Separate Electron/UI reports are required for the corresponding release gates.

- [ ] **Step 1:** Seed distinct canaries in goal, criteria, notes, saved draft and manual review evidence.
  Drive the real Team API server, released HTTP adapters and WebRTC event path; existing and newly
  invited members, owner/admin roles and revoked/reconnected sessions receive no project DTO/content
  through conversation/result/summary/memory/attachment/search/storage/instance transfer/events.
  Guessed planning routes/IDs keep the dispatcher/protocol/auth behavior. Existing non-project
  reverse actions still work. Include generated logs/support diagnostics and deny private copies.

  ```ts
  // Cases: derived-content-canaries, remote-event-absence.
  assert.equal(remoteResponsesContainAnyCanary, false);
  assert.equal(remoteEventsContainProjectMetadata, false);
  assert.equal(diagnosticsContainAnyCanary, false);
  ```
- [ ] **Step 2:** Run `bun scripts/project-planning-e2e.ts --group remote --instance="$PLANNING_TEST_INSTANCE" --allow-mutations`. Before guards, the overlapping
  file/capture canary reproducer must fail; after Tasks 2-8, expected PASS with real server artifacts.
  Add negative report copies missing a required case and falsely labelled native evidence; verification
  must exit 1. Run the owned-worker unexpected-exit injection and require a failed report/exit 1.
- [ ] **Step 3:** Wire identity/files/admission/domain/reviews/remote sequentially into existing CI
  `team-api-routes-e2e`, and focused Electron/UI plus Linux/X11 native evidence into `browser` under
  Xvfb. Upload `.openbot-build/project-planning/` on success or failure with no secrets. Existing
  `tests-desktop` selects migration/trust-boundary fixtures. Give `cua-driver.yml` a separate native
  test selection/dispatch path rather than calling install-only output a privacy pass. Do not enable
  unattended native tests on a desktop that has real user data.
- [ ] **Step 4:** Record exact tested runtime, native driver digest/version, OS and configuration. A native
  report on one OS/configuration cannot enable another. Keep platform admission support closed until
  its actual adapters/recovery pass; the implementation's reviewed platform-support mapping is main
  owned and not editable through IPC. Missing macOS/Windows native proof remains an explicit release
  blocker for those configurations, even when Linux CI passes. Full provider-shell confinement,
  real provider execution and remote account transport remain outside this evidence.
- [ ] **Step 5:** Write the evidence matrix linking each accepted-spec row to a task/report and mark
  unsupported/unverified surfaces explicitly. Document identity copy/loss, account independence,
  aggregate disk metadata, native-control exclusion, explicit private exit and OS limits. List the
  actual commands and narrow checks. Add release notes; do not bump a version or modify CHANGELOG.
- [ ] **Step 6:** Run only the newly changed focused group(s) and report verifier locally; do not rerun
  passing suites without a new concern. Run changed-file lint and affected type projects sequentially.
  Let CI perform broad checks. Commit `test: verify local planning privacy and release boundaries`.

## Coverage and execution handoff

| Accepted requirement | Implementation tasks | Required final evidence |
| --- | --- | --- |
| Owner continuity, restore, corruption and released schemas | 1, 5, 7 | Identity/account lifecycle, migration/parity and real IPC reports |
| Protected application data, including overlapping file roots | 2, 7, 9 | Actual transfer/export/remote canary reports with ordinary-file controls |
| Native visual/control exclusion and uncertain recovery | 3, 4, 7, 9 | Native per-platform and Electron reports; no fixture substitution |
| Revisions, idempotency, archive/restore and manual gates | 5, 6 | Crash/replay, two-window and persisted review history reports |
| Active-host Work, drafts, preview and accessibility | 7, 8 | Real UI/host-switch/keyboard observations plus preview consumer checks |
| No shared context, cloud content or released wire change | 7, 9 | Real server/event/derived-content negatives and unchanged reverse actions |

Self-review must verify every fixed action has a schema, handler path, domain implementation and
behavior case; every new endpoint has a preload decoder and preview implementation; every app-owned
file/native adapter has a named gate. Do not declare D2 established from source or documentation.
D1/D3 execution, remote project grants, conversation audience enforcement and GitHub remain blocked.

The earlier session selected native execution through `superpowers:executing-plans`; preserve that
method unless the developer changes it. The next step is developer review of this plan. Approval of
the design authorizes preparing this document, not starting feature implementation, push, merge or PR.

Document self-review covered specification rows, cross-task types, action/endpoint completeness,
failure tests and size. The account lifecycle proof belongs to the real app task; early native
probes use the production service boundary and require later Electron integration. The public/private
epoch is distinct from host generation so a host switch cannot strand private exit. These are plan
decisions, not claims that their implementation or native tests have passed.
