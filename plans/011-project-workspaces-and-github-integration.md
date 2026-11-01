# Plan 011: Project workspaces and GitHub integration

> **State**: TODO. Consolidated implementation roadmap; the developer selected the recommended solutions below. Dependent slices remain blocked by the required evidence and implementation decisions.
> **Prepared**: 2026-11-01, against local commit `7ddef1a3a3889033c5f770defbf4c4258594d2d2`.
> **Issue**: [design4pro/openbot#6](https://github.com/design4pro/openbot/issues/6).
> **Authorization**: this request prepares the plan only. It does not authorize implementation, provider writes, publication, or deployment.

## Goal and scope

Give a developer a persistent local project plan and a controlled path from a ticket to agent work,
its conversation, evidence, and milestone review. Local planning must work offline. GitHub is the
first external source, while task source, code repository, and execution target remain independent.

Use the existing host database, command/event/projection model, channel delivery, GitHub connector,
shared UI, and current authorization boundaries. A durable ticket describes work; an execution attempt
records one run. Neither replaces or changes the released meaning of `ChannelTask`.

This is an epic-level plan. The capability proof determines the implementable execution modes and
exact interfaces. Before each implementation slice, create its bounded technical design with exact
schemas, operation signatures, state transitions, test commands, and affected files. Do not invent
those interfaces before the proof, or begin all slices as one large change.

### Source documents and precedence

This file consolidates the revised recommendations in these prepared documents:

- [openbot-issue-6-product-spec.md](011-project-workspaces/openbot-issue-6-product-spec.md) - objective, experience, access, delivery, and acceptance.
- [openbot-issue-6-integration-spec.md](011-project-workspaces/openbot-issue-6-integration-spec.md) - persistence, execution, providers, recovery, and review resolutions.
- [openbot-issue-6-engineering-review.md](011-project-workspaces/openbot-issue-6-engineering-review.md) - implementation risks and evidence from existing code.

The source documents are versioned in [011-project-workspaces/](011-project-workspaces/).
The requirements needed to execute this roadmap are also included below. Related upstream
requirements are [#1373](https://github.com/nightly-labs/openbot/issues/1373) and
[#3502](https://github.com/nightly-labs/openbot/issues/3502). This planning pass did not refresh remote
issue state or revalidate provider documentation. Recheck the target branch and related work first.

The revised review-resolution sections take precedence over earlier stage tables in the prepared
specifications. This plan reconciles the minimal handoff and gate into the first executable slice.
Later routing/autonomy work must not become a reason to ship an unguarded manual start.

## Non-negotiable implementation constraints

- Keep project data, source snapshots, conversations, execution records, and files on the host.
- Preserve existing agent identity, sessions, histories, and unrelated working-tree changes.
- Follow the host command/event/projection transaction owner. Do not add a second database authority.
- Preserve every shipped database schema and released wire meaning. Add capability negotiation for new operations.
- Keep migrations and their markers atomic; update the separate fresh-database schema and parity history.
  Recovery cannot depend on an automatic backup, destructive downgrade, or a rewritten shipped migration.
- Enforce current authorization on reads and admission of new actions. Capabilities alone are not authorization.
- Worktrees and prompt instructions are not sandboxes. Disclose trusted execution modes and fail closed for
  any isolation or unattended-execution guarantee that the capability proof cannot establish.
- Reuse existing credentials through the host connector. Never pass credentials to model context, expose
  raw tokens to the renderer, or silently fall back to broader credentials.
- Assignment does not publish comments, move provider status, open a PR, or approve any external action.
- Preserve local notes separately from provider-owned fields. Never infer deletion from an incomplete scan or 404 alone.
- Put product text in i18n catalogs. Use shared accessible components, current Effect conventions, and typed boundary failures.
- Use focused checks under current `AGENTS.md`. Ordinary new tests are process/service/UI E2E scripts;
  protected migration, trust-boundary, and redaction tests use the permitted Vitest fixtures. If a slice
  requires another test policy, resolve that explicitly before writing it. Do not silently follow the
  source documents' blanket instruction to add unit tests.

## Selected product decisions

The developer selected the recommended solutions on 2026-11-01. These decisions set product direction;
they do not establish that existing code provides the required security or execution guarantees.

1. Require technically enforced project confinement for unattended agent work, including shell, network
   and MCP. Until the capability proof demonstrates confinement and stop boundaries, describe execution
   as trusted and do not enable unsupported autonomy or claim a hard gate. Worktrees alone are not isolation.
2. Use explicit project owner, member and agent grants. Only an authenticated human project owner may
   release a milestone gate; channel membership alone grants no project access. Verify the current identity
   model before implementing this authorization; if it cannot enforce these roles, resolve the gap first.
3. An authorized user or eligible agent may submit a milestone for review. Submission atomically closes
   admission for new work but does not decide that criteria are met. An authorized human reviews evidence,
   running and unresolved effects before deciding whether to continue or change the destination.
4. Start with an execution feasibility proof, followed by a local manual ticket-to-result and milestone
   review flow, then GitHub. Local planning remains possible without a provider. No autonomous execution
   until its admission, confinement and stopping guarantees are proven for the relevant mode.
5. On a crash or ambiguous external outcome, do not automatically retry or reassign. Surface the available
   evidence and reconcile; resume only once the previous worker is confirmed stopped and external effects
   are resolved. Lease expiry alone is insufficient.
6. Provide a shared Work area for projects and tickets and one GitHub Marketplace entry with dedicated
   settings. A project is independent of a channel. Validate names and placement against the current UI.
7. Initially support one optional repository per channel, one worktree per member and at most one active
   writer per worktree. Default to Keep when removing a binding; show offline push state as unknown. Defer
   multiple repositories and full inheritance to later work.
8. Deny unauthorized access to cached private provider data after revocation. Retain protected local history
   and notes until explicit deletion; do not automatically delete provider data. Establish specific cache
   retention and backup rules before persistent private-cache release.
9. Ship GitHub read-only first. For the first writable board, use an existing GitHub Project status field if
   access is verified; otherwise use explicitly configured label mapping. Require appropriate permissions
   and explicit configuration; display conflicts and partial or ambiguous results.
10. Choose Linear or Plane after the GitHub adapter; scope Jira separately. Treat migration as a separate
    opt-in release with preview, confirmation, collision reporting and no silent overwrite.

## Evidence and STOP conditions

| Gate | Decision or evidence required | Recommendation | Blocks |
| --- | --- | --- | --- |
| D1 | Execution mode inventory and verified action/stop boundaries | Admit only proven modes; technical confinement is recommended for unattended work | Any claimed hard gate, isolation, or autonomous execution |
| D2 | Authenticated project owner/member/agent grants; signed-out behavior; gate-release authority | Explicit project grants; channel membership alone grants no project access; authorized human releases gate | Project access and execution |
| D3 | Crash-safe handoff, surviving-process detection, claim fencing, and checkpoint protocol | Stable delivery intent plus durable reconciliation; lease expiry never proves termination | First manual execution |
| D4 | Navigation and settings placement | Shared Work area; one GitHub Marketplace entry and dedicated settings; project independent of channel | Shipped navigation and settings |
| D5 | Managed repository ownership, supported clone URLs, cleanup and write restrictions | One repository per channel; one active writer per member worktree; Keep by default | Repository provisioning |
| D6 | GitHub installation/user scopes, organization Projects access, permitted write approvals | Read-only first; one verified status mechanism before adding another | Provider-dependent operations |
| D7 | Cache access after revocation, retention, receipt lifetime, refresh and performance budgets | Deny unauthorized cache reads; retain protected local history; use measured bounds | Persistent private cache and production sync |
| D8 | Second provider and migration mappings | Validate Linear or Plane before freezing the common contract; Jira separately scoped | Second-provider and migration releases |

STOP a dependent slice when its gate is unresolved or a required control cannot be demonstrated.
Record the limitation and return a concrete narrower option for approval. Do not replace enforcement
with instructions to an agent. D1-D3 may be investigated without implementing the product. Do not
repeatedly ask for decisions already recorded by the developer.

## Existing ownership and intended change map

Paths below identify current owners, not permission to refactor whole modules. Confirm them against
the target checkout. New filenames belong in each slice design after ownership is verified.

| Area | Existing files or directories | Planned responsibility |
| --- | --- | --- |
| Host persistence | `src/backend/openbot-database.ts`, `src/backend/database/`, `src/backend/channel-store.ts`, `src/backend/channel-schema.ts` | Project events/projections, grants, attempts, claims, intents, receipts, gates, audit |
| Execution | `src/backend/channel-service.ts`, `src/backend/channel-history.ts`, `src/backend/channel-tools.ts`, `src/backend/mailbox-store.ts` | Stable handoff, scoped context, recovery, routing and stop acknowledgement |
| Contracts and adapters | `packages/contracts/src/ipc-chat-channels.ts`, `packages/contracts/src/ipc-endpoints.ts`, `src/preload/`, `src/main/ipc/`, `src/main/team-api/` | Additive validated operations, authorization, capability-gated remote access |
| GitHub | `src/main/github-connector-service.ts`, `src/main/github-rest.ts`, `src/main/github-connector-store.ts` | Existing identity/credential reuse, resource discovery and provider adapter |
| UI | `packages/ui/src/features/`, `src/renderer/src/features/channels/`, `src/renderer/src/features/settings/` | Shared Work views and platform controllers; source and execution states |
| Preview and tests | `src/renderer/src/preview/`, `src/renderer/stories/`, `scripts/`, relevant CI selections | Second IPC implementation, deterministic fixtures, E2E reports and real-provider smoke |
| Documentation | `docs/architecture/`, `docs/i18n.md`, `changelog.d/` | Ownership, compatibility, user-visible changes and privacy implications |

Read each directory's instructions before editing. No central cloud storage or new account-service
schema is planned. Desktop is the first implementation target; explicitly design web and mobile
capability behavior before exposing new host operations. An unsupported client must retain existing
channel behavior and receive a clear unsupported result rather than a reinterpreted contract.

## Domain and state contract

- **Project** owns goal, milestones, tickets, authorized grants, local knowledge, revision, and archive state.
  Section/channel bindings reference a project; they do not own it or copy credentials.
- **Ticket** owns local criteria, readiness, relations, assignment, notes and execution links. A provider
  snapshot owns its mirrored fields. Source status, ticket state, OpenBot assignment, and execution state are distinct.
- **External identity** is `(provider instance, object type, stable object ID)`. Account/installation
  bindings grant access and may change; issue number, URL and repository location are mutable display metadata.
- **Attempt** owns provenance, claim generation, delivery intent/reference, lifecycle, outcome and artifacts.
  At most one active claim per ticket, plus one active mutating execution per managed worktree.
- **Gate** owns project admission state, generation, review evidence, actor decisions and durable notification.
  Submission for review closes the gate atomically against concurrent claims. It does not prove acceptance.

| Attempt state | Allowed next state | Required evidence |
| --- | --- | --- |
| `intent_pending` | `dispatched` | Reconciler locates or creates exactly one delivery by stable intent ID |
| `dispatched` | `running`, `stopping`, `unresolved` | Confirm launch or expose ambiguity; do not redeliver blindly |
| `running` | `completed`, `failed`, `stopping`, `unresolved` | Record outcome or stopping/uncertainty evidence |
| `stopping` | `paused`, `cancelled`, `unresolved` | Verify worker termination and reconcile in-flight effects |
| `paused` | Authorized resume with fresh claim generation, or `cancelled` | Gate open, grants current, old worker stopped, old effects resolved |
| `unresolved` | Human-evidenced resolution to `paused`, `cancelled`, `completed`, `failed` | No automatic retry, reassignment, or new effect |
| `completed`, `failed`, `cancelled` | No restart of this attempt | Deliberate retry creates a new attempt ID and retains history |

A resume retains attempt identity and history but records the new claim generation; a new attempt is
reserved for deliberate retry of terminal work. The slice design must formalize transition receipts
and execution delivery linkage. Gate release never automatically resumes paused or unresolved work.

A start command atomically checks actor, grant, readiness and gate; acquires the unique claim; writes
attempt, canonical request fingerprint, delivery intent, event and receipt. Reject an operation ID
reused with another payload. Reconcile delivery outside that transaction only through its stable key.
Admit each new mediated effect against current grant, claim and gate generations. After closure or
revocation, allow only narrow audit recording of work already admitted, outcomes, and stop acknowledgement.
A stale process may still finish an external call; never imply fencing retracts that call.

## Delivery slices

Each slice has its own review and acceptance evidence. Checkboxes indicate implementation progress,
not approval of the recommendations. Do not mark a mock-only provider test as proof of real permissions.

### S0. Execution and authorization feasibility

**Depends on:** current code inspection. **Output:** evidence for D1-D3 and a bounded S1 design.

- [ ] Trace UI/tool/MCP/CLI start, shell, network, connector credential access, and subprocess survival for each proposed provider mode.
- [ ] Demonstrate principal and project-context propagation, revocation, action admission, stop request,
  verified termination, and restart with a surviving worker. List unrestricted paths and unsupported guarantees.
- [ ] Specify exactly which modes permit manual execution, hard-gated execution, or unattended work.
- [ ] Verify that the selected D1-D3 product decisions are enforceable; document remaining technical choices and design exact schemas, commands and event replay.

**Acceptance:** reproducible process-level report identifies admitted, running, stopping and unresolved
work at every tested boundary. No provider mode receives an unsupported isolation label. Failure blocks
execution, while a separately authorized local planning-only slice may proceed.

### S1. Local planning and one real manual execution

**Depends on:** D2 for scoped planning; D1-D3 before enabling execution; D4 for its UI placement.

- [ ] Add project/milestone/ticket and grant persistence through the host command/event/projection model.
  Add safe migration, fresh-schema parity, event replay, audit and request-fingerprint receipts.
- [ ] Add scoped list/detail/create/edit operations and UI with unsaved-input preservation, local notes,
  source-independent code context, and explicit eligible agent/channel selection.
- [ ] Implement one real ticket -> unique claim -> delivery intent -> existing channel execution -> outcome
  path, with duplicate-start opening the existing attempt. Include recovery and the minimal gate now.
- [ ] Implement review submission, durable in-app notification, gate decision, stopping/unresolved display,
  and explicit resume. Do not depend on an autonomous scheduler to enforce these rules.

**Acceptance:** offline create/edit/restart with zero provider calls; unauthorized mediated reads/writes
fail; two concurrent claims yield one winner; crash at every dispatch boundary yields one logical delivery;
reused key with different input fails; gate/claim race is serialized; gate survives restart; only the
confirmed authority releases it; outcomes remain recordable while closed; source histories are preserved.
Use a real temporary database and controlled worker process, plus Playwright for the whole user flow.

### S2. Managed repository context

**Depends on:** D5 and the relevant D1 authorization/enforcement evidence; independent of GitHub issue reads.

- [ ] Add one optional repository binding per channel, accessible connected repository or approved public
  clone URL, provisioning journal, managed clone and separate branch/worktree for each member.
- [ ] Provision joining members with progress and retry. Resolve collisions without reusing another
  member's work. Enforce the one-writer resource lease in addition to ticket claims.
- [ ] Validate managed paths and symlink boundaries. On unlink/removal present dirty, unpushed and unknown
  offline states; default to Keep. Delete only explicitly approved managed paths; preserve remote branches.

**Acceptance:** member join, collisions, interrupted provisioning, concurrent tickets, existing clone,
dirty/unpushed/unknown state, Keep/Delete and partial cleanup have repeatable process-level tests.
No unrelated directory is removed, no remote branch is deleted, and no automatic merge occurs.

### S3. GitHub read-only and source lifecycle

**Depends on:** S1 domain, D4, D6 read permissions, and D7. PR/Actions views may follow issue reads separately.

- [ ] Reuse the connector; add one enable/disable setting and dedicated configuration with effective
  source/repository references and origin. Keep task source independent of code repository.
- [ ] Add provisional host provider reads: resource identity/capabilities, pagination, typed failures and
  snapshots. No generic PR/Actions ticket abstraction and no duplicate token store.
- [ ] Persist query/filter/access scope, scan generation, cursor, freshness and completion. Preserve last
  good data after partial failure; distinguish inaccessible, missing and confirmed deleted records.
- [ ] Show issues with local overlay and original links, then GitHub-specific PR and Actions views.
  Deny unauthorized cached private fields after revocation; retain authorized protected local history.
- [ ] Disable stops new sync/actions, records and reconciles in-flight work, and keeps configuration and
  links. Disconnect is separate. Core local execution follows its own policy.

**Acceptance:** pagination, reconnect, reinstall/transfer identity, rate limiting, access loss, changed
filter, partial scan and disabled/disconnected states; read-only fixtures detect any attempted provider
mutation. Verify real scopes with a controlled GitHub account before claiming provider support.

### S4. External handoff, routing and opt-in autonomy

**Depends on:** S1, S3 for external tickets, and proven D1-D3 controls for every enabled mode.

- [ ] Link external tickets to the existing start command and its provenance; do not create a second dispatch path.
- [ ] Add eligible role routing and bounded opt-in scheduling under the same claims, resource leases,
  gate and approval checks. Findings and proposed splits do not authorize a direction change.
- [ ] Surface blocked, stopping and unresolved work, evidence and human decisions. On revocation/archive/
  unlink block new admissions and request stop without deleting active attempts or their history.

**Acceptance:** duplicate external start returns existing work; cross-project authorization and gate races,
queued-before-close starts, revocation during effects, failed notifications, terminal retry and explicit
resume are covered. No assignment implicitly changes GitHub. Unproven modes stay disabled for autonomy.

### S5. Local board and one controlled GitHub write mode

**Depends on:** S1 for local board; S3 and D6 write approval for GitHub; S4 for agent-originated writes.

- [ ] Deliver local status persistence and an accessible board/list before provider mutation.
- [ ] Select one verified status authority: existing GitHub Project single-select IDs, or explicitly mapped
  labels. Preview and approve new labels; preserve unrelated labels and expose Unassigned/Conflict.
- [ ] Persist write intent and observed outcome (`pending`, `in_flight`, `confirmed`, `failed`, `unknown`).
  Recheck access on admission. Reconcile partial or timed-out writes; never blindly repeat an uncertain create.
- [ ] Implement keyboard Move to, focus retention, actual-result announcements, non-color status and a
  narrow-screen alternative. Add optional SDLC.md preview and explicit creation without silent overwrite.

**Acceptance:** persisted local move, provider multi-call partial failure, concurrent edit, unknown result,
revoked access, preserved labels and actual permission failures. Test keyboard and responsive flows in
Playwright; manually check keyboard, zoom and a screen reader against WCAG 2.2. No durable card ordering
claim until a persistence mechanism is approved and tested.

### S6. Second provider, then migration

**Depends on:** D8, proven provider identity and supported operations. These are separate reviewable releases.

- [ ] Validate one real Linear or Plane adapter against the provisional contract. Keep source-specific
  capabilities visible; demonstrate that its tickets can use a GitHub code repository.
- [ ] Stabilize only the shared operations exercised by both providers. Scope Jira and other providers separately.
- [ ] Add opt-in migration preview with exact identity/field mappings, unsupported fields, permissions,
  collision decisions, per-item manifest, progress and safe resume. Never match by title alone.

**Acceptance:** source and code services coexist; unsupported fields are visible; timeout after creation
is reconciled; partial failures resume without duplicates or silent overwrite. Cancellation preserves
source data. Compensation is explicit and provider-dependent, not a promised transactional rollback.

## Cross-slice verification and release evidence

| Risk | Owning slice | Required evidence |
| --- | --- | --- |
| Surviving process after host restart | S0, S1 | Real worker survival and stop acknowledgement; no lease-only reassignment |
| Handoff crash and changed request payload | S1 | One delivery after each injected crash; fingerprint mismatch refused |
| Gate close or revocation during work | S1, S4 | New effects blocked; admitted outcomes/audit retained; unresolved effects visible |
| Two tickets sharing a member worktree | S2 | Durable one-writer exclusion until prior worker is verified stopped |
| Missing source item after permission/filter change | S3 | No false deletion; private cache access follows current authorization |
| Partial or unknown provider write | S5, S6 | Observed-state reconciliation; no blind retry or title-based deduplication |
| Old client or old local schema | Every affected slice | Released contract behavior, capability refusal, migration preservation and fresh-schema parity |
| Large lists and source bodies | S1, S3 | Measured pagination/windowing, on-demand bodies and bounded sync concurrency |

For each slice:

1. Read the current whole plan and directory instructions; inspect the target branch and preserve unrelated edits.
2. Record evidence for the selected gate decisions, exact changed paths and a failing behavioral reproduction before implementation.
3. Run the narrow E2E/service or permitted protected test; verify its expected failure, then its passing result.
   Save a repeatable JSON report and relevant screenshots under `.openbot-build/`.
4. Run changed-file Biome and the affected type project sequentially; update preview mocks, contracts and
   relevant CI selections. Leave repository-wide checks to CI under current repository instructions.
5. Attach relevant evidence and limitations to review, including manual accessibility and controlled-account
   results when applicable. Add a changelog fragment and architecture/privacy changes for delivered behavior.
6. Use the approved feature branch workflow and explicit push destination `HEAD:refs/heads/<branch>`.
   Publication, merge and deployment follow existing authorization; this plan grants none of them.

Set measured budgets before production acceptance: list page/window, in-memory snapshots, concurrent
refreshes, provider request rate, lease/checkpoint behavior and retention for cache, intents and receipts.
No arbitrary thresholds or retry loops are prescribed without evidence. Keep unresolved receipts long
enough to reconcile their effects; retention must not break idempotency.

## Deferred scope and completion

Multiple repositories per channel, full section/channel inheritance, automatic merges, arbitrary provider
plugins, a new sandbox platform, and cross-provider migration beyond validated mappings are not prerequisites
for the first local release. Complex hierarchy, separate decisions/findings UI and broader automation must
justify their own slices instead of expanding S1.

The epic is complete only when all approved slices have their acceptance evidence, current permissions
and threat-model claims are accurate, existing clients and data remain supported, and every remaining evidence gate has been satisfied or its dependent capability explicitly deferred. A completed roadmap document is not a completed feature.
