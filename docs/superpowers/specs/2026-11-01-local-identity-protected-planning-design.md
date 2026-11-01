# Durable local identity and protected local planning

**State:** Proposed design for developer review. No feature implementation is authorized by this document.
**Prepared:** 2026-11-01 against `362613391`.
**Parent:** [Plan 011](../../../plans/011-project-workspaces-and-github-integration.md).
**Handoff:** [S1 blocked handoff](../plans/2026-11-01-project-workspaces-s1.md).
**Evidence:** [S0 findings](../../../plans/011-project-workspaces/s0-evidence.md).

## Intent and scope

Let a person keep a private project plan on their OpenBot computer without an account, provider or
network connection. Ownership must survive restart and account changes. A local owner can create
projects, milestones and tickets, record manual progress, and make a version-bound milestone decision.
This is a narrower S1 candidate, called **S1-local** here. It does not enable ticket execution.

Success means both durable ownership and enforced application access. A hidden page alone is not
protection. Project content must not enter shared channels, agent context or remote transports.

The design excludes execution attempts, assignments to agents, repository provisioning, GitHub,
remote project access, account-link UI, attachments, automatic summaries, import/export, deletion,
and a drag-and-drop board. Existing Tasks, approvals, Undo and conversation links keep their behavior.
Planning uses a list and detail view. Archive and restore are the supported reversible lifecycle.

## Confirmed developer decisions

- Full local operation, including milestone release, needs no OpenBot account.
- The owner belongs to the application profile. Sign-in and sign-out do not change ownership.
- A complete, consistent profile copy preserves ownership and local project access. A new empty
  profile receives a new identity. An account alone cannot recover a lost profile.
- Protection applies to OpenBot application interfaces, including screen viewing/control. Local
  processes with the operating-system user's full permissions remain outside this protection.
- A protected planning view and remote screen viewing/control must exclude each other.
- Work shows projects of the active host only. The first candidate exposes local-profile projects
  only when the local host is selected; it does not aggregate projects from other hosts.
- Future execution must reject an incompatible conversation audience. This slice provides no
  conversation destination or handoff, so it cannot silently bypass that requirement.

All other selections below are design recommendations, not additional developer decisions.

## Current facts and their limits

| Evidence in this checkout | Consequence |
| --- | --- |
| `src/main/host-service.ts:1726` uses `local` signed out; `:1789` can use an account or member identity | Preserve released channel actors. Do not reuse them as project owners. |
| `src/main/team-store.ts:325` activates an account-bound host; `:394` deactivates it | Local identity and scope cannot depend on `TeamIdentity` or host network registration. |
| `src/backend/database/database-core.ts:56` owns `<userData>/openbot.db`; `:108` owns command transactions | Use this database and transaction owner, not a new database or JSON authority. |
| `src/main/ipc/define-ipc-group.ts:91` and `src/main/trusted-ipc.ts:184` support sender authorization before decoding | Add narrowly authorized local endpoints; a trusted URL alone is insufficient. |
| S0 found shared channel results/memory readable by new members | Store no project copy in existing conversations or their derived content. |
| `src/main/screen-capture.ts:139` lists windows and captures desktop content; `src/main/remote-screen-gateway.ts:489` starts sessions | Data API denial does not prevent visual disclosure. A common admission boundary is required. |
| `src/main/cua-driver-runtime.ts:343` falls back from the tap to the daemon socket | An observation tap alone cannot authorize native CUA. Existing clients and the fallback must be mediated or unavailable during private planning. |
| `src/backend/agent/browser-uploads.ts:80` permits any readable upload path; `src/backend/agent/attachment-gateway.ts:340` can skip containment | App-managed file transfer needs a protected-profile exclusion independent of ordinary workspace scope. |
| `CONTRIBUTING.md:162` preserves intentional full agent access | No claim of isolation from a provider shell, external screenshot tool or same-user process. |

These are source findings, not evidence that the proposed controls already exist. S0 did not prove
full Electron IPC, native CUA, screen exclusion or durable owner continuity. No full profile
backup/restore feature was found in `README.md`, `docs/architecture` or `src/main/ipc`; copy semantics
below are a data contract, not a new backup interface.

## Identity and authority

### One profile owner

Add a single profile identity record to the host database. It contains a random UUID principal ID,
a separate random UUID local scope ID, and a creation timestamp. A unique singleton key prevents
two owners. Both IDs are stable identifiers, not secrets, passwords, bearer tokens or remote host IDs.

