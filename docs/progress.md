# Progress record

Read this first when continuing. Update it at the end of every phase with actual
verification, not intentions.

| Phase | Status |
| --- | --- |
| 1 — Foundation and connection contract | Complete on our side; partner review deferred by owner decision (2026-09-11) |
| 2 — Branded desktop interface | Complete with sample data (2026-09-11) |
| 3 — Real game launching on one PC | Built and proven with a stand-in program (2026-09-12). **No real game and no Steam title launched yet** — owner decision |
| 4 — Session lifecycle and simulated cashier | Built and verified against the development backend (2026-09-11) |
| 5 — Reliability, restrictions, packaging | Built; development package produced. **Windows restriction and installation unverified on venue hardware** |
| 6 — Partner's real system | Adapter implemented; deferred by owner. No partner endpoint, enrollment or receipt tested |
| 7 — Venue pilot and rollout | Not started; needs real games and authorized PCs |

Owner decisions: build our side only for now; UI is English only; placeholder
artwork until approved covers are supplied (all 2026-09-11). **Build the whole
system first; add and test real games one by one at the end** (2026-09-11). Gates
that need real games or venue hardware are marked unverified until then, with the
exact tests to run recorded in `docs/game-setup.md`.

## Staff admin panel (2026-09-12)

Requested by the owner: staff open a password-protected panel inside the app and
manage this PC's games; everything else stays out of reach.

**What changed**

| Deliverable | Location | Responsibility |
| --- | --- | --- |
| Staff password | `services/station-agent/Admin/AdminAuthority.cs`, `AdminCli.cs` | PBKDF2 hash only, rate-limited guesses with escalating lockout, in-memory unlock that expires after 15 minutes idle; `admin set-password` for install and reset |
| Catalog editing | `services/station-agent/Catalog/CatalogEditor.cs` | One path for the command line and the panel: validate on this PC, save only what passes, keep display order |
| Admin commands | `services/station-agent/Ipc/Protocol.cs`, `AgentService.cs` | Unlock/lock, list, Steam scan, add, update, remove, reorder, rename category, change password — each requires a live unlock |
| Panel | `apps/desktop/src/components/AdminPanel.tsx`, `station/admin.ts` | Unlock screen, game list with reorder/hide/edit/remove, add from Steam or a picked `.exe`, category editing, password change |
| Sample panel | `apps/desktop/src/dev/sample-admin.ts` | Shares the sample library, so demos behave like the real thing (password `padel-house`) |
| Order in the catalog | `sort_order` on each entry | Staff order is what players see |

**Deliberate limits:** the panel cannot change prices, grace time, sessions or
restrictions, cannot run a command or script, cannot pass launch arguments, and
cannot approve a game in a folder customers can modify. A leaked staff password
can only disturb the game list.

**Verified on this PC (2026-09-12):** `npm run verify` — 75 Node tests, 67 .NET
tests (14 new: hashing, lockout, idle expiry, password change, locked commands,
refusals, add/remove/hide/reorder/rename), both integration tests, and
`npm run test:desktop` 21/21 UI checks including "the panel opens only with the
staff password", "hiding a game removes it for players", and "staff can change
the order players see". Screenshot: `artifacts/ui/11-admin-panel.png`.

**Not verified:** the panel has never been used against real games or on a venue
PC, and no staff password has been set outside tests.

## Phases 3–5 — Launching, session lifecycle, reliability and packaging

Built in one stretch under the owner's sequencing decision. `docs/review-2026-09-11.md`
lists the gaps found and closed along the way; this is the phase record.

### 1. What changed and which responsibilities it implements

