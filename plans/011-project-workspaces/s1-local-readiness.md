# S1-local release readiness audit

Date: 2026-11-03. Verdict: suitable for a draft integration PR; not ready for a release tag.

## Fixed ranges

The audited implementation is `bf7ad7e20`. The latest available release tag is `v0.58.0`
(commit `ada2d0606`). The tag-to-head comparison contains 282 changed paths. The branch comparison
against fork main `7ddef1a3a` contains 222 changed paths. The working tree was clean at audit start.

The release tag is not an ancestor of this branch. Their common ancestor is `26f9b8fd7`.
This branch still declares application version 0.57.0. The tag comparison therefore includes
changes absent from the older branch base as well as S1-local. It must not be treated as the
next release without integration with the current release line. This audit does not change the
version, merge histories, deploy services, or expand the private-planning support map.

Three read-only audit agents examined data preservation, CI/contracts, and platform evidence.
The primary agent checked their reported source locations and ran the focused checks below.

## Gate matrix

| Gate | Trigger and evidence | Verdict |
| --- | --- | --- |
| A. SQLite | Schema 49 to 50 is contiguous. The 41 named shipped migration functions and transitive helpers, inline registry bodies, and 42 recorded historical DDL entries are unchanged. Both creation paths use the same local DDL. Parity 4/4, local migration 53/53, historical database 91/91. | Pass after the test-fixture correction below. No production database was opened. |
| B. Profile and other persistent state | S1 keeps existing profile filenames, legacy paths, account/key formats, and composer storage. Copy opening adds documented retained files. Derived version-owner inventory is 69 to 70; widened owner/prefix inventory is 151 to 149, with 155 to 152 prefixes. Controls include injected workspace preferences and LockedKeychain-backed trusted host keys. | S1 preservation passes source review. Whole-release comparison stops on release-line drift described below. |
| C. Released Team API | No codec, adapter, capability or fixture changes under team-protocol. Frozen-query positive control finds the known historical change at `212eff2a8`. Both revisions retain v1-v9 fixture directories. RELEASING.md is unchanged. | Not triggered by a protocol change. No new wire meaning. |
| D. IPC | Endpoint list, main binding, strict preload and functional preview implementation include localPlanning. IPC coverage 14/14; strict planning preload decoding 4/4. Existing IPC coverage assertions are unchanged. | Pass for the audited branch. |
| E. Account Worker | Triggered by ci.yml. No D1 or Worker API change. Both CI and the manual script still apply D1 migrations before Worker deployment. | Pass for this diff; no deployment performed. |
| F. Updater | Tag comparison touches package.json version/development scripts. S1 does not change package.json, updater dependency, identity, signing, publication target, release workflow or artifact gates. | No new updater hazard found; old branch version still prevents a release verdict. |
| G. Reverse states and notes | Private entry has Stay/save/discard/destruction; projects have archive/restore; review changes retain history and open another generation; remote sessions have revoke/reconnect and mute/unmute. Release notes name platform and checked-copy limits. | Pass within the existing 88-case application evidence. |
| H. Signal | Read-only production health returned commit `0c7753fa622c38419939cd230657f40e5883d098`. That object is absent from this checkout, so the required source comparison cannot run. | Needs a human before release. No assertion that deployed Signal matches this source. |
| CI execution | Static selection includes new migration/main/preload tests, service groups, native behavior, and hosted unsupported/public-files. Full positive app proof requires a manual self-hosted label. The fork runner API currently returns an empty runner list. | Selection exists; execution and positive runner availability are unconfirmed. |
| Platform and ordinary functions | Main permits only the pinned Ubuntu 24.04/x64/kernel/Xvfb/binary configuration. Other metadata and I/O failures refuse entry; UI explains refusal. Final reports contain both negative metadata cases. | Private entry is closed outside that configuration. Ordinary macOS/Windows CUA and Remote Desktop start/stop/restart still need isolated execution evidence. |

## Historical fixture failure and correction

The full narrow `openbot-database.test.ts` run initially failed 58 of 91 cases. Those fixtures
created a latest database, then removed old migration markers to model a historical schema, but
retained schema 50's identity tables and singleton. Some retained marker 50 above their historical
ledger, and latest-version assertions still expected 49. This is not a valid released source schema.

The correction is confined to that test file. `openHistoricalFixture` removes only the new local
schema and marker before the fixture constructs its older shape. Newer-version, missing-version,
rollback and control readers keep their real database state. Expected latest markers now include 50.
Conversation, agent, foreign-key, rollback, retry, downgrade and integrity assertions are retained.
The resulting full file passes 91/91. Production migration bodies and bootstrap behavior are unchanged.

## Release stops and unconfirmed claims

1. Integrate with the current release line before a tag. The tag-only comparison removes
   `openbot:remote-frame:v1:` cache readers and sign-out/revoke cleanup, plus the
   `openbot.web.host-protocol:` cache. Shipping that comparison directly could retain names from a
   previous account after sign-out. These removals are absent from the branch delta against fork
   main. Preserve the later release work during integration rather than inventing an S1 migration.
