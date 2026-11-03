# Project Workspaces S0 Feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce repeatable evidence for execution, authorization and recovery, then define the smallest safe S1 scope or record why execution remains blocked.

**Architecture:** Inspect existing host boundaries and exercise real services with temporary databases and controlled child processes. Keep evidence about host behavior separate from evidence about a real provider's enforcement. Do not add project features, migrations, a scheduler or a sandbox to make a probe pass.

**Tech Stack:** Existing Bun E2E scripts, Node child processes and SQLite, installed Effect 4 APIs, existing channel/mailbox/agent services and Team API. No new dependency.

**Spec:** [Plan 011](../../../plans/011-project-workspaces-and-github-integration.md), including its selected decisions, domain rules and evidence gates. The linked source specifications are background; Plan 011 takes precedence.

**State:** TODO. Prepared on 2026-11-01 against `fff9ec069a4cef7dca6d125b64f85b1d9c647d48`. This document authorizes no execution. The current request covers documentation only; all scripts and reports below are future deliverables.

## Global Constraints

- Keep project data, source snapshots, conversations, execution records, and files on the host.
- Preserve existing agent identity, sessions, histories, and unrelated working-tree changes.
- Follow the host command/event/projection transaction owner. Do not add a second database authority.
- Preserve every shipped database schema and released wire meaning. Add capability negotiation for new operations.
- Enforce current authorization on reads and admission of new actions. Capabilities alone are not authorization.
- Assignment does not publish comments, move provider status, open a PR, or approve any external action.
- Full local operation, including gate release, works without an OpenBot account.
- Work lists projects of the active host only in the first release.
- Reject a start into a conversation whose effective audience exceeds the project's grants.
- Keep PolyForm Noncommercial 1.0.0. Do not add dependencies, production tables or public operations in S0.
- Use process/service E2E scripts for diagnostics. No new unit tests, broad checks or production fixes.
- Use temporary profiles, synthetic content and fake credentials. Bind test services to loopback; make no real provider calls in the default run. Never open the user's database.
- Do not repurpose `HOME` or `CODEX_HOME`. Pass temporary store paths and explicit fixture executable paths through existing injected boundaries. If a probe needs an unavailable seam, record it as unverified rather than changing global configuration.
- Only stop child PIDs started by the probe and verified by its run ID. Preserve unrelated dev stacks. Wait for events or protocol acknowledgements; use deadlines only to terminate a failed probe.
- Run one probe worker at a time. Use a 30,000 ms diagnostic step deadline to detect a stalled harness; it is not a product lease, checkpoint or performance requirement.
- Do not persist raw tokens, real issue bodies or user conversation text in evidence. Apply existing redaction before writing diagnostic errors.

## Review Focus

- A host exits after admission while a worker survives: do not infer termination or start a replacement. Task 2: `surviving-worker`.
- Cancellation races with dispatch or completion: preserve the observed outcome without falsely reporting a stopped worker. Task 2: `cancel-before-dispatch` and `late-completion`.
- A conversation has more readers than the project, or gains a reader later: no claim of safe project delivery without controls on all copies. Task 3: `audience-and-derived-content`.
- A local owner signs out, or a remote caller supplies that owner's identifier: preserve local ownership without permitting impersonation. Task 3: `local-owner-and-remote-principal`.
- Deleting a channel removes a receipt shared with project history: preserve the remaining aggregate's idempotency. Task 2: `destination-delete-receipt`.

---

## Boundaries and file ownership

Future S0 changes are limited to these files. Product sources below are read or exercised, not edited.

| File | Responsibility |
| --- | --- |
| `plans/011-project-workspaces/s0-evidence.md` | Source inventory, versioned support matrix, evidence links and unresolved gates |
| `scripts/project-workspaces-s0-e2e.ts` | Sequential diagnostic runner, existing-service fixtures, assertions, report validation and safe cleanup |
| `scripts/project-workspaces-s0/worker.ts` | Controlled child process with an explicit acknowledgement protocol; no product policy |
| `docs/superpowers/plans/2026-11-01-project-workspaces-s1.md` | Evidence-based S1 design, or an explicit blocked handoff without invented interfaces |
| `.openbot-build/project-workspaces-s0/<run-id>/report.json` | Immutable local run evidence; not committed |