| Deliverable | Location | Responsibility |
| --- | --- | --- |
| Protected station catalog | `services/station-agent/Catalog/` | Admin-writable game list; every entry re-verified on this PC (path rules, canonical paths, `.exe` only, install-root containment, player-writable rejection) |
| Station setup tool | `services/station-agent/Setup/`, `docs/game-setup.md` | `steam-scan`, `add-steam`, `add-exe`, `validate`, `enable/disable/remove`; refuses unsafe or absent targets before saving |
| Steam reader | `services/station-agent/Steam/` | Reads Steam's own library files read-only: installed AppIDs, install folders, candidate executables, signed-in state |
| Launch and detection | `services/station-agent/Detection/`, `apps/desktop/electron/launch-spec.ts`, `native.ts` | Agent resolves a game ID to a validated plan; the desktop re-checks it and starts it in the player's Windows session (never a shell); the agent confirms the real process, tracks exits, and reports honest failures (`timeout`, `login_required`, `process_unreliable`, `start_failed`, `not_installed`) |
| Local IPC | `services/station-agent/Ipc/` | One client at a time over a named pipe with restricted ACLs, strict JSON, size limits, client checks, and a production relay |
| Session lifecycle | `services/station-agent/Session/` | Enrollment, DPAPI-protected credentials, HTTPS/loopback transport with schema validation, snapshot/lease handling, SQLite outbox with stable event IDs and terminal acknowledgements, cumulative observation segments, offline watchdog |
| Development backend | `apps/backend-simulator/` | Loopback SQLite server implementing the contract: policy snapshots per session, automatic paid start, cashier CLI (`npm run cashier`), fault injection. All billing arithmetic lives here, never in the station |
| Restriction and packaging | `services/station-agent/Session/WindowsRestriction.cs`, `ServiceHost.cs`, `scripts/package.mjs`, `packaging/Install.ps1`, `docs/operator-setup.md` | Windows Service hosting, a disabled-by-default WTS disconnect/verify profile, versioned development package, manifest, integrity dry run, rollback procedure |
| Native launch test | `tests/native-launch.integration.mjs`, `apps/desktop/electron/native-test.ts` | Drives backend → enrolled agent → catalog → cashier authorization → Electron launcher → detection → exit, using the stand-in program |

### 2. What was verified and in which environment

Development PC, Windows 11 Pro build 26200, Node 24.14.1, Electron 44.3.0,
.NET 10. Full re-run on 2026-09-12:

| Check | Result |
| --- | --- |
| `npm run verify` → contract lint, `node --test`, typecheck/build, agent build, self-check, .NET tests, system and native tests | All pass: 75 Node tests, 53 .NET tests, agent builds with 0 warnings |
| `npm run test:system` → real HTTP + agent lifecycle with synthetic observations | Passes (~16 s): enrollment, authorization, active session, cashier stop, honest "restriction unconfigured" outcome |
| `npm run test:native` → real launch chain with the stand-in program | Passes (~22 s), 8/8 checks; `artifacts/native-test.json` records the detected PID and process start time |
| `npm run test:desktop` → Electron UI test | 18/18 checks |
| `tests/simulator.test.mjs` | 8 lifecycle scenarios: zero delay, double-click anchoring, policy snapshots, game switching, stale evidence, duplicate observations, pending expiry, state reload |

What the native test proves on this PC: an authorized Play produces a real
Windows process in the player's session, confirmed by image path and session ID;
closing it reports a game exit; a game that never appears times out; a crash at
start is `start_failed`; a game whose files vanished is refused; Play is denied
before cashier authorization; malformed pipe messages are rejected.

**Not proven:** any real game, anything through Steam (Steam is not installed on
this PC), Windows restriction on a venue PC, installation on a venue PC, and the
partner's real backend. Synthetic observations are not evidence of native games.

### 3. What remains unverified or needs input

- **Real games**: the venue's titles, their install paths and true process names.
  Follow `docs/game-setup.md` one game at a time.
- **Windows restriction**: the WTS profile is off by default and has never been
  applied. It needs an authorized test PC, a staff-controlled reconnect
  credential, and checks for pre-Play access and leftover game windows.
- **Installation and update**: the package is a development build with no signing
  identity; `Install.ps1` has not been run on a venue PC.
- **Partner backend**: no endpoint, enrollment, policy change or receipt tested.
  The recovery policy the simulator chose (hold the station for staff after a
  missed authorization window) needs the partner's agreement.
- Venue Windows edition, player account policy, monitors, artwork and station
  pairing details remain open (`docs/inputs.md`).

### 4. How to run the current version

