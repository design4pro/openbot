# Project workspaces - product specification and delivery plan

Status: Revised recommendations for review, 2026-11-01

Source: [design4pro/openbot#6](https://github.com/design4pro/openbot/issues/6)

Repository reference: local checkout `7ddef1a3a3889033c5f770defbf4c4258594d2d2`; reassess against the target branch before implementation.

## Objective and assumptions

A developer can maintain a durable project plan, connect work to agents and channels, and inspect results across conversations. GitHub is the first external tracker and code integration; local projects work without a connected service. A ticket source and a code repository are separate choices. The local `ChannelTask` contract describes execution states; a project ticket has a longer lifecycle and links to executions rather than replacing them.

This is a proposed specification, not an assertion that the behaviors exist. Stage order follows #6. A usable manual local workflow precedes autonomous scheduling; an execution enforcement spike precedes any promise of a hard gate. Autonomy and external write-back are opt-in. No implementation or publication is authorized by this document alone.

## Capability map

| ID | Responsibility | Dependencies |
| --- | --- | --- |
| project-knowledge | Local goals, milestones, tickets, notes and relationships | Existing persistence and authorization |
| agent-execution | Scope, roles, claims, execution links, milestone gate and opt-in loop | project-knowledge, existing channel execution |
| channel-repository | Repository selection and member worktrees | Existing channels, GitHub connection and host filesystem |
| github-read | Extension settings, read-only tracker and code views | project-knowledge, existing GitHub connector |
| board-write | Accessible boards, provider status changes and controlled write-back | github-read, project-knowledge |
| provider-validation | Validate common capabilities with a second provider | github-read, board-write where relevant |

`channel-repository` can be developed independently after its authorization and data-safety design is reviewed. The gate and claiming rules must be complete before autonomous execution. This map is a planning proposal, not a commitment to new package boundaries.

## Product model and flows

- A project has a goal and milestones; each milestone has acceptance criteria and tickets. A ticket has an identifier, title, description, acceptance criteria, status, role or agent assignment, relationships, findings, decisions and artifact links. A ticket may have multiple execution attempts and each attempt links to its channel/conversation and outcome.
- The developer creates a local project and milestone, adds a ticket, and explicitly starts it for an eligible agent or channel. Its execution state and ticket status are displayed separately. Starting it does not publish a comment, change a GitHub status or create a PR.
- A project-scoped agent accesses only authorized project or milestone context. A cross-project role can access explicitly authorized projects. Authorization is enforced at the data and tool boundary; labels and prompt instructions alone are insufficient. The UI exposes who has access and why.
- A ready ticket can have at most one active claim. A claim is durable and atomically checked with the milestone gate. If a process fails or a lease expires, recovery must not silently launch a second worker while the first can still perform writes. Surface an uncertain state for reconciliation and require an explicit safe retry. Proposed lease duration and fencing mechanism are technical decisions to validate.
- The milestone gate persists independently of the UI and prevents new claims when an authorized user or eligible agent explicitly requests milestone review; acceptance criteria are evidence for human review, not automatically judged complete. Request that already running work stop at a verified safe checkpoint; while stopping, display it as stopping and block new claims. If stopping cannot be verified, show an unresolved state and do not promise the process or external effects have stopped. Permit audit recording of already-started effects even while the gate is closed. Only an authorized developer can approve continuation or adjust the goal. Restarting the host must not release the gate. The exact authorization mapping and definition of safe checkpoints need design validation before autonomy ships.
- The opt-in loop chooses an eligible ready ticket, records the claim, runs within existing permissions, records findings and outcome, and continues only while the project is ungated. Blockers and proposed changes of direction go to the developer. Notifications identify the project, milestone and action needed.

## Sources, settings and GitHub

Local-only is the default and makes no provider calls. When connected, the tracker remains authoritative for mirrored fields; OpenBot maintains an identifiable local overlay for working notes. Display source, original identifier, link, last successful refresh and errors. Read-only mode never writes to the provider. Optional two-way mode must disclose its permitted operations, retain existing approval rules and reconcile conflicts. Local-to-provider migration requires a preview, explicit confirmation and collision handling; never silently overwrite.

Use the existing GitHub connection rather than requesting another credential. An extension can be enabled or disabled in Marketplace with a dedicated settings view. Disabling it stops its synchronization and hides its features while preserving configuration and links; disconnecting an account is a separate action. A shared Work area exposes tasks and a related Code view for repositories, PRs and Actions. Navigation labels and Marketplace category remain open design decisions.

Server access determines available sources and repositories; section defaults may be inherited or overridden by a channel. Show the effective setting and its origin. A channel may have no repository. Multiple repositories per channel and inherited configuration are proposed extensions beyond upstream #3502 and require validation. Do not equate GitHub assignee with OpenBot ownership or an issue status with an agent run state.

## Channel repository lifecycle

Offer connected repositories and a public URL in channel settings. Provision one channel clone and a branch/worktree for each member, used as that member's channel working directory. A joining member is provisioned with visible progress and retry on failure. Enforce access at the host boundary; a working-directory setting alone is not isolation.

On member removal or unlink, inspect and show uncommitted and unpushed changes. Offer Keep or Delete explicitly for affected worktrees, preserve remote branches, and report partial cleanup. Do not auto-merge. Before implementation decide ownership and cleanup for retained worktrees, behavior for clean worktrees, existing clones, branch collisions, concurrent operations and provisioning failures.

## Board and accessible interaction

Support the selected GitHub Project status field where permissions allow, or an explicit mapping to repository labels. Creation of labels requires a preview and user approval. Show no mapped label as Unassigned and multiple mapped labels as Conflict. Moving a card changes only mapped status labels and preserves unrelated labels; after partial failure or concurrent edits, reread provider state and show the actual result and recovery action. Do not promise persisted ordering without a defined store.

Provide keyboard-accessible Move to, focus retention and screen-reader announcements, plus a narrow-screen list or column selector. Status uses text as well as color. Test delivered flows against WCAG 2.2. Offer an optional `SDLC.md` preview and explicit creation; never overwrite an existing file silently.

## Acceptance scenarios

1. With no service connected, a developer creates a goal, milestone and ticket, restarts OpenBot, and sees the same local plan; the workflow performs no provider network requests.
2. Two eligible agents attempt to claim the same ready ticket concurrently: exactly one succeeds. Restart, expired claim and duplicate request cannot create concurrent active work. An uncertain worker is visible and cannot be silently retried.
3. An unauthorized agent cannot read or mutate another project's ticket through any supported project UI or mediated agent tool; shell and network isolation are not claimed until separately implemented and verified. A role assignment resolves only to an authorized eligible agent.
4. When a milestone reaches review, a concurrent new claim is denied, running work reaches a safe checkpoint, and the gate survives restart. Only an authorized developer can release it; other agents see a denied action.
5. A member joins a linked channel and gets an independent worktree. Removing a member with uncommitted or unpushed work offers Keep / Delete and preserves remote branches. A failed provision or cleanup is visible and recoverable.
6. With GitHub in read-only mode, issues, PRs and Actions display source and refresh status without writes. Loss of access to one repository does not hide accessible repositories. Disconnect, stale data and rate-limit or network errors offer an appropriate recovery.
7. Starting an issue for an agent creates a traceable local execution; repeating the request exposes existing work. GitHub assignee and issue status remain unchanged. The result links to the conversation and any produced artifact.
8. A board move works with keyboard and pointer, persists after refresh, preserves unrelated labels and surfaces conflicts or partial failures with the actual provider state. Focus and announcements remain useful on narrow screens.
9. Migration and write-back are disabled until configured; preview and approval precede migration, and provider operations respect existing approval and confinement rules.

## Delivery plan

| Stage | Outcome | Dependency and verification checkpoint |
| --- | --- | --- |
| 0 | Confirm current code, permissions, data ownership and authorization; resolve gate and claim safety design | Review existing channel execution, GitHub connector and persistence against current branch. Document migration and rollback strategy. |
| 1 | Local project knowledge, manual assignment, scopes, exclusive claims and durable gate | Unit/integration tests for offline behavior, authorization, concurrency, crashes and gate; Playwright for project creation and review. No autonomy until gate is verified. |
| 2 | Channel repository selection and member worktrees | Unit/integration and E2E tests for lifecycle, isolation, dirty/unpushed work, retained data, failures and cleanup. Can proceed independently of stage 1. |
| 3 | GitHub extension and read-only issue, PR and Actions views; local overlay | Reuse connector. Verify permission boundaries, pagination, reconnect, partial access and no writes; Playwright settings and browsing. |
| 4 | External-ticket handoff and opt-in autonomous execution | Stages 1 and 3. Verify provenance, idempotency, concurrency, gate, safe stopping, audit trail and existing approvals end to end. |
| 5 | Accessible board and optional controlled provider writes | Stage 3; stage 4 for agent-originated writes. Test Project permissions, label conflicts, partial writes, refresh and keyboard/screen-reader paths. |
| 6 | Second provider, migration and hardening | Validate real provider capabilities before generalizing; ship migration only after preview, collision and rollback tests. Linear or Plane first; Jira separately scoped. |

Split each stage into independently reviewable changes. Test concurrency and authorization at the service/storage boundary, integrations against deterministic provider fixtures, and user-visible flows with Playwright. Add real-provider and desktop smoke checks where mocks cannot establish actual permissions or worktree isolation. No coverage percentage or performance target is invented here; establish baselines before setting budgets.

## Decisions required before implementation

- Who qualifies as the developer authorized to release a gate; how active agent work reaches a safe checkpoint; claim lease and fencing strategy.
- Actual GitHub App scopes and organization Projects support, sync cadence, rate limits and conflict handling.
- Navigation and extension category; whether section inheritance and multiple repositories are in the first release.
- Autonomy controls, notification destination, and existing approval policy for each kind of external write.
- Migration identity mapping, duplicates, partial failure recovery and whether/when local overlay notes may be published.
- Provider-specific status mapping and ordering; project success and performance measures after baseline measurement.

## References

- [Epic #6](https://github.com/design4pro/openbot/issues/6)
- [Autonomous steering #1373](https://github.com/nightly-labs/openbot/issues/1373)
- [Channel repository and worktrees #3502](https://github.com/nightly-labs/openbot/issues/3502)
- [Channel board #4247](https://github.com/nightly-labs/openbot/issues/4247) and [organization Projects access #3438](https://github.com/nightly-labs/openbot/issues/3438)
- [Existing channel contract at the inspected revision](https://github.com/design4pro/openbot/blob/7ddef1a3a/packages/contracts/src/ipc-chat-channels.ts)


## Review revisions - recommended product decisions

These are recommendations, not user-approved policy. The architectural specification and implementation must be reconciled against these decisions before their dependent slices ship.

### Experience and project authority

Use a shared **Work** entry with project list, task list and task detail; reserve **execution attempt** for an individual run, and show OpenBot assignment separately from provider assignee. Marketplace exposes one GitHub entry with an Extensions classification and a dedicated configuration panel. Validate naming and existing navigation before implementation. A project exists independently of any channel; section and channel configuration references it and shows inheritance or an explicit override. Channel membership never automatically grants all project access.

Each project has one authority for a given provider-owned ticket field. A combined Work list can aggregate multiple authorized projects and providers without mixing their authority. Every row shows provider, project/repository, stable display identifier, original link and last successful refresh; filters include source, project and status. PRs and Actions are linked GitHub-specific views, not generic tickets.

Default to local plans and a manual start. The first useful path is create project and milestone -> create or edit ticket -> choose permitted agent or channel -> review context -> start -> inspect attempt, conversation, artifacts and outcome. If active work exists, open that attempt; an ambiguous result presents the observed evidence and a reconciliation action, not a blind retry. Initial creation, empty, loading, offline, partial access, revoked access and error states each explain a next action and preserve unsaved form input.

### Access, retention and trust

Recommend an explicit project owner/developer grant that controls project settings, memberships and milestone release, plus member and agent grants limited to their required operations. Use the existing authenticated OpenBot identity and authorization mechanism only after its capabilities have been established; if it cannot distinguish authorized users, gate-release and multi-user permissions cannot ship as enforced features. Show effective access and source; revoke mediated reads and new actions immediately and request cancellation of running work. Record actor, decision and outcome without retaining unnecessary sensitive content.

After external access is revoked, deny agents and users without an independent valid authorization access to the cached private snapshot. Preserve local notes and execution history in protected storage unless the user explicitly deletes them; distinguish inaccessible, deleted and unverified source records. Archiving hides a project from active work and stops new scheduling but keeps records and does not delete upstream data. Disabling the extension stops synchronization and hides provider-specific views; authorized local project history remains accessible with a disabled-source indicator. Disconnecting credentials is separate. A deletion flow must enumerate affected local data and require confirmation; no implicit remote deletion.

Worktrees separate branches and working directories, but do not alone sandbox shell, network, Git or MCP. Recommend enforceable per-project confinement across every supported execution path, with least-privilege credentials, no broader-token fallback, and tested revocation. Treat this as a release prerequisite for any claimed technical isolation. Until the enforcement spike demonstrates that property, label agents as trusted and do not advertise confinement or enable unattended execution requiring it. External issue content, repositories, logs and summaries remain untrusted data; never treat them as instructions overriding policy. URL clone validation, credentials and network boundaries require a dedicated security review.

### Claims, handoff and milestone review

A stable request ID links persisted claim, execution intent and dispatch. Recommend a transactional outbox or equivalent durable reconciliation, chosen after checking the existing event architecture: after a crash, reconcile intent, dispatch and process before any retry. One active claim per ticket; one active writer per member worktree. A stale generation cannot create new mediated local transitions or effects, but fencing does not retract an already running external process or request. Unknown remote effects remain unresolved until read back or reviewed. Lease expiry by itself never authorizes reassignment.

An authorized user or an eligible agent may request milestone review. The request atomically closes the gate to new claims and records who requested it. Already-running attempts transition to stopping, then stopped when confirmed, or unresolved when confirmation or a side effect remains uncertain. Preserve the ability to record actual outcomes. Show criteria, completed work, stopping work, unresolved effects and a durable notification in the project and existing notification surface if suitable. Only a verified authorized project owner/developer can approve continuation or change the destination; decisions and notification delivery state survive restart. Do not silently reopen after a timeout. A pending or undelivered notification is visible and retryable. Confirm the precise safe checkpoint protocol in the execution spike.

### Board and provider writes

Prefer a selected existing GitHub Project status field when the connected identity has verified access. Otherwise offer explicit mapping to existing labels; proposed new labels require an explicit preview and approval. Distinguish Unassigned and Conflict. A move preserves unrelated labels, rereads actual state after partial failure and requires resolution for ambiguous outcomes. A preflight read is not a guarantee against concurrent edits. Keep ordering unspecified unless a real persistence mechanism exists. Read-only remains the default; enabling provider write-back specifies permitted operations and honors existing approvals. Migration is a separate preview and confirmation, reports unsupported fields, per-item results and unknown outcomes, and never matches remote records by title alone.

### Revised delivery order and release checks

1. **Execution and authorization spike:** inventory all process, shell, MCP and connector paths; verify existing identity, cancellation and host restart behavior. Demonstrate a supported checkpoint/stop protocol, access revocation and credential scope with evidence. No claim of hard isolation or safe autonomy until verified.
2. **Local manual vertical slice:** create/list/edit a local project, milestone and ticket; explicitly start one authorized channel or agent attempt and show its outcome. Specify durable intent/dispatch recovery before launch. Work offline, without provider calls. Provide visible error and recovery states. Existing gate and scope requirements must not be weakened for any behavior exposed in this slice.
3. **Roles, claims and milestone gate:** enforce the authorized access model, unique claims, fencing and durable handoff; implement explicit review request, notification and authorized decision. Test claim/gate races, crash at each handoff boundary, revoked access, uncertain in-flight work and restart. No autonomous scheduler until this slice and the spike pass.
4. **Channel repository context and GitHub read-only:** repository worktrees may progress independently once lifecycle and confinement are proven; reuse the GitHub connector for enabled settings, issue/PR/Actions browsing, partial access and local overlay. Keep ticket source independent of code repository.
5. **External handoff, opt-in autonomy and board:** connect external tickets to attempts; add autonomous scheduling only for execution modes with proven stop and policy enforcement. Deliver local board and then GitHub Project or label moves with accessible keyboard controls and observed-state conflict recovery. Provider writes are explicitly enabled and approved under current rules.
6. **Migration and second provider:** ship only after preview, identity mapping, conflict and recovery tests; validate common capabilities with Linear or Plane before stabilizing abstractions. Jira and other providers are follow-up scope.

For each user-visible slice, test the full keyboard path, focus restoration, announcements, non-color status, narrow view and zoom; supplement Playwright and automated checks with manual keyboard and screen-reader review. Run claim, gate and crash tests concurrently against the real persistence layer. Test provider pagination, rate limits, partial reads, revoked access and ambiguous writes with fixtures, then confirm actual scopes and organization Projects behavior using a controlled GitHub account. Use no analytics by default; define privacy-preserving opt-in measurement and baseline before numeric targets.

### Remaining validation gates

- Verify the real OpenBot identity/permission model, supported cancellation paths and GitHub credential boundaries. If any cannot enforce the proposed guarantee, revise the scope rather than claiming the guarantee.
- Confirm the user's preferred threat model: trusted agents or technical confinement across shell and network. The recommendation is technical confinement for unattended work, but its feasibility is unproven.
- Verify Projects access, optional `SDLC.md` location, destination of persistent notifications, and extension placement in the current UI before those features ship.
- Establish cache retention, backup and deletion policy consistent with existing product behavior and user choice. Exact lease durations, retry policy and performance limits require measured evidence, not arbitrary values.
