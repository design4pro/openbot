# S1-local evidence

This matrix records implementation evidence for the approved
[local identity and protected planning design](../../docs/superpowers/specs/2026-11-01-local-identity-protected-planning-design.md).
It does not enable D1/D3 execution, project grants, conversation handoff, GitHub integration, or full
provider confinement. S0 observations remain historical facts; this document records the narrower
S1-local follow-up.

## Evidence boundaries

Service fixtures prove domain/filesystem behavior. Native reports exercise real native processes on
an empty Xvfb display. Electron reports exercise the production service graph, IPC/preload, and window
controller. UI reports exercise real keyboard/pointer controls and stored data. Files and remote
application groups use the registered disposable app, actual server adapters, and positive ordinary
controls. A service report cannot substitute for an application or native report. The verifier rejects
missing cases, failed evidence, incorrect basis, and a service report relabelled as native.

Reports live under `.openbot-build/project-planning/<run-id>/<group>/report.json` and are ignored by
Git. They include source hashes, checkout commit, runtime, platform, required cases, and evidence basis.
Application reports also hash the loaded main/preload bundles. A report is evidence, never a runtime
capability. The main-owned native support map does not read report files.

| Accepted requirement | Evidence and result | Limit |
| --- | --- | --- |
| Durable owner, concurrent creation, copy, new profile, corruption refusal | Task 1 identity: `ad6f7278-e8f0-4a59-a131-f90169cc86a4`, 5 cases; additive schema 50 migration/parity fixtures | A complete consistent profile copy is required; no account recovery feature |
| Released data preservation and failure behavior | 53 local migration fixtures, schema parity, affected historical migration fixtures | No production database was upgraded during testing |
| Same-opened-file exclusion, aliases, ordinary symlinks, storage overlap | Task 2/9 files-service: `91d7993e-f364-42d5-9536-5b4b2817a908`, 9 cases; actual files: `67eb3260-03f4-4687-9947-7bdb68da871e` | OS processes with full user access remain outside protection |
| Actual HTTP, browser upload destination, staging, instance export, public-mode exclusion | Actual files group includes positive ordinary controls and protected refusals | External websites and production data were not used |
| Managed protocol and backup replacement races | Actual files group: protocol ordinary control, DB replacement refusal, backup ordinary copy control and replacement refusal | Linux backup staging is observed before the existing unavailable ditto compressor; no complete Linux backup archive claim |
| Atomic capture/control exclusion, uncertain stops | Admission `d4aab076-8563-461d-81b9-c03fbc5b96fa`, 8 cases | Service report only; separate native/app proof required |
| Stale daemon client, queued input, persistent native leases, crash/restart recovery | Native `0712bb56-250a-461d-9ca6-7579276e28a4`, 11 cases; real input observation and Sunshine/Moonlight | Only the exact isolated configuration below |
| Revisions, replay, payload conflicts, drafts, owner check before replay, crash reconciliation | Domain `b942dfbf-8158-4a94-8895-e307ab3f94d3`, 16 cases | No live provider execution |
| Manual gates, criteria invalidation, stale decision refusal, durable review history | Reviews `ddb7fc44-7986-4efe-a625-ec8e242e7a46`, 6 cases | Manual evidence only; no automated verification or agent handoff |
| Account-independent ownership, authorized main frames, host generations, actual renderer destruction | Task 9 fresh full Electron `9a8bff0e-5db2-40e4-b6f8-103c744c5922`, 12 cases; protected sender/preload tests | Account transport and keyring ports are synthetic |
| Active-local-host Work, Tasks/Undo, keyboard forms, validation, conflict/recovery, quota, multiwindow save/stay/discard | Task 9 UI `afd81ac3-8478-423f-92d5-7622ded35e93`, 23 cases; preview consumer and focused renderer checks | Not a WCAG certification or a screen-reader audit |
| Remote content/event/route absence, roles, protocol v1-v9, diagnostics, mute/unmute, revoke/reconnect | Task 9 remote `12e30e2f-469a-40c8-b735-1558e7df2bda`, 13 required cases; real HTTP/WebSocket plus production WebRTC RPC/events/revoke/reconnect pass | Synthetic account/Signal issuance; no WAN/TURN claim |
| Unexpected worker death and report rejection | Verifier `aab2ac0c-73f5-412c-bde5-09648e462bb1`, actual positive reports plus 4 negative cases | Semantic report validation is not cryptographic attestation |