2. Provide the dedicated positive application runner and observe CI results. The full positive
   workflow is manual; the fork has no registered runners at audit time. Hosted unsupported CI is
   configured but was not replayed on the supported local kernel as if it were an unsupported host.
3. Investigate the earlier native SIGILL/PiP, transient unavailable, Chromium resource refusal and
   MaxListeners observations before broad stability or platform claims. Later green runs do not
   establish their causes. OOM-invalidated runs remain invalid. See the evidence matrix.
4. Check ordinary native lifecycle behavior on isolated macOS/Windows environments before a broad
   release. No personal desktop was used to fill this gap. Do not expand private support from
   source inspection or a test environment flag.
5. Resolve the deployed Signal source identity before a release. The health check alone is not
   protocol/source compatibility evidence.
6. Runtime pins did not change in either audited range. The application-managed Bun pin is 1.4.4,
   which includes the published [Brotli fix](https://github.com/oven-sh/bun/security/advisories/GHSA-663w-cv8g-jj2p)
   and [QPACK fix](https://github.com/oven-sh/bun/security/advisories/GHSA-cf8x-9m69-3gg3).
   The unchanged developer/CI toolchain still pins Bun 1.4.2 and is in their affected ranges.
   Update and verify that toolchain as a separate security change before a release. OpenCode is
   pinned at 2.1.1; its public advisory list was checked, but embedded-runtime patch status and a
   complete supply-chain security assessment are unconfirmed. Pin scripts were inspected but not
   run: they download all target artifacts, and this audit does not move a pin.
7. Before/after UI screenshots are not supplied in the draft PR. Its before/after behavior and real
   keyboard/data evidence are stated. Capture review images on an isolated desktop before marking
   the PR ready. This is not a completed visual, responsive or WCAG audit.

## Changed-file accounting

All 282 paths in the fixed tag comparison are assigned below. Counts include removed and modified
paths. Assignment is hazard coverage, not a claim of replaying every file. Later release-line
changes are explicitly unconfirmed for a future release instead of being dismissed as S1 work.

| Path group | Count | Treatment |
| --- | ---: | --- |
| Documentation, privacy, plans and release metadata | 35 | Gate G and claim/evidence consistency; no runtime state migration. |
| CI workflows | 2 | Gates E/F plus selection and runner audit. |
| Root toolchain and renderer bundling | 2 | Gates B/F; preload bundling and development-only catalog optimization. |
| IPC contracts | 3 | Gate D; no frozen Team codec changed. |
| Interface catalogs | 56 | Gate G; labels, source errors and fallback, no state decoder. |
| Shared UI and visual story | 14 | Gates D/G and platform display; data comes through typed props. |
| Team client | 3 | Gates B/C; tag-only removal of profiling/host protocol retention, no S1 branch delta. |
| Evidence harness and development scripts | 42 | CI selection and report validation; tag-only profiling removals remain release-line drift. |
| SQLite, domain, filesystem and migration tests | 46 | Gates A/B; historical tests and frozen schema checks read rather than dismissed as test-only. |
| Main runtime, native ownership and adapters | 34 | Gates B/D/F and platform/native lifecycle audit. |
| IPC adapters, preload and boundary tests | 8 | Gate D and trust-boundary coverage. |
| Renderer state and platform adapters | 37 | Gate B derived persistence inventory and gate G reverse states; includes tag-only cache cleanup stop. |
| Total | 282 | No unassigned paths. |

## Focused verification

Checks ran one at a time with one test worker. Reports remain under
`.openbot-build/project-planning/readiness/` and are not committed.

| Command | Result |
| --- | --- |
| `bun run test:desktop -- src/backend/openbot-database-schema-parity.test.ts --maxWorkers=1` | 4/4 |
| `bun run test:desktop -- src/backend/local-planning-migration.test.ts --maxWorkers=1` | 53/53 |
| `bun run test:desktop -- src/backend/openbot-database.test.ts --maxWorkers=1` | RED 58 failed; GREEN 91/91 after fixture correction |
| `bun run test:desktop -- src/main/ipc-channel-coverage.test.ts --maxWorkers=1` | 14/14 |
| `bun run test:desktop -- src/preload/local-planning-decoding.test.ts --maxWorkers=1` | 4/4 |
| `biome check --write --max-diagnostics=none src/backend/openbot-database.test.ts` | Pass |

The earlier committed-source application proof remains 14 Electron + 23 UI + 38 files + 13 remote
observations at `e5f35128b`. This follow-up changes only test fixtures and documentation; it does not
promote those results into packaged-release, external-service, or cross-platform proof. The normal
commit hook selects the changed code checks. Broad local tests, builds, version bumps and production
changes remain outside this audit. `docs/RELEASING.md` owns any later release procedure.