Read `AGENTS.md`, `CONTRIBUTING.md` security-sensitive guidance, `docs/architecture/change-rules.md`,
`src/backend/AGENTS.md`, `src/main/AGENTS.md`, `packages/contracts/AGENTS.md` and the renderer/UI
instructions before their relevant investigation. Recheck any directory instructions added since this plan.

### Initial investigation scope

Inventory every provider returned by `AGENT_PROVIDERS` in `packages/contracts/src/agent-providers.ts`.
Inspect Codex, Claude, Grok and OpenCode first, in both available access modes. Remaining providers
receive an explicit row; they remain `unverified` unless individually examined. Never infer support
for an ACP provider from another provider using ACP.

Trace both direct `AgentTask` and channel execution. For each, include UI/IPC, Team API, agent tools,
MCP and any CLI entry found in current code. Record absent entry points as absent, with the search
performed, rather than inventing them. Inspect these owners:

- `src/backend/provider-drivers.ts`, `src/backend/provider-processes.ts`, `src/backend/process-confinement.ts`,
  `src/backend/agent/workspace-sandbox.ts`, `src/backend/claude-workspace-sandbox.ts`.
- `src/backend/agent-tasks/agent-tasks.ts`, `src/backend/channel-service.ts`, `src/backend/channel-history.ts`,
  `src/backend/channel-tools.ts`, `src/backend/mailbox-store.ts`, `src/backend/local-mcp-bridge.ts`.
- `src/main/host-service.ts`, `src/main/team-api/route-channels.ts`, `src/main/ipc/agent-handlers.ts`,
  `packages/contracts/src/ipc-agent-tasks.ts`, `packages/contracts/src/ipc-chat-channels.ts`.
- `src/main/github-connector-service.ts`, `src/main/github-mcp-proxy.ts`, `src/main/github-rest.ts`.
- `src/backend/openbot-database.ts`, `src/backend/channel-store.ts`, `src/backend/database/database-core.ts`.
- `src/renderer/src/features/tasks/tasks-port.ts`, `src/renderer/src/features/tasks/TasksView.tsx`,
  `src/renderer/src/features/window/window-page-context.tsx`, `src/renderer/src/scope-lifetime.ts`.

Known source observations to recheck: workspace mode can leave network/MCP access open; connector
paths can fall back to a user token; channel history and results are shared; signed-out channel identity
is not a defined project owner; aggregate deletion can remove shared command receipts. These are
probe inputs, not runtime results. Existing project-specific controls may be absent: report that absence.

### Evidence interface

Use the following diagnostic-only types in the runner. Later tasks consume these exact fields.

```ts
type Support = "supported" | "unsupported" | "unverified";
type ProbeGroup = "lifecycle" | "access" | "credentials";
interface EvidenceRow {
  id: string;
  caseId: string;
  provider: string;
  mode: string;
  entryPoint: string;
  subject: "host" | "provider";
  guarantee: "admission" | "audience" | "identity" | "delivery" | "termination"
    | "history" | "credential-selection" | "redaction" | "confinement";
  support: Support;
  basis: "source" | "service-fixture" | "live-provider";
  source: string[];
  artifacts: string[];
  observed: string;
  limitation: string | null;
}
interface ProbeReport {
  schemaVersion: 1;
  runId: string;
  commit: string;
  platform: string;
  versions: Record<string, string>;
  groups: ProbeGroup[];
  probeRunPassed: boolean;
  rows: EvidenceRow[];
  failures: string[];
}
```

`source` entries contain repository-relative paths, symbols and verified line references. `artifacts`
contain paths relative to the run directory. Record relevant uncommitted source differences in the
evidence document, without copying unrelated private changes. `mode` must identify the exact access
configuration; a generic provider name is insufficient for an enforcement claim.
`caseId` is one of the named cases in Tasks 2 and 3; each row ID is unique within its report.
The verifier requires every case for the selected groups, and all four credential-fallback combinations.
Task 1 source-only rows use descriptive case IDs and are not passed off as executed report rows.

`probeRunPassed` means the diagnostic ran as specified, wrote complete evidence and cleaned up its
processes. It does not mean the product is safe. A reproduced missing guarantee is `unsupported`
and can coexist with a passing diagnostic. A missing executable, unavailable seam or untested boundary
is `unverified`, with a reason. A crash of the harness or missing expected observation makes the run fail.
For `subject: "provider"`, never mark confinement `supported` unless `basis` is `live-provider`
and the row links the exact tested configuration and runtime evidence. Host-only evidence cannot
be promoted to provider enforcement. The verifier rejects incompatible combinations.