The final supervised run on commit `30601a7737c73ca98499ac846e494925634e016e` passes all four
application groups: launcher `efb7342f-e41a-40f0-9432-098e239d118b`. It stopped both exact owned stacks
with no unresolved records. The cgroup remains at oom=50 / oom_kill=6; there were no new OOM events.
This validates local launcher composition and cleanup, not execution of a GitHub Actions runner.
Earlier failed cold/reload observations remain open limits below.

## Exact native/application configuration

- Ubuntu 24.04.5, Linux x64 under OrbStack/Rosetta; kernel
  `7.2.12-orbstack-00394-gbecdd6130068`; empty Xvfb display.
- Electron 44.9.3 with embedded Node 24.22.0; standalone native/service Node 26.13.0; Bun 1.4.2. Non-root application user, sandbox and context isolation on,
  node integration off. Container seccomp is unconfined to permit Chromium user namespaces.
- Two container CPUs, 12 GiB memory limit, no additional swap. No host profile/display/device mounts,
  credentials, or published ports. WebRTC uses an owned Docker internal network and loopback Signal.
- CUA driver 0.34.0, SHA-256: `5fa60c7ab35194e0e050a337521ca0e0b0ae0a8fe898813b340f65c94e15264c`.
- Sunshine: `29ff4dbd7c0700ffd6d1ddf005f9e28bb063b54dcfefd80a030dc50f84a000a3`.
- Moonlight web server: `f5033d624d88d434f3b4ee33222071f33076632efa258ceab35cd5412b43e16a`.
- Moonlight streamer: `029e779646b4d022d325e55b4864f238a82b81b3f9037fe576c8e33cd29ff898`.

macOS, Windows, physical X11, ARM64 application integration, other kernels, and different native
artifacts remain unsupported. No result here enables those configurations. Verify the exact mapping
in `src/main/private-planning-support.ts` before interpreting an entry refusal.

## Repeatable focused commands and CI

Run service groups sequentially on disposable profiles:

```sh
bun scripts/project-planning-e2e.ts --group identity
bun scripts/project-planning-e2e.ts --group files-service
bun scripts/project-planning-e2e.ts --group admission
bun scripts/project-planning-e2e.ts --group domain
bun scripts/project-planning-e2e.ts --group reviews
bun scripts/project-planning-e2e.ts --verify-report <report-path>
bun scripts/project-planning-report-e2e.ts --report=<actual-positive-report>
```

Only on an approved, empty isolated Linux display with installed pinned native runtimes:

```sh
OPENBOT_PLANNING_ISOLATED=xvfb xvfb-run -a sh -c 'bun scripts/project-planning-e2e.ts --group native --isolated-display="$DISPLAY"'
OPENBOT_PLANNING_ISOLATED=xvfb xvfb-run -a bun scripts/project-planning-launch-e2e.ts --mode=full
```

The launcher owns one named disposable profile and runs Electron/UI/files/remote sequentially. It
stops the destructive Electron suite's exact stack before starting a fresh process for UI/files/remote,
validates complete reports, and stops only its current stack through the registry. It requires an unused worktree. A bootstrap,
narrow lifecycle, unsupported, or public-files report cannot certify positive private app behavior.
For a separately prepared named instance, application groups require explicit mutation authorization:

```sh
bun scripts/project-planning-e2e.ts --group files --instance=<name> --allow-mutations
bun scripts/project-planning-e2e.ts --group remote --instance=<name> --allow-mutations
```