An atomic bootstrap creates the record only on a known first initialization after the schema
upgrade. The bootstrap and its marker commit together. Once initialized, a missing, malformed or
conflicting identity is an integrity error: disable planning and retain all data. Never create a
replacement owner on a read failure. Existing chats, agents and legacy `local` authors are unchanged.

Project creation always assigns this principal as its sole owner. No public request can set or
change the owner. There are no member or agent grants in S1-local. The domain verifies the owner
on every list, detail, mutation, receipt replay and private notification subscription.

### Trusted local session

Main derives a non-serializable local planning context after it validates all of the following:

1. A live, registered main application `WebContents` and its top-level frame made the call.
2. Existing navigation and trusted-origin checks pass; browser docks, web pages, subframes and
   auxiliary windows are not authorized.
3. The main-owned scope selection is local, and its current generation matches the request.
4. A protected planning session is admitted under the visual/control rules below.

The context contains the profile principal and local scope read from main-owned persistence.
The renderer may supply object IDs, an operation ID and expected revisions. It cannot supply
authority through `ownerId`, `principalId`, an email, `accountId`, `serverId: "local"` or a token.
Unknown authority fields are rejected by the new request schemas. A scope generation is a freshness
check, not an authentication credential. It changes on navigation to another host or renderer reload.

Domain operations accept the internal context, not a caller-selected identity. They enforce current
ownership even when invoked outside IPC. The preload bridge has no identity-selection operation.
A compromised authorized main renderer has the local user's application authority; this design does
not claim to distinguish a human from arbitrary code inside that trusted renderer.

### Accounts and remote callers

Sign-in, sign-out, account switch, token refresh and remote membership changes leave the local
identity and projects unchanged. Do not infer a project grant from email matching, host ownership,
server role or signing in on another computer. Do not merge identities on account activation.

S1-local has no account-link operation or relation to populate. A later explicit account-link design
may associate a verified account with the profile principal. Such a relation must remain separate
from ownership, project grants and remote authentication. Linking must not make a remote account
the local principal. Unlinking must not remove local ownership. No account metadata or project
content needs to be sent to Cloudflare for S1-local.

### Copy, restore and loss

A closed, complete profile copy or a consistent SQLite backup preserves both IDs and projects.
Copying only `openbot.db` while WAL writes are active is not a supported consistent copy procedure.
Two restored copies are independent local histories with equal identity IDs. They do not synchronize,
merge, acquire cross-computer authority or share a global execution lock. Local IDs never authenticate
a network request. This slice does not clone, restore or re-enable Team API sessions or listeners.
Its identity bootstrap must not call account-host activation.

A new profile receives new IDs. It cannot adopt orphan project rows or import another profile's
ownership. Loss of both profile and backup means loss of this local history; signing in cannot
recover it. Ownership transfer, partial-profile merge, reset and automated repair are deferred.

## Protection of stored and derived data

### Positive local surface

Only dedicated local planning IPC operations and their authorized private window notifications can
read the new tables. Keep project records separate from conversation, channel, memory, attachment,
search and agent projections. A private update notification contains scope, object ID and revision;
it triggers an authorized refetch and contains no title, note or criteria text.

| Surface | Required S1-local behavior |
| --- | --- |
| Main application, local scope | Authorized owner can read and edit through the planning domain. |
| Team API v1-v3, WebRTC, web and mobile clients | No planning capability or project routes. No project fields added to released responses. Guessed project IDs disclose no project existence or content. |
| Generic host event delivery | Do not forward project events, counts, titles or notifications to peers. Dispatch events remain internal to the database. |
| Agent tools, MCP, routine and workflow inputs | No project resource or context injection. No project execution entry point. |
| Channel history/results, summaries, memories and attachments | No automatic copy or link preview from project content; existing readers cannot join to private tables. |
| Global search, notifications, recent items and window titles | No private titles or snippets outside the admitted planning session. Window titles stay generic. |
| Logs, telemetry, diagnostics and support exports | No project body, draft, criteria, receipt payload or database copy. Record safe codes and opaque IDs only when necessary. |
| App-managed local file uploads/attachments | Reject reads from protected profile files, including DB, WAL, SHM, journals and any future private sidecar. |
| Clipboard, user screenshots and manual retyping | Explicit user disclosure remains possible. No automatic copy or export feature is added. |

Existing aggregate database/disk byte counts may change when local records grow. They remain released
storage statistics; this design does not hide disk usage, timing or traffic-analysis side channels.
Do not add project-specific sizes, counts or identifiers to those statistics.

