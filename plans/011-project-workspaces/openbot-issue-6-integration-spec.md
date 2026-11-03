# Project workspaces and integrations - architecture specification

Status: revised recommendation, pending product and security decisions, for issue [design4pro/openbot#6](https://github.com/design4pro/openbot/issues/6). No product decision or implementation is implied. Code observations refer to local commit `7ddef1a3a3889033c5f770defbf4c4258594d2d2`; recheck the target branch before implementation.

## Outcome and boundaries

A durable project workspace supports local plans and controlled execution even offline. A project ticket is persistent knowledge; a `ChannelTask` is one execution attempt linked to a conversation. Task provider, code repository and execution target are separate choices. GitHub is the first external provider; the shared contract remains provisional until exercised against Linear or Plane.

Existing evidence: `packages/contracts/src/ipc-chat-channels.ts` defines `ChannelTask` with channel, request, execution state and dependencies; `src/backend/channel-schema.ts` stores channel task projections. `src/main/github-connector-service.ts` supplies the existing connector. Reuse their supported mechanisms after checking their current guarantees; a projection is not by itself proof of a suitable transactional source of truth for claims.

## Domain and persistence

- `Project`: local ID, goal, policy, archive state and revision; has milestones, tickets, decisions, findings and artifact links.
- `Milestone`: project ID, acceptance criteria, state and gate generation. `Ticket`: project and optional milestone IDs, title, criteria, readiness, role/agent target, parent and related links, revision. Decisions and findings record author, time, source, and relevant scope.
- `ExternalRef`: provider instance, provider object ID, object type, display key and URL; connection and installation are separate access bindings. IDs must be scoped by provider instance, never deduplicated solely by issue number, URL, account or installation. Keep provider fields as a separate snapshot, with last successful sync and an explicit unavailable/deleted state.
- `Execution`: ticket ID, attempt ID, target channel/agent, `ChannelTask` reference when applicable, claim generation, state, timestamps, outcome, conversation and artifact references. Multiple historical attempts are permitted; at most one active claim exists per ticket. Agent assignment, execution state and provider assignee/status are independent.
- Store local notes and relations separately from provider-owned fields. Define migrations with foreign keys, uniqueness and transactional updates in the existing host database architecture; test fresh and upgraded schemas and recovery without assuming an automatic backup exists before selecting exact tables. Avoid migrating or rewriting existing channel histories.

## Authority and synchronization

Each project chooses local authority or an external authority. Local mode performs no provider calls. External read-only mode stores a provider snapshot and local overlay; provider-owned fields cannot be edited locally. Optional write-back is an explicit per-project capability, subject to existing authorization and approval, not a side effect of assignment. Local notes never silently overwrite provider data.

Refresh on explicit user request, initial connection and reconnect, plus a bounded, configurable schedule only if approved in product design. Treat webhooks as hints, not a complete log. Page through provider results, retain the last good snapshot on partial errors, record per-source freshness and do not infer deletion from absence even after a complete scan: a changed filter, scope or permission may hide an item. Mark it unavailable until deletion is independently confirmed. Show stale, partial, unauthorized, disconnected, rate-limited and failed states. Do not log credentials or issue contents unnecessarily.

Migration is a separate, opt-in operation: preview source-to-destination mappings, unsupported fields, conflicts, proposed creations/updates and permissions; record a mapping manifest and explicit confirmation before writes. Execute with durable per-item progress, resume safely, and expose partial outcomes. Never overwrite an existing remote record based only on matching titles. A timeout after a remote write is an unknown outcome: reconcile against provider state before any retry, and require review where identity cannot be established.

## Provider contract and GitHub mapping

Host-side adapter inputs and outputs are validated at the provider boundary. Expose paginated discovery and reads, provider identity, capability and permission status, and optional operations such as status change. Capabilities are evaluated per connection/resource, can change, and must be rechecked on action; a capability is not authorization. Return typed failures for authentication, permission, rate limit, unavailable resource, conflict and unknown write outcome. Do not force GitHub PRs or Actions into a generic ticket type.

For GitHub, map an issue by GitHub instance and stable issue node ID, with installation/account as an independent access binding; keep repository, issue number and canonical URL as display/context. Map milestones, comments, relations and Project items only where supported; report unmapped fields. Show PRs and Actions as GitHub-specific views and artifacts. Reuse the existing connection and credentials rather than storing another token. Verify actual GitHub App installation and user-token scopes and organizational Projects access before promising individual operations.

A board selects one authority: local status, a configured GitHub Project single-select field, or an explicit mapping of repository labels. Project items require project/item/field/option IDs. GitHub documents separate add-item and update-field calls; it does not promise a single atomic operation for both. Label mode changes only mapped status labels, preserves others, and displays unmapped or multiple mapped labels. Treat multi-call updates as non-atomic: reread after each failure or ambiguous result, show observed state, and require resolution when concurrent changes cannot be distinguished. A preflight read cannot guarantee compare-and-swap; do not promise conflict-free writes without provider support. Do not claim persisted card ordering without a defined store.

Sources: [Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects), [label API](https://docs.github.com/en/rest/issues/labels), [GitHub App permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps).

## Scope, claims and milestone gate

The host authenticates the caller and checks project/milestone membership and action permissions on every storage and tool operation. Project-scoped agents access only granted project/milestone data; cross-project access is an explicit grant. Writes are limited to assigned work and existing policy. Context injection selects only authorized, relevant records; external content is untrusted data, never instructions that override policy. Agent credentials are never placed in model context.

Claim and gate checks occur in the same durable database transaction: verify ready ticket, authorization and open project gate; atomically acquire the unique active claim and increment its fencing generation; persist execution intent. A competing claim fails with the existing attempt. A retry uses the same operation ID and payload; a reused ID with different input is rejected. Before admitting new work or an external effect, verify the current claim generation, gate and authorization. Permit narrowly scoped audit recording of completion, stopping acknowledgements and unknown outcomes after gate closure or revocation; such recording cannot restart work. Lease expiration alone does not prove a worker stopped: revoke/fence the old generation, request cancellation, and reconcile any in-flight external effect before reassignment. Existing external calls cannot necessarily be fenced; their outcome may remain unknown and must not be automatically repeated.

Persist gate closure and generation transactionally with the claim check. Closure blocks new claims from every agent, including cross-project agents, and requests safe pausing of active work at defined checkpoints. Already in-flight effects may finish; record and show their outcomes and wait for acknowledgement or mark them unresolved. Do not promise instantaneous interruption or rollback. Only an authenticated developer with authority may approve continuation or adjust the destination; record actor, decision and time. The gate survives restarts. Developer notification must be durable, visible and retryable; choose destination before implementation.

Autonomy is opt-in and bounded by the same claims, scope, gate and approval policies. Findings and proposed splits can be recorded within assigned permissions; direction changes require a developer decision. Assignment alone produces no external comment, status change or PR.

## Configuration, execution and worktrees

Connection credentials and available resources belong to the host/server. Section defaults and channel overrides are references, not copied credentials; inherited values show their origin. Task source and code repository are independently optional. One repository per channel follows #3502; multiple repositories and the exact inheritance model remain explicit decisions, not prerequisites for local projects.

For repository-enabled channels, select an accessible repository or public URL, clone once into managed storage and provision a distinct branch and worktree per member, including new members. Resolve branch-name collisions without reusing another member's work. Validate paths and enforce write confinement at execution/tool boundaries; a working-directory setting alone is not a security boundary. Record provisioning state so failures and interrupted cleanup can be retried without touching unrelated directories.

On unlink or member removal, inspect dirty and unpushed work and present affected paths/branches and Keep/Delete choice. Keep is the safe default; deletion is explicit, restricted to managed local worktrees, and never deletes remote branches or automatically merges. Specify clean worktrees, offline inability to establish remote push state, existing clones, concurrent tasks and partial cleanup in the implementation design.

## Delivery and verification

1. **Local project foundation and gate (split as specified in the revised delivery sequence below):** schema, local CRUD, scoped tools, audit, atomic claim, recovery and durable gate. Acceptance: fully offline flow; parallel claims produce one winner; restart retains gate and claim; unauthorized reads/writes and non-developer release fail; active worker pause and unknown effects are visible. Unit and concurrent integration tests.
2. **Repository context (after the execution feasibility gate):** channel picker and one repository, separate worktrees, lifecycle and cleanup; worktrees alone do not provide security isolation. Acceptance: each member has a separate writable worktree; joining provisions it; collisions, failures, dirty/unpushed state, offline checks and Keep/Delete are covered; remote branches survive. Integration and Playwright tests.
3. **GitHub read-only:** existing connector, extension enablement, source selection, local overlay and issue/PR/Actions views. Acceptance: pagination, partial permissions, stale/reconnect and disabled states; no writes; original IDs/links preserved. Provider contract tests with recorded fixtures plus Playwright. Verify actual permissions with a controlled GitHub account.
4. **Extended handoff and opt-in autonomy (the minimal real handoff belongs in the local vertical slice):** durable ticket-to-execution provenance, routing, idempotency, gate enforcement and visible results. Acceptance: duplicate start returns existing attempt; crash, cancellation, fencing and cross-project gate races are exercised; no implicit GitHub mutation. Unit, concurrent integration and Playwright tests.
5. **Board and controlled writes:** local board, then selected GitHub Projects or labels according to available permission and approved scope. Acceptance: keyboard Move to, retained focus and announcements, narrow-screen operation, persistence after refresh, unrelated labels retained, partial failure/unknown outcome and concurrent edits visible. Unit, provider integration, accessibility and Playwright tests. `SDLC.md` remains optional with preview and explicit creation, never overwrite.
6. **Second provider and migration:** implement one of Linear or Plane against the provisional contract and test actual capability differences before stabilizing it; migration preview and resumable, non-destructive operation. Acceptance: different task source and GitHub repository coexist; unsupported fields and per-item failures are visible; no silent overwrite.

Each slice is independently reviewable, adds meaningful unit and end-to-end coverage appropriate to its delivered UI, and passes current project checks. Recheck existing upstream work and authorization rules before coding. Avoid introducing an abstraction solely for a hypothetical provider.

## Decisions needed before dependent work

1. Roles and exact authorization source; developer identity, gate-release authority and notification destination.
2. Claim lease duration, worker cancellation/checkpoint protocol and recovery for unknown external effects.
3. Initial repository scope and whether section/channel inheritance and multiple repositories are in scope for that slice.
4. GitHub App permission changes and organization Projects feasibility, board mode priority and explicit write approvals.
5. Sync cadence and retention, conflict policy, migration field mappings and selection of second provider.
6. Navigation and Marketplace category, exact autonomy controls, and safe worktree ownership/cleanup rules.


## Review resolutions and recommended implementation contract

The following recommendations refine the sections above. They do not imply that security controls or provider permissions already exist. Where implementation cannot meet an invariant, the dependent capability stays disabled and its limitation is visible.

### Release order and feasibility gate

0. Inventory execution paths for each agent/provider mode: OpenBot tools, MCP, shell, network, subprocesses, credentials, host restart and surviving processes. Run a bounded proof of interruption, scope propagation and enforcement. Record which operations are mediated, stoppable and verifiably stopped. Fail closed for autonomous or project-isolated execution where the required control cannot be demonstrated. A worktree or a prompt is not an isolation mechanism. Technical isolation of shell, filesystem and network requires a separately validated sandbox and a product decision; until then describe any unconfined mode as trusted, do not claim project isolation, and do not run it autonomously under the hard-gate guarantee.
1. Deliver a local list and project details, goal, one milestone and tickets, with explicit scoped access. Then deliver a real single-target ticket -> claim -> existing execution -> recorded result vertical slice. A manual start must not bypass duplicate protection; include durable handoff and recovery with the first executable slice.
2. Add role routing and durable milestone review, then opt-in autonomy only after gate enforcement and isolation feasibility are demonstrated. Manual planning remains usable without them. Repository worktrees and GitHub read-only are independently reviewable follow-ups; PR and Actions views can follow issue reads. Local board, one chosen GitHub status mechanism, second provider and migration are separate releases. These priorities are recommendations pending product approval.

### Atomic handoff and execution states

Use the existing host-owned SQLite command/event/projection transaction model. A command atomically checks grant, ticket readiness, gate and unique active claim; writes the claim, attempt, request fingerprint and a uniquely keyed delivery intent; and records events and command receipt. A reconciler creates or locates the existing execution delivery using the stable intent ID, then records the delivery reference. If the existing channel API cannot honor a stable idempotency key atomically, extend that host boundary before enabling the handoff. Reject the same key with a different fingerprint. Define event payloads and projection rebuild for all invariants; test upgraded and fresh databases and replay.

| State | Allowed transition and actor | Recovery / restriction |
| --- | --- | --- |
| `intent_pending` | Host dispatches idempotently to `dispatched` | Restart reconciles by stable delivery ID; never create a second logical attempt. |
| `dispatched` | Host confirms worker start -> `running`; cancel -> `stopping` | Check an existing or surviving worker before redelivery; an ambiguous launch becomes `unresolved`. |
| `running` | Completion -> `completed` or `failed`; gate close, revocation or cancel -> `stopping` | Claim generation guards new effects; persist received outcomes even if admission is now closed. |
| `stopping` | Confirmed stopped -> `paused` or `cancelled`; unknown effect/process -> `unresolved` | A stop request is not proof of termination. Show outstanding process and effects; do not reassign. |
| `paused` | Explicit authorized resume creates a fresh claim generation after gate opens; cancel -> `cancelled` | Check old worker stopped and prior effects reconciled first. |
| `unresolved` | Authorized human records evidence and resolves to paused, cancelled, completed or failed | No automatic retry, reassignment or new external effect while uncertainty remains. |
| `completed`, `failed`, `cancelled` | Terminal attempt; a deliberate new attempt uses a new ID | Existing history remains visible; reopening a ticket never rewrites a terminal attempt. |

Lease expiry requests investigation and fencing; it is not evidence of death. Admission is checked at the host-controlled boundary immediately before each effect. A started external process or network call may outlive revocation and is never assumed rolled back. Resolve unknown outcomes with provider state and explicit human review where necessary. Ticket archive, source unlink or permission revocation blocks new actions and requests stopping; preserve history and do not delete an active execution. Reopening a ticket is an explicit authorized change and does not reopen a closed gate.

### Gate and authorization

An authorized user or assigned agent may submit a milestone for review, with evidence and a snapshot of acceptance criteria; submission atomically closes the project gate against concurrent claims. It does not assert criteria are satisfied. A developer reviews the criteria, completed work, stopping/running work and unresolved effects, then explicitly approves continuation or changes the goal. Gate remains closed after restart and while notification is undelivered; a durable in-app item is the recommended notification, with retry and delivery state. Existing running work receives a stop request, remains `stopping` until verified, and can record its outcome. Claims queued before closure do not start while closed. Gate release does not automatically resume paused or unresolved attempts.

Recommend an owner/admin who creates projects and grants access, authorized human project members, and agents granted project or milestone access and assigned actions. Channel membership alone grants no project access. Grant changes and release decisions are audited. Derive human identity from the existing authenticated host principal; verify actual owner/admin and local signed-out semantics before defining authorization rules. Default deny when identity, scope or current claim is unavailable. Propagate principal, project, ticket, attempt, claim and gate generations through every mediated operation; verify at reads and just before actions, including existing tools and MCP routes. Inventory unrestricted routes and do not present a policy-only rule as a technical boundary. On revocation block new admissions, cancel active work, restrict cached data and mark uncertain effects until reconciled.

### Identity, cache, sync and writes

A provider object is identified by `(provider instance, object type, stable object ID)` independently of the current account or installation. Connections are access grants, not identity namespaces. Preserve aliases, repository location and display number as mutable metadata; on transfer or reinstall reconcile through the stable ID when accessible. Different GitHub instances remain separate. An inaccessible object is not treated as deleted.

Record source, query/filter, permissions scope, scan generation, pagination cursor and completion status. A partial scan retains its last successful snapshot and reports partial freshness. A complete scan proves only membership in that exact visible query. Explicitly confirmed deletion may be shown as deleted; a 404 or missing list entry alone can mean lack of permission. Keep local ticket history and notes on unlink, archive or deletion; block unauthorized viewers and agents from cached private provider fields after access loss. Retention, encryption and user-controlled removal require a separate agreed policy; do not promise secure erasure from backups.

For writes persist intent and status (`pending`, `in_flight`, `confirmed`, `failed`, `unknown`) and the observed provider result. Verify scopes and actor authorization again immediately before admission. On timeout or crash reconcile; do not blindly retry a possibly completed create or multi-step label change. Present evidence and explicit resolution for ambiguous results. Disable stops new sync and integration actions; in-flight calls may finish, are recorded and reconciled, and configuration and links remain. Core local project execution continues under its own policies. Account disconnect is separate.

A shared work view aggregates projects from different sources; each project retains its own selected authority and source identity. Local notes remain separate from provider-owned fields. Local-to-external migration requires preview, explicit consent, a per-item manifest, resume and no silent overwrite.

### Worktree, interface and verification

Initially allow one repository per channel and at most one active mutating execution per managed worktree, enforced by a durable resource lease in addition to the ticket claim. Confirm prior process termination before reuse. Journal provisioning and cleanup; operate only on validated managed paths, reject symlink escapes, and preserve remote branches. Inspect dirty and unpushed work; offline or unknown push status is explicitly unknown. Default to Keep and show paths, state and partial cleanup before an explicit Delete. Public clone URL protocols, host restrictions, redirects and credential handling require security review before enabling.

Use one workspace view aggregating projects; section/channel context is an optional binding, not project ownership. Clearly distinguish ticket, execution attempt, source status and OpenBot assignment. Show source, last successful sync and stale, partial, denied or offline state. On gate review show stopping and unresolved work without implying it has stopped. Board move has a keyboard action, visible focus, announcement of actual result and a narrow-screen alternative; no result is declared successful before confirmation. Manually test keyboard and screen reader as well as automated accessibility checks.

Per slice verify invalid transitions; concurrent claims and gate races on a real temporary database; process survival and crash at each handoff boundary; duplicate delivery and payload mismatch; revocation and gate closure during an effect; replay, migration and restart; pagination and changed permissions; partial/unknown GitHub writes; managed path safety and concurrent worktree use. Use Playwright for shipped user flows and controlled-account GitHub tests for real permissions. Honor repository test policy as well as user requirements; resolve conflicts before implementation. Measure list and sync behavior with representative large fixtures, set page, memory, concurrency and receipt-retention budgets before calling the feature scalable; no arbitrary values are asserted here.

### Decisions remaining

The recommendations for local-first sequencing, human/agent review submission and in-app notification need product approval. A user decision is required on whether technical isolation across shell and network is a release requirement; evidence from the feasibility spike determines available modes. Product and security must agree exact grants, cache retention after revocation, external-write approvals, provider permissions, and the supported GitHub board mode before their dependent releases. Do not infer any of these approvals from this document.
