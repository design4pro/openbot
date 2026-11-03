# Issue 6: implementation review

Reviewed specification: [integration specification](openbot-issue-6-integration-spec.md).
Code inspected: repository checkout, HEAD `7ddef1a3a3889033c5f770defbf4c4258594d2d2`. Existing uncommitted changes were not modified. This is a design review, not a runtime or provider-permission audit. Other channel specialists provide separate reviews.

## Assessment

The separation of a persistent ticket, an execution attempt, an external reference, and a code repository is sound. Keep it. The plan is suitable for further design, but it is not yet an implementation contract. Its highest-risk promises are enforcement across agent execution modes, transactional handoff, and recovery after a process survives a host restart.

## Required changes before dependent implementation

| Priority | Finding | Required specification change | Verification |
| --- | --- | --- | --- |
| P0 | A database fence does not stop an already running provider process or its direct shell/network actions. | Identify every supported execution mode, the enforcement boundary for its actions, and the precise meaning of paused, stopping, stopped, and unresolved. Do not advertise filesystem confinement or immediate gate enforcement for modes that cannot provide it. | Close the gate while an action is queued, admitted, running, and completed but not recorded. Include a surviving external agent process. |
| P0 | Persisting an execution intent and creating a ChannelTask/mailbox delivery are separate actions unless deliberately joined. | Define one transactional command where possible; otherwise persist an idempotent delivery intent and a reconciler. Specify the unique delivery key, payload comparison, and recovery after every boundary. | Kill the host after intent commit, after delivery creation, and before receipt recording. Exactly one logical attempt must remain linked to its delivery. |
| P0 | The plan does not say how authorization and claims are enforced when a worker calls existing generic tools instead of new project tools. | Define execution-context propagation for principal, project, ticket, attempt, claim generation, and gate generation. State which existing tool and provider paths consume that context, and which remain unrestricted. | A stale attempt cannot mutate local ticket state through another route or start a restricted action with an old context. |
| P1 | One worktree per member is not one isolated worktree per concurrent execution. | Define whether a member can run more than one repository task in that worktree. Recommended first release: one active mutating execution per managed worktree, enforced with a resource lease. | Two different tickets assigned to the same worktree cannot concurrently switch branches, edit, or commit there. |
| P1 | External identity is partly tied to installation/account, which can change during reconnect or reinstall. | Separate durable provider-object identity from the current credential/installation binding. Specify the GitHub instance namespace, reconnect, repository transfer, and inaccessible-object behavior before adding uniqueness constraints. | Reconnecting an account or reinstalling the app does not duplicate a known issue. Different GitHub instances cannot collide. |
| P1 | The persistence section asks for transactions but does not choose the existing command/event ownership model. | State which events rebuild each projection, where invariants run, and how receipts compare replayed payloads. Keep project writes within the existing database host and transaction owner. | Rebuild and restart preserve claims, gates, provenance, and receipts; failed writes leave no partial command. |
| P1 | An external scan can only establish absence within its exact query and permission scope. | Store scan identity, source, filter, resource scope, cursor, and completion outcome. A filter or access change must not imply remote deletion. Prefer an unavailable state unless deletion is confirmed. | Change filters or remove repository access mid-scan; retained records must not be incorrectly marked deleted. |
| P1 | Execution, claim, gate, and external status are described but their transition rules remain implicit. | Add a transition table with actor, prerequisites, atomic writes, side effects, terminal state, and retry rule. Define reopening tickets, cancelling children, archiving projects, and unlinking a source during execution. | Exercise invalid transitions and restart at each side-effect boundary. |
| P2 | Phase 1 includes claims, active-worker pause and unknown effects, while execution handoff is deferred to phase 4. | Move the smallest real ticket-to-execution handoff into the first executable slice. Otherwise phase 1 acceptance cannot prove its own promises. | Demonstrate a complete local ticket -> claim -> real delivery -> outcome -> gate flow before adding GitHub. |

## Code evidence and reuse

- `src/backend/openbot-database.ts:65` documents a command that appends events, updates projections, and saves a receipt in one SQLite transaction. Use this ownership model rather than a new standalone SQLite store.
- `src/backend/channel-store.ts:394` already commits channel events and projections through `database.dispatch`. Its existing receipt path returns the previous result; this observation does not establish payload-fingerprint enforcement. Verify that separately for the new commands.
- `src/backend/channel-service.ts:1837` recovers assignments and explicitly recognizes live deliveries whose agent process survived a shared-process restart. Do not treat a fresh host process or expired lease as proof of worker termination.
- `src/backend/channel-service.ts:2751` requests interruption through provider hooks. The specification must distinguish the request from evidence that all relevant work and effects have stopped.
- `packages/contracts/src/ipc-chat-channels.ts` exposes released ChannelTask and ChannelCommand contracts. Add capability-gated operations and compatible optional links; do not reinterpret existing states or commands for older clients.
- `src/backend/channel-schema.ts` contains projection schemas. Define normalized invariant-bearing records for new claims/gates and their relationship to replay, rather than relying on mutable JSON fields without database constraints.
- `src/main/github-connector-service.ts` already discovers installation repositories and owns credential handling. Reuse it through an explicit host adapter; do not extend the generic renderer-facing API with raw tokens.

## Smaller delivery sequence

1. **Execution feasibility spike:** use one existing channel and agent. Record which actions can be stopped or fenced in each supported provider mode. This is a bounded investigation with a written support matrix, not a new execution framework.
2. **Local vertical slice:** project, one milestone, ticket, attempt, durable handoff, single active claim, gate, and recovery. Use one execution target. Include scoped reads and writes from the start.
3. **Repository lifecycle:** one repository per channel, one active mutating execution per worktree, provisioning journal, and explicit safe cleanup. Delay multiple repositories and complex inheritance.
4. **GitHub read-only:** paginated issues and durable links first. Add PR/Actions views independently after their permissions and performance are known.
5. **Board and writes:** local board, then one approved GitHub status authority. Add reconciliation before enabling retries. Do not ship both Projects and label mapping merely to complete the architecture diagram.
6. **Autonomy, second provider, and migration:** separate deliverables. First validate a second provider's real identity and status semantics; then stabilize the shared contract. Treat data migration as a product feature with its own acceptance suite.

## Repository alignment and missing budgets

The plan repeatedly mandates unit tests, while the inspected repository's `AGENTS.md` currently permits new Vitest tests only for listed protected areas and otherwise requires process/service/UI E2E scripts. The session also names unit testing as a priority. Resolve the concrete test policy before implementation; do not silently add prohibited test files or replace concurrency tests with UI-only checks. Use real temporary databases and controlled workers for concurrency and crash tests. Migration fixtures remain required, including both upgraded and fresh database paths.

`src/backend/AGENTS.md` forbids relying on automatic database backups. Reword the plan's backup/restore reference so safe migration does not depend on a backup being present.

Add measurable bounds before accepting scalability claims: default page size, maximum in-memory list/window, concurrent refreshes, provider-call budget, and retention for snapshots and operation receipts. Large issue bodies and full histories should load on demand. Define the meaning of disabling the extension during an in-flight read or write, including which core local execution functions continue.

No timeline estimate is justified until the execution enforcement matrix and first vertical slice are resolved. No code, repository configuration, GitHub issue, or pull request was changed by this review.