The file exclusion is applied at the common file-opening/transfer boundary and every caller that
can bypass ordinary workspace containment, including browser upload and additional-folder grants.
Maintain one protected-file policy for the database and its SQLite companions; add any future private
storage at its creation boundary. A workspace grant cannot override it. Compare canonical paths and
opened-file identity; reject symlink, hard-link and replacement races that could read a protected live
file. Ordinary managed attachment drafts can live elsewhere inside the profile; do not reject the
whole profile directory or weaken their existing read policy. If an adapter cannot enforce this
before reading bytes, disable that adapter's transfer while planning is enabled.
This is an application-transfer policy, not a filesystem sandbox. A same-user shell can copy data
elsewhere; this accepted OS boundary cannot be repaired with path validation.

The same policy must cover application-mediated workspace/shared reads, directory listings, storage
detail, instance transfer and browser file navigation when configured roots overlap protected files.
A path outside the normal profile layout is not sufficient proof of safety. Existing aggregate disk
statistics remain allowed. Copies created outside the application by an OS user remain outside the
protection contract; this slice creates no private database export or backup copy.

No new attachments or shared caches exist in this slice. Notes and criteria are plain text. Render
them as text; do not load remote images, execute HTML, fetch URL previews or interpret file paths.
No renderer `localStorage`, cross-host search index or analytics property may hold project content.

### Visual and control exclusion

Use one main-owned admission coordinator for private planning exposure and OpenBot-mediated
screen viewing, capture and computer control. A renderer boolean or Electron content protection
alone cannot enforce this rule. Native CUA and remote desktop must use the same admission decision.

The coordinator has public, entering-private and private states. It serializes conflicting admissions:

- Entering private requires no active or starting remote-view/control session, local remote-screen
  test session, Computer Use/CUA session, in-flight capture or queued input. Unknown state refuses entry.
  The owner may end those sessions through their existing controls and retry; do not stop them silently.
- Reserve entering-private before loading any project payload or draft. New conflicting sessions,
  capture-source enumeration, screenshots, accessibility reads and input are refused from that point.
- Commit private before delivering content. Every relevant native adapter must participate, including
  already-created handles, subscriptions and delayed work. An approval granted earlier is no bypass.
- Private scope covers every application window that received project data, including hidden views,
  drafts, errors and notifications. Navigating away or hiding a window does not release protection.
- To leave, save or explicitly discard drafts, then destroy/recreate all data-bearing application
  `WebContents` under a generic public shell. Main releases private state only after destruction,
  pending private responses and subscriptions are invalidated. A lost acknowledgement, native session
  cleanup failure or unknown queued input keeps the conflicting operation blocked.
- If a private renderer crashes, keep protection until that renderer is destroyed and outstanding
  deliveries are fenced. A main-process restart begins without private responses and rechecks native
  runtime/session state before either admission. An unverified surviving helper prevents entry.

This coarse session boundary is a deliberate simplicity choice. It avoids asserting that a hidden
DOM node, cleared signal or per-window screenshot flag erased all private content. A focused Work
session may require a window reload to restore computer control. Explain that consequence before
entry and preserve saved planning data and unrelated application state through existing persistence.

General provider processes, external OS automation, screen readers chosen by the user and external
screen-recording applications are not confined by this coordinator. OpenBot-integrated CUA and file
transfer adapters are in scope even when they ultimately invoke OS APIs. Existing full-access shell
capability remains outside the accepted boundary; do not label this as full agent isolation.

Any unmediated OpenBot native viewing/control route blocks the S1-local release. Source review must
inventory adapters and test their actual invocation; an injected fake cannot certify native capture.

## Planning domain and persistence

Use the existing `OpenBotDatabase` / `DatabaseCore` transaction authority. Add focused identity and
planning controllers within backend, and a main service for authority and admission. Do not open
another SQLite connection as a second command owner. Effect 4 domain operations compose existing
runtime layers; synchronous SQLite transactions stay synchronous and contain no external I/O.
Use the repository's pinned dependencies and PolyForm Noncommercial 1.0.0 license; no new runtime
dependency is selected by this design. Boundary contracts remain platform-independent.

The storage model needs these logical records; the implementation plan selects exact SQL names:

| Record | Required fields and invariants |
| --- | --- |
| Profile identity | Singleton, principal UUID, local scope UUID, creation time, initialization marker. |
| Project | ID, local scope, sole owner, title, goal, revision, archive state and timestamps. |
| Milestone | ID, project, title, criteria text, criteria revision, gate generation and gate state. |
| Ticket | ID, project, optional milestone in the same project, title, criteria, notes, manual status and revision. |
| Review | ID, milestone, criteria snapshot/revision, gate generation, manual evidence note, submitting owner and time. |
| Decision | Review ID, owner, release or request-changes, rationale, command ID and time. Immutable. |
| Project command metadata | Actor, scope, operation ID, canonical request fingerprint and project-owned event reference. |

Ticket status is `todo`, `in_progress` or `done`; it is a human planning value, not a worker state.
Moving it makes no provider call and never produces an execution outcome. A milestone gate starts
`open`. Review submission increments its generation, creates an immutable criteria snapshot and
makes it `in_review` atomically. Only the owner can decide the current review:

- Release writes an immutable decision and makes the gate `released`.
- Request changes writes a decision and makes it `changes_requested`.
- Criteria edits in `in_review` or `released` supersede the old review and make the gate
  `changes_requested`; the old decision remains historical. Criteria changes never imply release.
- Resubmission from `changes_requested` creates a new review ID and generation. Old decisions
  cannot affect it. There is no general reopen button that bypasses a current review.

Release names the review ID, gate generation and criteria revision, with expected aggregate revision.
Submitting requires nonempty criteria and a manual evidence note. No worker evidence is inferred.
Released means the owner accepted that criteria snapshot; it does not start work, grant a credential
or certify execution. A future execution design must define admission against this record explicitly.

All mutations use optimistic revisions and a caller-generated operation UUID. Authorization and
revision checks, event append, projection update and receipt commit in one host transaction. Within
the same actor/scope namespace, the same operation ID and canonical payload return the original
result without a second event; a changed payload conflicts. Recheck current authority before returning
a receipt. Check replay before stale expected revisions so a lost response can be recovered.

Project-owned fingerprint metadata complements existing receipts without changing the meaning of
released `dispatch()` callers. Canonicalization uses a fixed field order over decoded command data,
including command kind, target IDs and expected revisions; do not hash raw JSON property order.
Use project-owned events/receipts only, with no channel aggregate in that command. Archive retains
history and receipts, so channel or agent deletion cannot remove them. Hard deletion is deferred.

Archived projects are read-only, except for owner-authorized restore. A stale mutation conflicts;
it does not silently apply a partial overwrite. Project detail returns current revisions so the UI
can preserve an edit and offer an explicit retry after review of the current value.

## Work, drafts and accessibility

Work remains an active-host page. A new stable local scope key is independent of account-bound
TeamStore IDs. It represents this profile only. Selecting a remote host shows a generic unsupported
state and makes zero planning requests to that host. Returning to local restores local selection.

Use the existing keyed host scope and a planning port. The renderer never reads `window.openbot`
from a view or context. Shared list/detail/form controls belong in `packages/ui` and receive typed
data/actions. Platform authority and draft persistence stay in the application adapter.

Drafts are owner-only host database records, separate from committed objects and events. Persist
explicit saves of drafts without changing project revision; changing hosts waits for a completed
draft save or offers an explicit discard. A save error retains the private session and editable input.
Draft keys include local scope, object ID or create-form ID, and window draft ID. Two windows do not
overwrite each other's drafts. Reload/restart restores the saved draft after private admission.
Bound text fields to 256 Unicode code points for titles and 32,768 for each goal, criteria, note or
draft text field. Never truncate silently. A fresh implementation must define pagination and bounded
draft retention before release; it must not evict unsaved content without the owner choosing discard.

Host A -> B -> A uses fresh scope generations. A delayed response cannot populate the current scope,
even if its stable local scope ID matches again. Invalidate subscriptions and in-flight calls on exit.
Private drafts must not appear in a generic public shell during the reload that ends private mode.

Provide labelled inputs, keyboard-only create/edit/review/archive/restore, visible focus, focus return
after dialogs, announced save/conflict/refusal errors, and a readable list alternative to any later
board. Interface text comes from i18n keys. Preserve input on validation errors and revision conflicts.
No layout or screenshot assertion substitutes for behavior and data evidence.

## Migration, ownership and implementation boundaries

The backend schema owner adds the next unused migration and updates the separate latest schema and
append-only schema history. Do not reserve a numeric migration from this design's checkout. Preserve
all released source schemas and existing rows; no automatic migration backup exists. Owner bootstrap
and failure behavior need rollback and concurrent-open fixtures, plus new-schema parity.