```powershell
cd 'C:\Users\rand\Desktop\padel house game app\gaming-house'
npm ci
npm run verify           # everything above
npm run simulator        # development backend (loopback only), separate terminal
npm run cashier -- status
npm run start:native     # desktop + development agent; catalog starts empty
npm run start:sample     # isolated UI demo; its controls cannot launch real games
```

`docs/operator-setup.md` has the enrollment and recovery steps; `docs/game-setup.md`
has the per-game procedure and the test checklist to use for each real game.

### 5. Next phase and its concrete starting task

**Add real games, one at a time (the owner's plan), on an authorized Windows PC
that has the game installed.** For the first title: run `setup steam-scan --json`
(or confirm the executable path for a non-Steam game), add one catalog entry,
run `setup validate --json`, then authorize a session and press Play while
watching the agent's launch result. Record each title's outcome in
`docs/game-setup.md`. Windows restriction testing follows on the same PC.

## Phase 2 — Branded desktop interface

### 1. What changed and which responsibilities it implements

| Deliverable | Location | Responsibility |
| --- | --- | --- |
| Renderer boundary | `packages/contracts/src/index.ts` | `StationClient`/`StationState`: the UI sends only a game ID and receives display-safe state. Replaced the unused Phase 1 `SessionProvider`/`PlayerState` placeholders |
| Player UI | `apps/desktop/src/App.tsx`, `components/` | Sidebar (logo, Library, Favorites, Recently played, categories, session card, Request help), header (search, station ID + connection), featured game, cover grid, filters, status bar |
| State screens | `components/` | Waiting, authorized, launching overlay, grace, active, launch-failed banner, disconnected/unstable banner, ended + locking/locked/lock-failed screen |
| Session display rules | `station/display.ts` | Station Time (local) vs Billable Time (backend) kept separate; grace countdown from the backend deadline; stale and frozen states; Play eligibility. No pricing, no delay, no wall-clock trust |
| Library logic | `station/library.ts`, `station/preferences.ts` | Search by title, category or initials; categories; favorites and recently played stored per station, tolerant of bad or missing storage |
| Formatting | `station/format.ts` | Durations and Asia/Baghdad clock times |
| Placeholder artwork | `components/Artwork.tsx` | Visibly labeled placeholders; approved local art drops in by asset ID (see `assets/README.md`) |
| Development sample | `apps/desktop/src/dev/` | 12 illustrative games, fake station + backend, dev control panel. Separate lazy chunk reachable only via `station/connect.ts` |
| Electron shell | `apps/desktop/electron/` | `host:info` validated IPC (Phase 2, no native launch), maximized window, offscreen UI test mode |
| Tests | `tests/*.test.ts`, `tests/sample-station.test.mjs`, `tests/renderer-boundary.test.mjs`, `apps/desktop/electron/ui-test.ts` | Display rules, library, preferences, sample contract fidelity, authority guards, end-to-end UI states |

Design decisions:

- **Play button text is near-black on `#FF6A00`.** White on that orange measures
  about 2.9:1 contrast, which fails WCAG AA even for large text; dark text is
  about 7:1. The concept used white. The orange itself is unchanged.
- **Fonts are Windows system fonts:** Bahnschrift for display type and Segoe UI
  for text. The CSP blocks remote fonts, and this adds no dependency.
- **Logo file untouched.** CSS crops its black padding and blends the black into
  the sidebar.
- **Session card** shows Billable time as the main figure only once the backend
  confirms it, Station time below it, and a charge only when the backend sends one.
- **Idle cost:** timers run only while a session is pending/active and the window
  is visible (2 Hz, paused when hidden or behind a game). Cards are memoized.
  Spinners are the only continuous animation, and only during launches.
- Added `lucide-react` 1.45.0 (ISC) for icons; React 19 peer range confirmed.

### 2. What was verified and in which environment

Development PC, Windows 11 Pro build 26200 at 125% display scaling, Node 24.14.1,
Electron 44.3.0. Verified 2026-09-11.

| Check | Result |
| --- | --- |
| `npm run verify` → Redocly lint | Valid |
| `npm run verify` → `node --test` | 61/61 pass (29 Phase 1 contract + 32 new) |
| `npm run verify` → `tsc` (renderer, tests, Electron), Vite build, `dotnet build`, agent self-check | Pass; 0 .NET warnings |
| `npm run test:desktop` → Electron UI test, 18 checks | 18/18 pass; report `artifacts/ui-test.json` |
| Screenshots of every state | `artifacts/ui/01-waiting.png` … `10-1024x640.png`, reviewed by eye |

The UI test drives the real Electron renderer with the development sample:
sandbox/isolation, logo, simulated labeling, waiting lock-out, search (title and
initials), `/` and Escape, favorites persisting across a reload, categories and
filters, authorization, launch overlay, grace countdown, active billing, game
switch and close keeping the session, disconnection, launch failure, Request help
not stopping time, a backend-sent charge shown verbatim, cashier end with frozen
totals and a verified lock, re-authorization, and layouts at 1920×1080, 1280×720
and 1024×640 without horizontal scrolling. It uses Electron offscreen rendering
because hidden windows returned stale frames.

**These results do not show** real game launching, process detection, backend
integration, billing or Windows restriction. The ended screen does not lock the
PC. Every sample screen says so.

### 3. What remains unverified or needs input

- Real catalog, launch profiles and approved artwork (Phase 3). Covers are placeholders.
- Keyboard use beyond the automated `/` and Escape checks and DOM tab order, and
  screen-reader behavior, have not been tested by hand.
- Idle CPU/GPU use is by design only; not yet measured on target hardware.
- The dev sample ships as a lazy chunk in the renderer bundle. Phase 5 packaging
  must drop it; `tests/renderer-boundary.test.mjs` keeps it isolated until then.
- Request help is UI + sample only. The contract has no help message yet; add one
  before Phase 4 or remove the button.
- Station label `PC-01` is sample data until enrollment/configuration (Phase 3/6).
- Venue monitor sizes and scaling remain unverified.
- Partner contract review remains deferred.

### 4. How to run the current version

```powershell
cd 'C:\Users\rand\Desktop\padel house game app\gaming-house'
npm ci
npm start              # opens the library with the sample station
npm run verify         # lint, 61 tests, builds, agent self-check
npm run test:desktop   # 18-check UI test + screenshots in artifacts/ui
```

In the app, click **SIMULATED** (bottom right) or press Ctrl+Shift+D for the
development controls: Authorize customer, then press Play on any game. End
session, connection, launch outcome, lock result and a fictional charge are there too.

### 5. Next phase and its concrete starting task

**Phase 3 — Real game launching on one PC.** Implement a native `StationClient`
behind the preload bridge: a protected local catalog (Steam AppID or approved
executable path, arguments, process profile) that the Electron main process
validates, launches in the logged-in player session, and watches for the
configured game process. Needs as input: one Steam game and one standalone
executable game installed on this PC, with their install paths.

## Phase 1 — Independent foundation and connection contract

### 1. What changed and which responsibilities it implements

| Deliverable | Location | Responsibility |
| --- | --- | --- |
| Separate project structure | `gaming-house/` | Isolated from Padel House; parent images and partner code untouched |
| Project instructions | `AGENTS.md` | Phase discipline, financial-authority and security boundaries |
| Architecture | `docs/architecture.md` | Component ownership, stack decisions, security baseline, planned SQLite |
| Session rules | `docs/session-rules.md` | Lifecycle dimensions, grace rule, time semantics, offline, enforcement |
| API contract (proposal) | `scripts/build-contract.mjs` → `contracts/openapi.json` | OpenAPI 3.1, 12 station-scoped operations, no cashier or price authority |
| Typed interfaces | `packages/contracts/src/` | Generated schema types, `StationApi`, catalog/session/launcher boundaries |
| Agent boundaries | `services/station-agent/Boundaries.cs` | Launch bridge, monitor, durable outbox, restriction interfaces (no implementation) |
| Fictional examples | `contracts/examples.mjs` → `contracts/examples.json` | All 11 required messages plus enrollment and event batch/ack |
| Partner handoff | `docs/partner-handoff.md` | Flask responsibilities, auth, idempotency, retries, ordering, commands |
| Acceptance plan | `docs/contract-test-plan.md` | S01–S22 behavior tests assigned to later phases |
| Outstanding inputs | `docs/inputs.md` | Hardware, games, assets, pairing, API, policy, signing |
| Desktop scaffold | `apps/desktop/` | Electron + React + TS, sandboxed, one validated read-only IPC call |
| Agent scaffold | `services/station-agent/` | .NET 10 console with honest `--self-check`; not a service yet |
| Simulator placeholder | `apps/backend-simulator/README.md` | Reserved for Phase 4; nothing runs |
| Dev configuration | `config/development.example.json` | Loopback URL, PC-01, 12 stations; no secret, rate or delay |
| Brand assets | `apps/desktop/public/brand/`, `assets/reference/` | Byte-identical copies of the supplied logo and concept |

### 2. What was verified and in which environment

Environment: development PC, Windows 11 Pro build 26200, Node 24.14.1,
npm 11.11.0, .NET SDK 10.0.101. Verified 2026-09-11.

| Check | Result |
| --- | --- |
| `npm run verify` → Redocly lint of `contracts/openapi.json` | Valid |
| `npm run verify` → `node --test` contract suite | 29/29 pass |
| `npm run verify` → `tsc` renderer, Electron and `tests/contract-types.ts` | Pass |
| `npm run verify` → Vite build and Electron compile | Pass |
| `npm run verify` → `dotnet build` agent | 0 warnings, 0 errors (warnings are errors) |
| `npm run verify` → agent `--self-check` | Reports service, monitoring, persistence and restriction all `false` |
| `npm run test:desktop` hidden Electron smoke test | `passed: true`; sandboxed, context-isolated, no renderer Node, logo loaded |
| Logo, concept and brief vs. originals (`cmp`) | Byte-identical |
| Search of desktop, Electron, agent and config code for rate/delay/price defaults | None found |

What the contract tests prove: examples conform to the schemas; device telemetry
rejects financial fields, shell input, and authoritative session transitions;
timestamps must be UTC `Z`; restrict commands need epoch fencing; generated JSON
and TypeScript match the source. They do **not** exercise lifecycle, billing,
persistence, launching or enforcement. Smoke evidence is written to
`artifacts/` (git-ignored, regenerate with `npm run test:desktop`).

### 3. What remains unverified or needs partner/hardware input

- **Phase 1 gate: partner agreement.** The contract exists as a proposal. It has
  not been sent to the partner and no agreement is claimed. Send
  `docs/partner-handoff.md`, `contracts/openapi.json` and `contracts/examples.json`
  for review; record the outcome here.
- All items in `docs/inputs.md`. None block Phase 2's sample-data UI.
- Nothing native is implemented or verified: no game launch, process detection,
  Windows Service, named-pipe IPC, SQLite, simulator or restriction.
- Optional contract gaps noted in review, worth closing before the partner starts:
  no example for the `Error` envelope, `CommandsResponse` (the actual wrapper that
  delivers a restrict command), `ConfigResponse`, renew/revoke, `CancelLaunchRequest`
  or `CommandResultResponse`. The enrollment example reuses the boot UUID as
  `installation_id`, which may confuse readers.
- The workspace is not under version control.

### 4. How to run the current version

```powershell
cd 'C:\Users\rand\Desktop\padel house game app\gaming-house'
npm ci
npm start          # (Phase 1) opened the foundation window
npm run verify     # contract lint, tests, builds, agent self-check
npm run test:desktop
```

No administrator rights, backend, enrollment or secret are required. The
foundation screen and its smoke test were replaced in Phase 2.

### 5. Next phase and its concrete starting task (completed in Phase 2)

**Phase 2 — Branded desktop interface.** Replace the foundation screen in
`apps/desktop/src/main.tsx` with the library layout from
`assets/reference/library-concept.png`: sidebar (logo, Library, Favorites,
Recently Played, categories, session status), header (search, connection
indicator, station ID), featured game, cover grid and session card. Feed it
through sample implementations of `CatalogProvider` and `SessionProvider` from
`packages/contracts/src/index.ts`, visibly labeled as simulated, with waiting,
authorized, launching, active, launch-failed, disconnected and restricted states.
Keep native launch behind `GameLauncher`; no backend fetches from the renderer.
