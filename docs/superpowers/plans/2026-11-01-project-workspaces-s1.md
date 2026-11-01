# Project Workspaces S1 Blocked Handoff

**State:** BLOCKED for implementation planning, not authorized for feature implementation.
Prepared on 2026-11-01 from S0 source inspection and the diagnostic at
`eec2b0c1b85905d01e48efbaff9cd175f8d74ae1`.

**Goal:** Establish the missing identity and execution boundaries before writing an executable S1 plan.

**Architecture:** Keep the existing host database and command/event/projection owner. Reuse existing
execution services only after their admission and recovery paths carry the required authority.
Do not infer project isolation from a workspace, channel, agent role or successful diagnostic.

**Tech Stack:** Existing host SQLite, Effect 4, Team API, Electron IPC, SolidJS shared UI and E2E scripts.
No new dependency, schema or wire operation is selected by this handoff.

**Spec:** [Plan 011](../../../plans/011-project-workspaces-and-github-integration.md).
**Evidence:** [S0 evidence and readiness](../../../plans/011-project-workspaces/s0-evidence.md).
**Diagnostic:** [S0 plan](2026-11-01-project-workspaces-s0.md).

**Follow-up design:** [Durable local identity and protected local planning](../specs/2026-11-01-local-identity-protected-planning-design.md).
The developer selected consistent profile-copy ownership and application-level protection, including
mutual exclusion with remote viewing/control. The proposed design awaits review. It does not replace
this blocked handoff with an executable plan or establish D2 through documentation alone.

## Decision

S0 is complete as a bounded diagnostic. S1 is not an implementation-ready plan. The absence of project
schemas alone would not block a design: they are expected future work. The blockers are the missing
proof of durable local authority, route-wide access mediation and recovery of a surviving real worker.
Source inspection also demonstrates open execution routes that cannot enforce project confinement.

| Proposed mode | Release | Implementation feasibility | Required next evidence |
| --- | --- | --- | --- |
| planning-only | Blocked by D2 | Unverified; a local planning design is the smallest candidate | Durable profile owner, account linking and protection of stored/derived content across every exposed read path |
| manual-trusted | Blocked by D1-D3 | Unverified for a selected execution target | Trusted caller at admission, compatible audience, durable handoff, surviving-worker detection and reconciliation |
| hard-gated | Blocked by D1-D3 | Existing routes have demonstrated enforcement gaps; architecture prerequisite | Mediation of shell, filesystem, network and MCP, plus stop/effect boundaries |
| unattended | Blocked by D1-D3 | Existing routes have demonstrated enforcement gaps; architecture prerequisite | All hard-gated evidence for an exact real provider version and mode, including descendants and revoked access |

This does not change the contract or availability of existing Tasks, channels or provider access modes.
A trusted execution label can disclose missing confinement; it cannot waive identity, audience or
crash-recovery requirements.

## Decisions already fixed

- Local ownership and milestone release work without an OpenBot account. Ownership survives sign-in,
  sign-out and restart. A remote caller cannot choose the local principal.
- Work contains projects of the active host. Preserve existing AgentTask behavior, approvals, Undo and
  conversation links. Do not aggregate hosts in the first release.
- Block a start when any effective conversation reader lacks the project's grant. Include agents,
  human readers, event subscribers and readers of attachments, summaries and memories. Recheck after
  membership changes and revocation; do not silently widen grants.
- A review submission closes admission atomically. Only a verified human owner may release a gate.
- An ambiguous outcome requires reconciliation. A lease timeout or interrupt request is not proof of
  process exit. Do not automatically retry or reassign uncertain work.
- Keep project data on the host. Preserve released schemas, wire meanings and agent identities.
- GitHub follows the local flow and starts read-only. Do not reuse user-token fallback as a scoped
  project credential policy. No GitHub scope is certified by S0.

## Prerequisite design and evidence

These are requirements for the next design review, not function signatures or implementation tasks.
Do not turn the list into feature code before the selected boundaries and contracts are specified.