The future implementation plan must map these responsibilities to exact files and interfaces:

- Backend identity, planning records, drafts, authorization, revisions and host transactions.
- Main trusted-local-session derivation and the shared private-exposure admission coordinator.
- IPC schemas/registration, preload bridge and preview mock; no Team API planning mirror.
- ScreenCapture, RemoteScreenGateway, CUA and file-transfer adapters that must enforce admission.
- Renderer Work scope, local planning port, shared forms and private-session exit/reload behavior.
- Existing CI owners for selected E2E scripts, migration and trust-boundary tests.

No mobile, public web, auth service, site-router or Signal project feature is added. Those consumers
must be checked for absence of new private data or protocol reinterpretation. `PRIVACY.md` and
architecture docs must state the actual application and OS boundaries when implementation ships.

## Acceptance evidence required before release

Each row requires a repeatable artifact from an isolated profile using actual application/service
paths. Mark any unavailable native surface unsupported; do not replace it with a fixture success.

| Area | Required behavior and evidence |
| --- | --- |
| Durable owner | Offline signed-out create/edit/restart/release; sign-in/out and account A -> B preserve IDs and ownership; fresh profile differs; consistent closed-profile copy preserves it. |
| Failure and migration | Every affected released schema upgrades with data intact; fresh schema parity; concurrent bootstrap yields one identity; corrupt/missing post-bootstrap identity refuses access without rewriting it. |
| Trusted local IPC | Real Electron owner window succeeds; subframe, browser dock, auxiliary window, remote/body-supplied actor and stale scope generation fail before project reads. Keep protected sender tests. |
| Remote absence | Actual Team API/WebRTC, web/mobile consumers, event subscribers and guessed IDs expose no project-specific content, existence, title or count; aggregate disk statistics retain their existing meaning. |
| Derived content | Distinct canaries in project, draft, note and criteria are absent from conversation/result/summary/memory/attachment/search reads, generic notifications, logs, telemetry and diagnostic exports. |
| File transfers | Browser upload, attachment and additional-folder paths reject DB/WAL/SHM/profile sources, canonical path aliases, hard links and replacement races; ordinary workspace attachments still work. |
| Visual/control races | Race private entry against remote session creation, native CUA, capture, source enumeration, accessibility reads and queued input. At most one admission succeeds; test active and previously approved sessions. |
| Private exit and recovery | Hidden view, second window, failed draft save, renderer crash, pending response and uncertain helper cleanup keep protection; exit destroys all data-bearing renderers before public control resumes. |
| Commands and gates | Same operation replays once, changed payload conflicts; crash before/after commit leaves one outcome. Two windows cannot release a stale/superseded review or mutate an archived project. |
| Local workflow | Manual status, submit/release/request-changes, criteria invalidation, archive/restore and drafts persist after restart and make zero provider/GitHub calls. |
| Scope and accessibility | Local -> remote -> local ignores stale responses and retains scoped drafts; keyboard creation/review and error/focus behavior work through the real app. |

Use E2E scripts with reports under `.openbot-build/`. Protected migration, renderer/main boundary
and secret-redaction fixtures may use existing test tooling. Run only changed-file lint, focused
tests and one affected type project at a time locally; broad checks remain in CI.

## Alternatives and release decision

An account ID as owner is simpler to display but breaks signed-out continuity. A UUID in a JSON
file creates a second consistency boundary. Per-object encryption with an OS key requires a separate
key recovery and restore design and does not by itself stop screen capture. These are not selected.

The selected approach uses one host database, one local owner and a coarse private-session boundary.
It trades remote/computer-use availability during planning for a small, reviewable access model.
The expected implementation is still security-sensitive: private screen and file adapters are release
requirements, not optional polish. If they cannot be mediated, S1-local stays unavailable.

D1/D3 execution and provider confinement remain blocked. D2 is only scoped by this design; it becomes
established for S1-local after the acceptance evidence passes. This does not establish D2 for shared
projects, conversation handoff, remote grants or GitHub cached data. No live provider probe is needed
or authorized by this design.

After developer approval of this full description, prepare a separate executable S1-local plan with
exact filenames, SQL ownership, interfaces, command limits, CI selection and focused verification.
Until then, the existing S1 handoff remains blocked for implementation.

## Design review

A fresh builder reviewed this document against the S1 handoff, S0 evidence and current security
boundaries. The review found no important unanswered design questions. This was a document and
source review, not a native admission test or release certification. Link and referenced-file checks
passed; product source and dependencies were not changed.