## Task 1: Map existing controls and missing controls

**Files:** Create `plans/011-project-workspaces/s0-evidence.md`; inspect the owners listed above.

**Interfaces:** Consumes Plan 011 D1-D3/D6/D7 and the developer decisions. Produces a source matrix
with one row per provider/access mode/entry point/guarantee, using the EvidenceRow field names, plus
an explicit list of which rows Tasks 2 and 3 will exercise. No runtime row is marked supported yet.

- [ ] **Step 1: Capture the investigation baseline.** Run `git status --short`, `git rev-parse HEAD`,
  `bun --version` and `node --version`. Record versions and relevant dirty paths. In a fresh worktree,
  run `bun install --frozen-lockfile` before a diagnostic. Do not change the existing checkout or its edits.
- [ ] **Step 2: Trace principals and actions.** Record where the human/agent identity, project context,
  task ID and delivery ID are introduced, checked, dropped or absent. Include shell, filesystem,
  network, Git, `gh`, MCP, stop requests, completion events, event subscriptions and attachment reads.
  Distinguish trusted local access, remote authentication and actual project authorization.
- [ ] **Step 3: Record the source matrix and first-target candidates.** Compare AgentTask and ChannelTask
  without reinterpreting either contract. Identify how Work can preserve existing Tasks and host scoping.
  Record where account-independent owner identity and protected destination audiences still need S1 design.
- [ ] **Step 4: Verify coverage.** Compare the matrix with `AGENT_PROVIDERS` and every owner above.
  Each missing path must have a searched location and an `unverified` reason. Expected result: every
  provider is accounted for, every claimed limitation has a source reference, and no fixture is called live proof.
- [ ] **Step 5: Commit only the evidence document.** `git add plans/011-project-workspaces/s0-evidence.md`
  then `git commit -m "docs: map project execution feasibility boundaries"`.

## Task 2: Probe real service lifecycle and persistence boundaries

**Files:** Create `scripts/project-workspaces-s0-e2e.ts` and `scripts/project-workspaces-s0/worker.ts`;
update `plans/011-project-workspaces/s0-evidence.md`.

**Interfaces:** Consumes Task 1 source rows. Produces
`runLifecycleProbes(runDirectory: string): Promise<EvidenceRow[]>` and
`validateReport(report: ProbeReport): void` in the runner, plus the report contract above.
The runner CLI is `--group lifecycle|access|credentials|all`; `all` runs sequentially.
`--verify-report <path>` validates a saved report without launching services.

The child protocol uses JSON lines with `runId`, a unique command `id`, and
`type: "ready" | "start" | "started" | "effect-admitted" | "finish" | "completed" | "stop" | "stopped"`.
Echo the command ID in acknowledgements. `stopped` is evidence only for this controlled child;
the supervisor must also observe exit. Keep child-process mechanics in the fixture and policy in real services.

- [ ] **Step 1: Establish the missing diagnostic.** Run
  `bun scripts/project-workspaces-s0-e2e.ts --group lifecycle` before creating it.
  Expected: nonzero exit because the diagnostic does not exist. This is not a failed product guarantee.
- [ ] **Step 2: Implement the process harness and real-service probes.** Use temporary stores and
  actual `ChannelService`, `MailboxStore` and database operations. For direct tasks use the actual
  AgentTask service boundary selected in Task 1. Reuse patterns from `scripts/host-key-rotation-e2e.ts`
  and `scripts/agent-access-e2e.ts`; inspect `scripts/provider-loss-scope-e2e.ts` for protocol behavior,
  but do not copy its global home-variable overrides. Keep providers controlled and network local.
  Exercise the following named cases and record observed IDs, counts and state transitions:
  - `duplicate-delivery`: submit the same existing delivery key twice; assert the observed delivery
    count and identity. Test changed payload separately. A missing fingerprint check is unsupported,
    not an instruction to add a project command in this task.
  - `handoff-crash`: terminate the owned host child after durable enqueue, after worker start and
    before recording completion. Restart against the same temporary database and count deliveries
    and worker starts. Use acknowledgements to select each boundary, not elapsed time.
  - `surviving-worker`: keep the owned worker alive across host exit; observe whether recovery
    identifies it or starts another. Record any duplicate as evidence against the guarantee.
  - `cancel-before-dispatch`: cancel an existing queued delivery before releasing its worker-start
    barrier; assert the observed start count is zero if cancellation reports success.
  - `late-completion`: send completion before acknowledging interrupt; record whether the real
    service preserves the terminal result. Do not map a stop request to confirmed process exit.
  - `destination-delete-receipt`: create a channel with synthetic content and delete it through
    the real service; record removed conversation/delivery records. In the same temporary database,
    use the existing dispatch boundary to create a command with a channel event and a diagnostic
    aggregate event, then delete the channel. Check receipt lookup and the surviving event after
    reopen. Do not create a project table or change production event decoders.
  Project gates and grants that do not yet exist remain unsupported or unverified. Do not simulate
  them with a parallel policy implementation and then report them as host guarantees.