`ci.yml` selects service/verifier cases in the Team API lane and real native behavior plus unsupported
application admission/public file protection in the browser lane. Hosted CI uses
`project-planning-launch-e2e.ts --mode=unsupported`; its kernel does not match the positive support map.
`cua-driver.yml` adds separate manual native and full application jobs. The full job requires a
self-hosted `openbot-planning-isolated` runner matching the reviewed map. No such runner was provisioned
or workflow dispatched here. Workflow execution remains unverified. Installation integrity alone is
not native privacy evidence. Changed-file Biome and focused node/renderer checks are local; broad
lint, builds, and repository tests remain with CI.

## Failed observations and open release limits

Earlier development runs exceeded 3/5/8 GiB limits and were invalidated by OOM kills. Complete 12 GiB
UI runs had no new OOM kills. Some earlier cold/repeated Vite reloads reported Chromium resource
refusal. Catalog prebundling/cache refresh is retained; extra unproved prebundling/warmup hypotheses
were removed. This does not establish the cause or universal elimination of those failures.

One earlier reused-profile public PiP diagnostic ended in native SIGILL without a new OOM event.
The local minidump had no usable module list; its cause is unconfirmed. A transient private-entry
`unavailable` observation also remains unexplained. Later complete runs pass, but neither observation
is established as fixed. Repeated fixtures also emitted a MaxListeners warning. These remain release
investigation concerns; raw dumps and the early synthetic DB-bearing assertion diagnostic are not
shareable evidence artifacts.

No live provider turn, real account/Signal issuance, system keyring, full provider-shell confinement,
WAN/TURN, production deployment, or broad CI suite was exercised. Runtime status/download attempts
are not provider execution. Local planning operations in UI proof record zero sendMessage/startTask
and zero GitHub connector operations. The application privacy boundary does not cover full-access
same-user processes.

## Independent review follow-up

The single independent whole-branch review found two file-delivery gaps and two admission/configuration
gaps. Actual native-path uploads failed before the guards; all nine local preview/save/archive/open
replacement cases failed before the final-reader and checked-copy changes. The focused main boundary
file failed three first-entry recovery cases before its fix and now passes 28/28 cases.

- Files report `37d32476-8423-4ec3-bc43-e162a4549703` passes 38 application cases, including ordinary
  controls and all replacement cases. This is pre-commit evidence with source/bundle hashes.
- Negative platform report `5b980108-ed15-4405-bb8f-21707a491602` rejects an unknown distribution and
  Ubuntu 24.10 through the real compiled gate. Its `electron-platform` basis is not full integration
  evidence. The gate now requires `ID=ubuntu` and `VERSION_ID=24.04` plus every existing native pin.
- External opening retains checked copies under the profile's `local-open-copies` directory. The UI
  says Open copy and explains that external edits do not update the original. The test observes the
  final OS handoff port; it does not certify an external program or OS confinement.

The first rerun of the files group correctly failed ordinary export because an earlier watchdog-aborted
owned fixture left a database hard link in Shared. Only that exact inode-confirmed fixture alias was
removed. Neither export protection nor the failure report was suppressed.

The final post-review integration on commit `e5f35128b` passes all 88 application observations:
Electron `2a472041-3d96-4660-b3b3-327cf332f371` (14), UI
`cdaac86e-5585-421d-8c55-f71e653e6b82` (23), files
`110bb5b7-9c79-44a3-b7d0-96192f185a57` (38), and remote
`12534440-36ee-4ac9-b5fc-5cef74b08f6c` (13). Launcher
`b64556ac-094e-4b75-98c8-440274790bbd` stops both stacks with no unresolved records.
OOM counters remain 50/6. Verifier `278b6d24-5134-483d-a5d2-8e165bdeeb95` passes actual
application controls and rejects missing runtime/cases, a false native label, and owned worker SIGKILL.
Focused boundary tests pass 28/28. Node/renderer types, changed-file Biome, i18n validation, and the
normal commit hook pass. Broader checks remain assigned to CI. No second review was dispatched.
