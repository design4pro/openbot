# S0 project execution evidence

Status: Source inventory complete; runtime probes pending.
Baseline: `e1a890d9b6afdfbdfb1acb45888f301f8f94270f`, macOS, Bun 1.3.14, Node v26.12.0.
The package declares Bun 1.4.2; the installed runtime differs. Frozen installation and the focused
host-key-rotation E2E passed on the installed runtime. Results do not certify the declared Bun version.
Worktree: `codex/project-workspaces-s0`. The original checkout has unrelated UI changes; none were copied.
No source owner was modified. Only diagnostic code and documents will change.

## Evidence meaning

`unsupported` means the inspected path lacks the named project guarantee; it does not mean the
existing app violates its released full-access contract. `unverified` means no sufficient test ran.
No source-only row establishes a live provider enforcement guarantee. No live provider or GitHub
account is used in this investigation. Report artifact paths are local and are not committed.

## Provider and access-mode inventory

Each row has `basis=source`, `subject=provider`, `guarantee=confinement`, `artifacts=[]`.
`caseId=provider-confinement`; `id` is provider plus mode. `entryPoint=provider runtime` refers to
`src/backend/provider-drivers.ts` and its selected provider client; UI/IPC, Team API and agent-tool
routes converge on this runtime. These common entry routes are mapped separately below to avoid
repeating identical evidence. Source line references describe the baseline revision above.

| provider | mode | support | source | observed / limitation |
| --- | --- | --- | --- | --- |
| codex | full | unsupported | `src/backend/agent/workspace-sandbox.ts:95` | Full access is selected without workspace enforcement. Live confinement not tested. |
| codex | workspace | unsupported | `src/backend/agent/workspace-sandbox.ts:95` | workspaceWrite explicitly permits network access; writable roots include shared and temporary paths. Live confinement not tested. |
| claude | full | unsupported | `src/backend/claude-workspace-sandbox.ts:15` | Full access does not impose a project boundary. Live confinement not tested. |
| claude | workspace | unsupported | `src/backend/claude-workspace-sandbox.ts:15` | Bash sandbox and write hooks leave reads, network and MCP open. Live confinement not tested. |
| grok | full | unsupported | `src/backend/process-confinement.ts:369` | Full mode does not request workspace write confinement. Live confinement not tested. |
| grok | workspace | unsupported | `src/backend/process-confinement.ts:369` | macOS process profile protects writes; reads, network and process starts stay open. Live confinement not tested. |
| opencode | full | unsupported | `src/backend/process-confinement.ts:369` | Full mode does not request workspace write confinement. Live confinement not tested. |
| opencode | workspace | unsupported | `src/backend/process-confinement.ts:369` | macOS process profile protects writes; reads, network and process starts stay open. Live confinement not tested. |
| antigravity | full | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| antigravity | workspace | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| cursor | full | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| cursor | workspace | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| cline | full | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| cline | workspace | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| pi | full | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| pi | workspace | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| muse | full | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| muse | workspace | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| inception | full | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| inception | workspace | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| deepseek | full | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| deepseek | workspace | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| openrouter | full | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| openrouter | workspace | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| acp | full | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |
| acp | workspace | unverified | `packages/contracts/src/agent-providers.ts:23`; `src/backend/provider-drivers.ts` | Provider is registered; exact runtime, credential and stop behavior was not exercised. Live confinement not tested. |

## Common entry and ownership matrix

These source-only rows have `subject=host`, `provider=all`, `mode=full/workspace (common host path)`,
`basis=source`, `artifacts=[]`. Their IDs and case IDs are the first column. Separate source rows
are not runtime probe results. Task 2/3 report rows use the exact tested mode and named case IDs.