- [ ] **Step 3: Run and inspect the artifact.** Run the Step 1 command again, then
  `bun scripts/project-workspaces-s0-e2e.ts --verify-report .openbot-build/project-workspaces-s0/<run-id>/report.json`
  using the exact run ID printed by the runner. Expected: exit 0 for a complete diagnostic and valid
  report, including negative capability results. Every named case has rows; no owned child remains alive.
  On a probe error, save a report with `probeRunPassed: false` and exit nonzero.
- [ ] **Step 4: Verify report failures through the CLI.** Make a synthetic copy of the report with
  a required case absent, and another claiming live-provider confinement from service-fixture evidence.
  Run `--verify-report` on each. Expected: both exit nonzero and name the invalid claim. Do not alter
  the original artifact. A deadline or missing acknowledgement must never be serialized as successful stopping.
- [ ] **Step 5: Run focused checks and commit.** Run changed-file Biome for the two scripts, then
  `bun run typecheck:node`, sequentially. Stage only those scripts and the evidence document; commit
  with `test: probe project execution lifecycle boundaries`. Keep JSON artifacts out of Git.

## Task 3: Probe access, derived content and credential selection

**Files:** Modify the runner and worker from Task 2 and `plans/011-project-workspaces/s0-evidence.md`.

**Interfaces:** Consumes EvidenceRow and the runner lifecycle. Produces
`runAccessProbes(runDirectory: string): Promise<EvidenceRow[]>` and
`runCredentialProbes(runDirectory: string): Promise<EvidenceRow[]>` in the runner.
Extend the CLI groups already defined; do not add a second report format.

- [ ] **Step 1: Verify the cases are missing.** Run the runner with `--group access`, then
  `--group credentials`. Until implemented, each exits nonzero with the missing group; neither silently
  passes by writing an empty report.
- [ ] **Step 2: Implement access probes against real boundaries.** Use the temporary Team API and stores
  pattern from `scripts/agent-access-e2e.ts`, with synthetic principals and unique content markers.
  `audience-and-derived-content` reads a real channel, summary, memory, result, attachment and event
  from each available principal path; repeat after adding a reader and revoking existing access.
  Record exactly which paths disclose the marker. Do not infer project ACL support from agent-level ACLs.
  `local-owner-and-remote-principal` traces the actual local actor before and after signed-in state
  changes, and attempts the local identity through a remote route. Distinguish identity continuity from
  authentication. If a headless service cannot exercise local IPC, record that path as unverified;
  a mocked identity callback cannot establish durable local ownership.
- [ ] **Step 3: Implement credential probes with fake credentials and loopback endpoints.** Use the real
  connector/proxy with its injected fetch boundary. `credential-fallback` tests proxy available/unavailable
  and repository token present/absent; record the selected credential class for MCP, Git helper and `gh`.
  Inspect generated helper behavior in an owned child with synthetic files. `credential-revocation`
  checks new requests after disconnect while an admitted request finishes. Assert raw synthetic token
  values do not reach reports. If a hard-coded remote endpoint prevents a local probe, keep that row
  source-only/unverified; do not send test or real credentials to GitHub or modify the product adapter.
- [ ] **Step 4: Verify each group sequentially.** Run
  `bun scripts/project-workspaces-s0-e2e.ts --group access`, then the same command with `--group credentials`.
  Validate each printed report path with `--verify-report`. Expected: complete evidence for every named
  case, no remote requests, no token values in artifacts, and unsupported/unverified controls stated plainly.
  The four combinations in `credential-fallback` must each have a row, including inaccessible test paths.
