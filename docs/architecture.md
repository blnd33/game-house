# Architecture and responsibility boundaries

Status: Phase 2 — player UI on a development sample; native parts still
scaffolds. Proposed API v1, contract revision 0.1.0; partner review deferred.

## Components

| Component | Owns | Must not own |
| --- | --- | --- |
| React renderer | Library browsing, search, favorites, backend session display, honest connection state | Credentials, filesystem access, game commands, financial rules |
| Electron main / interactive helper | Trusted game-ID resolution and launch in the logged-in standard player's desktop | Arbitrary shell execution, billing start/end, service-desktop game launch |
| .NET Windows agent | Durable monitoring, SQLite outbox/recovery, backend transport, permit enforcement, restricted IPC, restriction verification | Cashier powers, rates, price calculation |
| Local SQLite | Protected catalog/config cache, session identity and snapshots, monotonic observation segments, queued events, command journal | Plaintext tokens or locally calculated bills |
| Development simulator | Same station API plus dev-only authorization, backend policy/timers, cashier actions and faults | Production installation or access to live Padel House |
| Partner Flask backend | Enrollment, staff authorization, atomic session ownership, settings/policy snapshots, automatic paid start, rates/rounding, cashier end, receipts, central data | Delegating financial authority to device observations |

React → narrow preload → Electron main ↔ secured named pipe ↔ .NET agent → HTTPS
station API → partner backend. Interactive processes are launched by the standard
user component; the service monitors/co-ordinates. An optional central catalog
remains metadata until approved and validated locally.

The initial transport will use outbound polling behind `StationApi`. The renderer
will receive a sanitized display model from the agent; no direct backend fetches.
Development HTTP is allowed only for explicitly selected loopback simulation.
Production configuration must require HTTPS, validate certificates, and fail closed
on absent enrollment/configuration. No fallback rate, delay, or silent offline authorization.

## Renderer boundary (Phase 2)

The player UI talks to one interface, `StationClient` in
`packages/contracts/src/index.ts`. It can ask for the catalog (display fields
only), subscribe to `StationState`, press Play with a game ID, and request help.
`StationState` carries the latest backend snapshot as received, local connection
and launch status, observed running games, and the local station-use reading.
Credentials, executable paths, arguments and pricing policy never reach it.

`station/display.ts` turns that state into what the player sees. It uses server
timestamps plus monotonic elapsed time since receipt (`performance.now`), never the
Windows clock. Billable Time is the backend's confirmed value, extrapolated only
while connected and within `authorized_play_until`; it is marked stale otherwise
and frozen once ended. Station Time is the separate local observation. Amounts
are shown exactly as supplied. Re-delivery of an unchanged snapshot does not
restart elapsed time.

Phase 2 implements `StationClient` with a development sample (`src/dev/`): a fake
station and backend with a dev control panel. It loads as a separate lazy chunk
through `station/connect.ts` only, guarded by `tests/renderer-boundary.test.mjs`.
Phase 3 adds the native implementation behind the preload bridge; Phase 5
packaging removes the sample. The sample's pending→active rule exists only to
exercise the UI; the real rule stays backend-owned.

## Stack decisions

Electron + React + TypeScript follows the brief. Ordinary CSS uses a small token
set (`#FF6A00`, `#080808`, `#151515`) without an extra styling framework. Type is
Windows' own Bahnschrift and Segoe UI, so no fonts are fetched. Icons come from
`lucide-react` (ISC). Pure logic is tested with Node's built-in runner running
TypeScript directly (type stripping), so no test framework was added. Vite only
bundles the renderer; this remains a native desktop project, not a hosted site.
.NET 10 targets Windows; the Phase 1 console scaffold intentionally does not
install or claim to be a service. Service hosting and native coordination begin
in Phase 3. SQLite wiring is deferred until durable state is implemented.

Versions were queried from the npm registry on 2026-09-11. Electron 44.3.0, React
19.3.0, Vite 8.3.0, and the exact development tools are locked in package-lock.json.
TypeScript 5.9.3 was selected after npm rejected 7.0.2 because openapi-typescript
7.13.0 declares a TypeScript 5 peer dependency. No forced peer resolution is used.
Installed Node 24.14.1 satisfies the selected Vite/Electron engine requirements.
The local .NET SDK is 10.0.101; upgrade to a current servicing SDK/runtime before
release. `global.json` allows newer .NET 10 feature SDKs.

References checked: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[Electron process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox/),
[Vite requirements](https://vite.dev/guide/), and
[.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy).

## Implemented security baseline

Electron enables sandboxing, context isolation, and web security with renderer
Node integration disabled. CSP permits bundled assets only and denies network
connections. Navigation, new windows, webviews, and permission requests are
blocked. A single read-only `host:info` IPC operation checks its sender, top frame,
exact loaded file URL, and absence of arguments. It exposes no generic IPC channel.

Later native operations need schema validation, permission checks and race-safe
permit checks on every invocation. The protected pipe must restrict ACLs to the
service SID and approved player SID, validate peer identity/session, reject remote
clients, and bind a short-lived authenticated IPC session. Do not assume a pipe
name or renderer origin is sufficient authentication. Resolve executable real
paths and reject player-writable targets, unapproved arguments and imported
shortcuts until reviewed. Use an explicit Steam AppID, never a remote URL.

Credentials will use Windows-supported protected secret storage with service-only
access. Store references in configuration; scrub secrets from errors and logs.
OS boot identity persists across agent/UI process restarts; a separate observation
segment starts whenever continuity cannot be proved. Session identity is never
inferred from a new UI instance.

## Planned SQLite ownership

Use service-owned files with restricted ACLs and transactional migrations. Planned
tables: station configuration/catalog cache; latest authoritative snapshot with
revision and received monotonic time; observation segments keyed by
session/boot/segment; outbox keyed by immutable event UUID plus unique boot/event
sequence; command journal keyed by command UUID with session/epoch and result;
launch journal keyed by attempt UUID with permit deadline and lifecycle.

Persist an event and update the segment high-water mark in one transaction before
network delivery. Mark accepted/duplicate acknowledgements durably before pruning.
Quarantine rejected observations for diagnosis. Interrupted restriction work is
reconciled with actual OS state before acknowledging. Never infer completion from
the existence of a journal row. SQLite is a plan in Phase 1, not implemented storage.

## Restriction and release boundary

The exact Windows restriction profile is unresolved. A fullscreen Electron UI is
not a security boundary. Phase 3/5 must test supported Windows controls, account
rights, launcher interactions and anti-cheat on venue equipment. Opening this
foundation performs no lock, logout, process termination or service installation.

Updates will require signed artifacts/integrity validation, idle-only installation,
rollback and operator recovery. No signing keys or release installer exist yet.
The simulator and its staff-like controls must be excluded from the station package.