| Area and current owner | Design output required | Acceptance evidence required |
| --- | --- | --- |
| Local identity: `src/main/host-service.ts`, `src/main/ipc/agent-handlers.ts`, host persistence owner | Profile-bound principal lifecycle, separate account-link relation, backup/restore behavior and authenticated remote mapping | Restart and sign-in/out preserve ownership; an untrusted renderer or remote request cannot choose the local principal; local owner can release a gate without an account |
| Access: `src/main/team-api/route-channels.ts`, `route-files.ts`, `src/main/team-api-server.ts`, `src/backend/channel-history.ts` | One authority for grants and effective audiences, with rules for old copies, cached content and membership changes | Incompatible start is refused before copying data; add/revoke is tested for channel, result, summary, memory, attachment and event reads; stale subscribers receive no new private content |
| Admission and target: `src/backend/agent-tasks/agent-tasks.ts`, `src/backend/channel-service.ts`, `src/backend/mailbox-store.ts` | Select one target; define current-grant checks, ticket/claim/gate generation propagation and delegated-task policy | Every UI/IPC, Team API, tool and MCP path either carries validated project context or refuses project execution; ordinary tasks retain their released behavior |
| Durable handoff: `src/backend/openbot-database.ts`, `src/backend/database/database-core.ts` | Transaction-owned intent and receipt lifetime; canonical request fingerprint; per-generation delivery key | Same key/same payload returns the original result; changed payload conflicts; crash before/after commit cannot duplicate intent; destination deletion preserves unrelated receipts and project outcome |
| Recovery: `src/backend/provider-processes.ts`, provider drivers and channel/agent-task recovery | Worker identity and descendant lifetime, ownership fencing, pending cancellation and effect reconciliation protocol | Kill the real host at admission/start/unrecorded completion; surviving workers block replacement; no second writer until termination and external effects are resolved; completion before interrupt acknowledgement retains the actual outcome |
| Review: future project domain owner within existing host transaction authority | Review ID, claim/gate generation, criteria version and owner decision in one validated operation | Stale or duplicate decisions cannot release a later generation; unresolved running work is visible; submitting review closes new admission atomically |
| Work: `src/renderer/src/features/window/window-page-context.tsx`, `src/renderer/src/scope-lifetime.ts`, `packages/ui` | Active-host data and draft ownership; accessible creation/review flow and existing Tasks mapping | Host A -> B -> A ignores stale responses and preserves scoped drafts; keyboard-only creation/review, labelled controls, focus return and error announcements |
| Credentials: `src/main/github-connector-service.ts`, `src/main/github-mcp-proxy.ts`, `src/main/github-rest.ts` | Fail-closed project credential selection separate from released general connector behavior | Proxy unavailable and repository token absent never widen project authority; revocation blocks new admissions and reports admitted outcomes without pretending they were undone |

The source inventory accounts for all 13 registered providers in both modes. Codex, Claude, Grok and
OpenCode received the first source inspection. No provider received a live confinement test.
The busy scheduling hook in S0 deliberately excludes AgentService boot and real worker replacement.
It cannot certify D3, even though persisted delivery IDs survived controlled process crashes.

## Narrower option

Design durable local ownership and protected local planning first. Exclude execution, GitHub sync,
repository provisioning and remote sharing from that candidate. This is a design recommendation, not
an enabled mode or an approved implementation slice. D2 must still address all routes through which
existing remote clients or agents could read the new local data. Merely hiding a UI is insufficient.

Once that design and its trust-boundary evidence exist, replace this handoff with a writing-plans
implementation plan: exact schema ownership, signatures, task mapping, focused E2E commands and
migration fixtures for every affected released source schema. New controls must be labelled as work
to implement; current-code support remains unsupported until those tests pass.

## Live-provider follow-up boundary

No live-provider run is authorized by S0. Prepare a separate bounded probe for one exact installed
provider/version/access mode. It must specify:

- Synthetic workspace and outside-root canaries; owned child and descendant PIDs.
- Allowed loopback destinations, denied external destinations and the MCP/tool inventory.
- The admission/crash/stop sequence and observable terminal evidence, including unresolved effects.
- An explicit numerical request/cost budget, deadline and cleanup procedure before execution approval.
- No real repository token, user content or global HOME/CODEX_HOME change.

Reading a version or running a controlled worker is insufficient to promote provider confinement to
`supported`. The evidence must bind the real configuration, installed version and exercised routes.

## Reproduction and CI boundary

Run one diagnostic group at a time, or `all` for the sequential S0 set:

```sh
bun scripts/project-workspaces-s0-e2e.ts --group all
bun scripts/project-workspaces-s0-e2e.ts --verify-report .openbot-build/project-workspaces-s0/<run-id>/report.json
```

To reproduce the harness failure check, run
`bun scripts/project-workspaces-s0-e2e.ts --group lifecycle --fault-worker-exit`.
Expected: exit 1, `probeRunPassed: false`, and an unexpected worker-exit diagnostic. This deliberately
terminates only the controlled worker after its start acknowledgement.

Use the printed run ID. A passing report means the diagnostic completed, including negative results.
Source hashes identify the exact scripts; the commit identifies the checkout revision. No report is
committed. Results are macOS/Node service evidence, not Electron or live-provider certification.

These scripts do not run in CI. A future implementation plan that retains them as release checks must
name the existing CI job owner, supported runtime and selected command. Keep local checks focused;
leave broad lint, builds and test suites to CI. S0 adds no production migration, feature or release note.