- [ ] **Step 5: Run focused checks and commit.** Run changed-file Biome for changed scripts, then
  `bun run typecheck:node`. Commit only diagnostic source and evidence with
  `test: probe project audience and credential boundaries`. Existing code remains unchanged even when unsafe reuse is found.

## Task 4: Decide readiness and write the bounded S1 handoff

**Files:** Update `plans/011-project-workspaces/s0-evidence.md`; create
`docs/superpowers/plans/2026-11-01-project-workspaces-s1.md`.

**Interfaces:** Consumes validated reports and the source matrix. Produces a per-mode readiness decision
for `planning-only`, `manual-trusted`, `hard-gated` and `unattended`, plus exact S1 tasks only where
the required boundary is demonstrated. These labels describe proposed project use, not the safety of unrelated existing app features.

Keep implementation feasibility separate from release readiness. Missing project tables, grants,
review records and commands are expected S1 work. They need not exist for S0 to finish or for an S1
design to be written. Prove the underlying trusted identity, mediation, transaction and process-control
boundaries, then map each missing project control to an exact S1 operation and acceptance test.
Keep that control unsupported in the current-code matrix until implemented and verified. An unmediated
execution path or unknown worker lifetime cannot be repaired by merely adding a future test to the plan.

- [ ] **Step 1: Verify the evidence set.** Run `--verify-report` for each report referenced in the matrix.
  Compare its commit, platform and mode with the code now under review. Rerun only groups whose source
  changed or evidence is incomplete. A passing harness with an unsupported control is not approval.
- [ ] **Step 2: Apply the release-readiness rule.** D2 is required even for scoped planning. Manual execution
  requires D1-D3 for admission, effective audience, durable handoff and termination/reconciliation;
  a trusted label can disclose missing confinement but cannot waive these controls. Hard-gated and
  unattended modes also need real evidence for all relevant shell, filesystem, network and MCP routes.
  If any required row is unsupported or unverified, keep release of that use blocked and name the missing
  control. Separately classify implementation as feasible with specified S1 controls, blocked by a
  demonstrated missing enforcement boundary, or unverified because the probe did not establish it.
- [ ] **Step 3: Record live-provider limits.** This default S0 run does not launch live providers or use
  account credentials. Therefore it cannot certify their confinement. If live proof is needed, define
  a separate bounded probe for one exact installed version and mode, with synthetic resources, allowed
  destinations, cost and cleanup, before requesting its execution. Do not label a fixture result as that proof.
- [ ] **Step 4: Write the handoff.** If the underlying boundaries permit a bounded S1 design, use the writing-plans header and task format
  for S1, with exact schemas, signatures, ownership and focused test commands. Include the first target's
  existing task mapping, per-generation delivery keys, delegated-task policy, local owner/account linking,
  audience and derived-content checks, pending cancellation, late completion, deletion/receipt retention,
  review ID/generation/criteria checks, host-switch behavior and accessible creation/review flows.
  If the necessary boundaries cannot be established, write a blocked handoff identifying the prerequisite design and the
  narrower planning-only option, if D2 permits it. Do not invent implemented controls or claim the S1
  implementation plan is ready. A feasible S1 design must label new controls as work to implement,
  not proven capabilities. Reuse already approved product decisions; ask only about new tradeoffs.
- [ ] **Step 5: Self-review and commit the handoff.** Check all Plan 011 D1-D3 requirements against rows,
  every Review Focus case against an artifact, and all references/signatures against earlier tasks.
  Run `git diff --check`. Commit the two documents with `docs: record project feasibility and S1 readiness`.
  Report confirmed boundaries, unsupported modes and unverified claims in one table. No push, PR,
  production change or feature implementation is part of this task.

## Completion and handoff

S0 is complete when the scoped probes and source inventory have an auditable result, missing evidence
is explicit, and the next-step decision is written. Completion can leave every execution mode blocked.
It does not mean D1-D3 passed. Do not mark S1 ready or any gate satisfied without the required evidence.

No provider scope changes, account-service schema, UI redesign, migration, production authorization
logic or new sandbox belongs in S0. CI integration for any diagnostics retained as release checks must
be specified in the subsequent implementation plan with the current CI owner; do not silently claim
that standalone scripts already run in CI. Review this plan before separately authorizing its execution.