| id / caseId | entryPoint | guarantee | support | source / observed | limitation |
| --- | --- | --- | --- | --- | --- |
| direct-task | UI / IPC / task tools | admission | unverified | `src/renderer/src/features/tasks/tasks-port.ts:25`; `src/main/ipc/agent-handlers.ts:698`; `src/backend/agent-tasks/agent-tasks.ts:43`: AgentTask has its own thread, start/stop/close/reopen and start_task tool | No project grant/claim/gate context in these owners |
| channel-command | UI / IPC / Team API | admission | unverified | `src/main/ipc/agent-handlers.ts:369`; `src/main/team-api/route-channels.ts:57`; `src/backend/channel-service.ts:217`: actor-stamped command and serialized channel changes | Project identity and generation checks are absent; sender validation is not project authorization |
| channel-history | Team API / channel_history / context | audience | unsupported | `src/main/team-api/route-channels.ts:71`; `src/backend/channel-history.ts:146`: page read has no project principal and history/summary is shared | Agent membership alone cannot prove the human audience is compatible |
| derived-content | channel_result / channel_remember | audience | unsupported | `src/backend/channel-service.ts:2478`; `src/backend/channel-history.ts:209`: result and memories enter shared context | Cache-only ACL cannot protect these copies |
| owner | local IPC | identity | unverified | `src/main/host-service.ts:1726`: signed-out channel actor differs from signed-in actor | A durable account-independent project owner is not implemented |
| remote-principal | Team API | identity | unverified | `src/main/team-api/route-channels.ts:57`: member comes from request context | Need a real route probe; do not trust body-supplied actor IDs |
| task-context | agent tools / MCP | admission | unverified | `src/backend/channel-tools.ts:9`; `src/backend/local-mcp-bridge.ts`: channel/task context exists; searched for projectId, claimGeneration and gateGeneration in channel, task, history and bridge owners without matches | No project admission wrapper demonstrated; installed MCP can expose other routes |
| cli-context | CLI / shell | admission | unverified | `src/backend/provider-drivers.ts`; `src/backend/provider-processes.ts`: provider CLI processes, not a verified project-start CLI | No separate project CLI located in the named owners; generic shell remains outside a project fence |
| mailbox-key | channel enqueue | delivery | unverified | `src/backend/mailbox-store.ts:497`: an existing key returns the saved receipt before payload checks | Task 2 measures same-key changed-payload behavior |
| surviving-worker | channel recovery | termination | unverified | `src/backend/channel-service.ts:1857`: recovery recognizes some live deliveries | No provider-wide process-death proof; Task 2 tests controlled process survival |
| late-completion | channel interruption | termination | unverified | `src/backend/channel-service.ts:2779`: completion may precede interrupt acknowledgement | Task 2 measures real-service outcome recording |
| shared-receipt | delete channel | history | unverified | `src/backend/channel-store.ts:568`; `src/backend/database/database-core.ts:242`: aggregate deletion removes matching receipts | Task 2 measures survival of an unrelated event sharing that command |
| credentials | Git / gh / MCP | credential-selection | unsupported | `src/main/github-connector-service.ts:458,497`; `src/main/github-mcp-proxy.ts:226`: user-token fallbacks; gh uses user credential files | Not project least privilege; Task 3 uses only synthetic credentials |
| github-rest | workflow adapter | credential-selection | unverified | `src/main/github-rest.ts:87`: token and fetch adapters own outbound I/O | No real scopes checked; not a generic project adapter |
| event-files | subscriptions / attachment reads | audience | unverified | `src/main/team-api-server.ts`; `src/backend/channel-service.ts`; `src/backend/mailbox-store.ts`: separate event/file paths | Must test each path rather than infer from channel reads |
| work-scope | renderer | admission | unverified | `src/renderer/src/features/window/window-page-context.tsx:132`; `src/renderer/src/scope-lifetime.ts:6`: active host and stale-owner guard | Work is not implemented; preserve host-scoped drafts and stale-response checks in S1 |
| database | host transaction | history | unverified | `src/backend/openbot-database.ts:114`: dispatch appends events, projects and receipts atomically | Task 2 exercises persistence; no project schema is added |

## Candidate execution target

ChannelService has explicit assignment/delivery records and recovery hooks. AgentTask already supports
private per-agent execution threads and the Tasks UI, but its visibility is agent-scoped, not project-scoped.
Neither is selected for release from source inspection alone. Compare available mediation and recovery
before selecting one. Keep approvals, Undo, existing conversation links and wire meanings intact.
Direct task headless execution may require a full ConversationRuntime; record an unavailable seam rather
than instantiate a live provider or pretend a fake task service proves it.

## Planned runtime evidence

Task 2 owns duplicate-delivery, handoff-crash (enqueue/start/unrecorded-completion boundaries),
surviving-worker, cancel-before-dispatch, late-completion and destination-delete-receipt.
Task 3 owns audience-and-derived-content, local-owner-and-remote-principal, all four proxy/token
credential-fallback combinations and credential-revocation. Each unavailable path must have a reason.
A passing diagnostic can expose unsupported capabilities. It cannot turn them into release approval.

## Current decisions

The developer approved incompatible-conversation refusal, Work for the active host, and full local
operation without an account. These are requirements to implement, not existing capabilities.
S0 will not implement grants, change connector fallbacks or introduce process isolation.

## Runtime results and handoff

Task 2 exercised real ChannelService, MailboxStore and SQLite in disposable profiles. The Bun CLI
launches the installed Node runtime through the existing tsx dependency because Bun 1.3.14 cannot
load node:sqlite. The report records the actual runtime and source file hashes; its commit is the
checkout HEAD and can precede the scripts when a run has uncommitted changes.

- Duplicate delivery keys preserve identity but accept a changed payload. A canonical fingerprint
  is unsupported on this path.
- A queued cancellation remains cancelled after recovery. Recovery and controlled host crashes
  preserve delivery IDs. The busy scheduling hook excludes proof about real dispatch and worker discovery.
- A real completion event before the interrupt hook acknowledges preserves the assignment and mailbox
  terminal result. The task can remain paused by its newer stop revision. This is not process-exit proof.
- Deleting a channel removes a command receipt shared with a surviving diagnostic aggregate event,
  including after database reopen. This boundary cannot yet back project receipt retention.
- The harness rejects an absent required case and a service-fixture claim of provider confinement.

The lifecycle report contains six named cases. Local artifact paths and final readiness follow in Task 4.
Access, credentials and the S1 handoff remain pending. No project gate is satisfied.
