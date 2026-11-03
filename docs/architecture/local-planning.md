# Local planning

S1-local provides manual project planning for the current local profile. It has no ticket execution,
agent assignment, GitHub provisioning, project sharing, or remote planning API. Work keeps the existing
Tasks view and shows local projects only while the local host is selected.

## Ownership and persistence

The application SQLite database owns one durable principal UUID and one local scope UUID. Migration
and the bootstrap marker commit atomically. Once initialized, missing or invalid identity disables
planning; a read error never creates another owner. Released channel authors and account identities
retain their meaning. Signing in, signing out, or changing accounts does not change project ownership.

A complete, consistent copy of the closed profile preserves ownership. A new empty profile gets new
IDs. An account cannot recover a lost profile. This is a copy contract, not a new backup/restore UI.
Copying a live database without its required SQLite state is not a consistent profile copy.

Project commands, revisions, operation receipts, drafts, and review history use the existing database
transaction owner. Replay verifies authority before returning a receipt. Operation IDs bind to their
original command. Projects and tickets can be archived and restored; deletion is outside this slice.
Milestone decisions bind to a submitted review and the criteria revision. Changed criteria supersede
an earlier decision. Gates are manual and do not start providers.

## Authority and window lifetime

Main enrolls only registered main application windows and their exact trusted top-level frames. It
validates sender identity before decoding input. Main derives the local principal; transport payloads
cannot select an owner, account, or grant. The preload independently decodes bounded reply envelopes.
Domain operations verify ownership even when called outside IPC.

A host generation fences reads and writes across local/remote selection, failed selection, adoption,
rollback, and reload. A separate private epoch survives host changes so a user can still leave private
mode. Committed reloads renew only the exact enrolled main frame; old generations remain stale.
Auxiliary windows, embedded pages, subframes, Team API members, remote owners, and agents get no
planning authority.

The stable renderer coordinator carries only private-mode metadata. Work stores are keyed by host
and generation; stale asynchronous results cannot populate a new scope. Each window has its own form
state. New forms use independent IDs, so two new-project drafts do not overwrite each other. Draft
storage has count/byte bounds and revision checks. Failed saves retain volatile input and offer retry,
Stay, or explicit discard. Recovery requires explicit adoption of the current revision after conflict.

## Visual and control exclusion

`PrivatePlanningAdmission` serializes private exposure against public capture and native-control
leases. It reserves entry before asynchronous inspection. Persistent CUA and remote-screen runtimes
hold leases for their full lifetime. Failed or uncertain stop/restart reconciliation keeps admission
closed. An observation tap alone does not authorize control.

Private exit requires an acknowledgement from each live enrolled window. Save failures, Stay, missing
responses, and a 30-second unconfirmed-exit deadline abort exit and preserve input. After confirmation,
main fences private delivery, destroys the actual private WebContents, rebinds window-dependent
services, then releases exclusion. Hiding a view, a preload reload, or losing an IPC reply cannot
release it. A crashed renderer remains under exclusion until its destruction is confirmed.

Native support is an exact main-owned source mapping of platform, architecture, OS/kernel, Xvfb,
and installed binary digests. Reports, environment flags, and renderer payloads cannot enable support.
Missing, unknown, or unproved configurations refuse entry. The current positive evidence is for the
isolated Ubuntu/x64 OrbStack/Xvfb configuration in the [evidence matrix](../../plans/011-project-workspaces/s1-local-evidence.md).
macOS, Windows, physical X11, and other kernels remain unsupported.

## File and projection boundary

The live `openbot.db` and its WAL, SHM, and rollback journal are excluded from application file delivery
at all times, including public mode. The shared policy checks canonical paths and device/inode identity
on the same opened source handle before bytes or response headers leave the adapter. This covers
workspace/shared/additional-folder reads, managed attachment/avatar/logo protocols, staging,
attachment ingestion, browser uploads, instance transfer, and maintenance backup copies. Ordinary
files and ordinary symbolic links retain their behavior. Metadata-only validation cannot authorize a
later open after a path replacement.

Planning records do not enter channel history, summaries, memories, search, agent context, shared
events, normal exports, or diagnostics. Aggregate disk size can include the database. Existing Team
HTTP/WebRTC codecs and permissions remain in place; there are no planning routes or remote grants.

## Protection limit

This boundary covers OpenBot interfaces. A process with the operating-system user's permissions can
read the profile, run its own screenshot tool, or bypass application mediation. S1-local provides no
provider-shell or operating-system confinement. The isolated proofs do not execute a live provider,
use real account transport/keyring, or certify WAN/TURN connectivity. See the evidence matrix for
failed observations, exact runtime limits, and CI ownership.
