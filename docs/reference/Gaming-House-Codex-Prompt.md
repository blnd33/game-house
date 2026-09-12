# Gaming House — Codex Development Prompt

You are my engineering partner building **Gaming House**, a Windows game station application for a gaming lounge attached to Padel House in Duhok, Iraq. Work in clear phases and produce maintainable, verifiable software.

## 1. Project ownership and boundaries

We are responsible for the **Windows application installed on 12 gaming PCs**. My partner is responsible for the existing Padel House website, cashier, backend, central database, pricing, receipts, and staff dashboard. My partner also handles manual timers for **2 PS5 stations**.

Build Gaming House as a **separate project**. Do not modify, restructure, migrate, run, or deploy the existing Padel House application. If its source ZIP is available, treat it as read-only integration reference. Do not copy its credentials or bundled environments into this project.

The existing system uses Python/Flask, Jinja templates, Bootstrap, and SQLAlchemy. Its live database configuration still needs verification by my partner. Our desktop application will communicate with its future Gaming APIs. We do not need to replace its backend or implement a second cashier.

Agree on a proposed API contract at the beginning. Develop against a local simulated backend, then connect to my partner’s real APIs in the integration phase. Do not pretend that proposed endpoints already exist.

## 2. Product goal

When a customer uses a PC, they see a branded Gaming House application containing the games installed on that machine. They browse game covers, search, filter, and press Play to open a game locally. The experience is inspired by a Steam library, using our own identity.

The application reports game/session events and observed station-use duration to the backend immediately and periodically. **Padel House owns the configurable billing start delay and all price calculation.** Its staff settings may specify 5, 10, 20, 30, or another allowed number of seconds, along with the hourly rate and rounding rules. After applying that policy and confirming successful game launch, the backend starts the official paid session. The cashier sees that session in Padel House and is the only person who can end its billing.

Do not hardcode a 30-second billing delay or hourly rate in Gaming House. Changing the Padel House settings must not require rebuilding or reinstalling our application. The desktop reports observations and displays backend-provided session state; it does not decide when charging starts or calculate a customer bill.

Changing or closing games does not end the paid session. When the cashier ends it, the backend freezes the bill and sends a command to the PC. Our application applies the configured station restriction and reports whether it succeeded.

The application is an installed Windows program. A browser-only preview does not demonstrate local game launching, durable monitoring, or PC restriction.

## 3. Confirmed requirements

- Support 12 independently registered Windows stations, labeled PC-01 through PC-12. Keep the station count configurable.
- Use the supplied Gaming House logo and approved concept image when available.
- Show only games installed and enabled on the current PC as playable.
- Support Steam-managed games and approved direct executable games. Add other platform launch profiles when they are part of the actual game list.
- Steam games remain installed through Steam and launch through their supported Steam launch mechanism. Steam continues to handle account access, licenses, updates, and related prompts.
- Provide one paid session per occupied station, with multiple game runs inside it.
- Report the first launch immediately so Padel House can apply its configured billing start delay once per session, subject to successful game detection. Do not wait for a locally hardcoded delay before notifying the backend.
- Only the cashier can stop billing. Do not add a player-facing End Session, Pause Billing, or timer-reset capability.
- Closing a game, changing a game, minimizing the launcher, or restarting its UI must not silently end or reset the paid session.
- Show the station identity, session state, elapsed time, and connection status. Clearly distinguish locally observed station-use time from backend-confirmed billable time. Display prices and estimated/final charges only when supplied by the backend.
- A Request Help action is optional and does not stop time.
- PS5 automation is outside this project. No Windows installation, game detection, or remote locking for PS5 is required.

## 4. Exact session behavior

Use cashier authorization as the initial access model: the backend authorizes a customer/ticket for a station before Play can start a session. Browsing may remain available while waiting. During independent development, simulate this authorization through a development-only control panel or CLI.

### Settings owned by Padel House

My partner implements a staff settings screen containing the billing start delay in seconds, PC hourly rate, optional separate PS5 rate, billing unit/rounding, and any minimum charge. Those are central business settings, not editable player-application settings. Zero delay may be supported as an explicit backend setting; do not treat zero as a missing value.

The backend snapshots its policy version, delay, and rate for a session so routine settings changes apply to new sessions. Changes to an existing session require an explicit staff action under the partner's rules. Gaming House only consumes the resulting state/timestamps and any display amounts.

The development-only backend simulator must expose equivalent configurable settings for contract tests. This does not authorize building or changing the real Padel House settings screen.

### First game launch

1. The player presses Play for an approved game.
2. The application requests/obtains a valid pending-session authorization from the backend. Use an idempotency key so double clicks do not create additional sessions.
3. The backend records the accepted first Play time and derives the original grace deadline from its session policy's `billing_start_delay_seconds`. Our application may display a backend-supplied deadline, but must not independently create the financial deadline.
4. Launch the configured game in the logged-in Windows player session.
5. Observe the actual configured game process and send a game-running event. Opening Steam/Epic or a login window alone is not sufficient.
6. The backend automatically transitions the session to paid Active only when its configured grace deadline has passed and the game is confirmed running within a valid launch attempt. This must work without a delayed-start instruction from the player application and without requiring a cashier browser page to remain open.

Proposed backend policy, preserving the original first-Play timing anchor while making the delay configurable:

`billable_start_at = max(accepted_first_play_at + session_policy.billing_start_delay_seconds, confirmed_game_running_at)`

This rule is implemented once by the partner backend (and reproduced by the development simulator), not by desktop billing logic. The backend validates station evidence, authorization, and timing. The launch must still be authorized and valid, and the game must be running at transition. Reject stale events from cancelled or expired launch attempts. A process observation is not proof that an online match or loading screen has finished.

- Backend delay is 20 seconds and the game opens after 8 seconds: billing begins at second 20.
- Backend delay is 5 seconds and the game opens after 8 seconds: billing begins at second 8.
- Backend delay is 30 seconds and the game opens after 50 seconds: billing begins at second 50, if the launch attempt remains valid.
- Backend delay is zero: billing can begin once a valid successful launch is confirmed.
- Staff change the delay/rate: the backend applies the new policy to subsequent sessions without changing the installed Gaming House software.
- Game does not open: report failure; do not automatically start billing.
- Player clicks repeatedly or switches titles during grace: retain the original pending session and grace deadline.
- Repeated cancelled launches: record them and provide a staff-visible diagnostic signal; do not invent charges.
- A title with unreliable launch detection: return a clear status for staff review rather than claiming success.

Use configurable launch timeouts and a defined recovery path. Do not leave a pending launch granting unlimited untracked play if communication fails.

### Active session

The official session and bill belong to the backend. Our application displays its state, records game activity and observed station-use duration, and maintains a recoverable local event history. Send an immediate launch observation followed by periodic heartbeats/duration observations; do not wait until the customer finishes to upload all timing data. Game exits are telemetry, not a request to stop billing.

Observed station-use time continues across game switches and periods when the customer has closed a game, consistent with cashier-only session ending. It is not the sum of individual game-process runtimes. The backend uses validated timestamps/observations, its configured grace policy, rate snapshot, and rounding rules to calculate billable time and price. Gaming House must never subtract grace, apply hourly prices, round charges, or send a client-calculated amount as authoritative billing data. If cumulative duration is reported repeatedly, the backend must reconcile it by session/boot/sequence rather than add every report together.

Use UTC timestamps and display business time in Asia/Baghdad where a clock/date is shown. Derive the display from server state plus a monotonic local elapsed timer; do not trust changes to the Windows wall clock. Keep session IDs and boot IDs so a restart cannot mix unrelated elapsed-time measurements.

### Cashier stops the session

The partner backend records the end time once and freezes the charge. It sends an authenticated command tied to the station, session, command ID, and expiry.

Our agent validates the command, attempts graceful game closure as appropriate, and applies the supported station restriction. It acknowledges success only after verifying the restricted state. Repeated delivery must have no duplicate side effects. An old command must never stop a later customer’s session.

If enforcement fails or the station is offline, report pending/failed enforcement honestly. The backend should keep that station unavailable for reassignment until resolved. Only the cashier/backend authorizes the next session.

Keep session state, connection state, and restriction state separate. An offline station may still have an active session, and an ended session may still have an unpaid bill. Payment handling belongs to my partner.

## 5. Design direction

Create a polished, practical desktop library matching the supplied concept:

- Orange accents around `#FF6A00`, black background around `#080808`, charcoal panels around `#151515`, white primary text, and readable gray secondary text. These are proposed UI tokens inspired by the logo.
- Preserve the actual GH/controller logo and Gaming House wordmark; do not redesign them.
- Left sidebar: branding, Library, Favorites, Recently Played, categories, and session status.
- Main header: Game Library, search, connection indicator, and station ID.
- Featured game area with artwork, title, relevant metadata, and a clear Play button.
- Game cover grid with title, installed availability, favorite control, and launch action.
- Session card with elapsed time and status. Use a clear label such as Station Time for local observations and Billable Time for backend-confirmed billing duration; backend-supplied cost may be added when available. A grace countdown, if shown, reflects the backend-provided deadline. No billing-delay or price controls appear in the player UI.
- Clear waiting, launching, launch-failed, active, disconnected, and restricted screens/states.
- Start with a 1920×1080 desktop layout and adapt cleanly to the target monitor resolutions and Windows display scaling.
- Keep animation brief, accessibility contrast adequate, keyboard navigation usable, and idle CPU/GPU usage low. Reduce rendering when the game is in the foreground.

Do not introduce a store, social network, purchase flow, generic analytics dashboard, or extra branding. Game cards are launch entries. Use supplied or appropriately sourced artwork; sample games must not be presented as the club’s verified installed catalog.

If reference assets are missing, record them as needed inputs and use a clearly temporary placeholder while completing independent foundation work. Do not silently replace the approved identity.

## 6. Proposed technical architecture

Use this starting architecture unless inspection reveals a concrete reason to adjust it. Explain material changes before implementing them.

| Component | Technology / responsibility |
|---|---|
| Desktop interface | Electron + React + TypeScript |
| UI styling | A small shared token system with Tailwind CSS or ordinary CSS; select one consistent approach |
| Native background agent | C#/.NET Windows Service for durable monitoring, event storage, and recovery |
| Interactive launch component | Electron main process or a narrowly scoped helper in the logged-in player session |
| Local persistence | SQLite for configuration/catalog cache, session recovery, and queued events |
| Agent/UI communication | Authenticated local IPC with restrictive permissions, such as appropriately secured named pipes |
| Partner connection | Versioned HTTPS JSON API; outbound polling initially, behind a transport interface |
| Simulated backend | A small development-only server implementing the agreed contract and fault scenarios |
| Distribution | Windows installer, versioned configuration, and a documented update/rollback process |

Choose supported dependency versions during implementation. Do not pin versions from memory without checking their compatibility. Keep dependencies proportionate to a 12-PC installation.

Keep the UI, game launch adapters, device communication, and session logic separable. The simulated backend and real backend must implement the same contract. Put environment-specific endpoints in configuration rather than throughout the code.

Do not launch interactive games as a Windows Service in its isolated service desktop. Games run as the logged-in standard player; the service coordinates monitoring and permitted operations.

## 7. Game catalog and launch profiles

Each entry should support:

- Stable game ID, title, artwork, category, and optional controller/multiplayer metadata.
- Launch type, such as Steam or approved executable.
- Steam AppID or a validated local installation path.
- Structured launch arguments and working directory where needed.
- Per-game process detection profile and timeout.
- Installed/enabled status for this specific station.

Start with a curated catalog. Provide a protected local setup/configuration workflow for mapping installations; a future central catalog provider can use the same interface. Do not require a full remote game-management website to complete the initial desktop app.

The player sends a game ID, not a shell command. Resolve it to a trusted profile. Validate executable paths, Steam identifiers, arguments, and any imported shortcuts. Never execute arbitrary commands or URLs received from a website/API.

Do not bypass Steam authentication, game DRM, platform requirements, or anti-cheat software. Do not assume one game purchase authorizes all 12 stations. Licensing and game account setup are venue responsibilities that the launcher must respect.

## 8. API contract and partner handoff

Write an OpenAPI/JSON schema specification and typed client interfaces. The paths below are proposals to coordinate with my partner, not existing routes:

- One-time device enrollment and credential renewal/revocation.
- Station configuration and optional catalog retrieval.
- Heartbeat and current authorized-session snapshot.
- Pending session/launch request with an idempotency key.
- Durable game/session event submission and acknowledgement.
- Pending station commands and command-result acknowledgement.
- Read-only session state, server time, observed-use/billable timestamps, backend-provided grace deadline, policy version, and backend-calculated display amounts. Raw observation messages may include duration in seconds, boot ID, and sequence; they do not submit final charges or authoritative billable durations.

Every relevant message must include API version, station ID, session ID when assigned, request/event/command ID, and appropriate timing/version metadata. Define error codes, retry rules, out-of-order handling, expiry, and cancellation behavior. Credentials must be per station, revocable, and incapable of exercising cashier-wide powers.

The device must not receive database credentials, a staff account cookie, or authority to end billing or change prices. The partner backend must authenticate station scope, enforce one pending/active session per station atomically, and apply events and financial effects at most once.

Define these messages particularly clearly: authorization granted, launch requested, game running, launch failed, game exited, observed station-use duration, session active, cashier session ended, restrict command, restriction acknowledged, and heartbeat. Keep observed game events separate from authoritative session transitions. A telemetry event must not give the PC authority to select a rate, grace delay, or paid start time.

Produce a partner handoff document with request/response examples, configurable billing settings, state transition rules, timestamp semantics, and contract tests. Explicitly assign the settings UI, policy snapshots, automatic paid-start transition, hourly rate calculation, and cashier-only stop authority to the partner backend. My partner should be able to implement the Flask side without guessing how our client behaves.

The development simulator may include a tiny control page/CLI for authorization, cashier stop, and fault injection. Label it as a development tool and keep it out of the production player interface and installer.

## 9. Reliability and security requirements

- Preserve the current session identity and pending events across UI restarts.
- Persist significant events before treating them as durable. Retry with backoff and stable event IDs.
- Continue previously authorized active sessions during temporary network loss only within an explicitly configured authorization window. Do not authorize new offline sessions in the initial release.
- Reconcile uncertain launch/stop/restart periods with the backend. Do not automatically bill powered-off or unverified gaps.
- Keep the UI honest about disconnected/stale state and pending commands.
- Restart/recover the visible launcher when appropriate without creating a fresh customer session.
- Use restricted standard Windows player accounts and supported Windows controls. A full-screen Electron window alone is not a security boundary.
- Verify the exact restriction method against the target Windows edition, game launchers, and anti-cheat systems. Document any required machine setup.
- Enable Electron renderer sandboxing and context isolation, disable renderer Node integration, validate IPC senders/inputs, and expose only narrow native operations.
- Protect device credentials using OS-supported secret storage. Do not log tokens or customer credentials.
- Allow only explicitly supported device commands; do not create a remote shell.
- Do not inject an in-game overlay or modify anti-cheat behavior.
- Keep game/account cleanup deliberate. Do not erase customer saves or account data with an untested blanket cleanup routine.
- Prepare signed release/update support, validate update integrity, update idle stations, and retain a recovery path. If signing credentials are not supplied, clearly identify development builds as unsigned.

Full offline cashier operation, new offline customer sessions, customer wallets, memberships, public reservations, tournaments, and console automation are future scope unless I explicitly add them.

## 10. Development phases

Work sequentially. Keep `docs/progress.md` updated with completed work, verification evidence, remaining inputs, and the next phase. When I say “continue,” resume from that record rather than restarting or rebuilding completed work.

### Phase 1 — Independent foundation and connection contract

Inspect the current workspace and applicable project instructions. Establish the separate Gaming House project structure. Write the architecture, session rules, proposed API contract, typed interface definitions, and partner handoff outline. Scaffold the minimum application structure needed for subsequent phases.

Record outstanding inputs: Windows edition, actual games and installation paths, approved assets, station pairing details, API URL/auth method, and the backend's configurable delay/rate/rounding policy. Use replaceable development configuration for missing integration inputs; do not ask for live secrets in chat. Do not supply a silent 30-second or price fallback in the production desktop app.

**Gate:** The two teams have an explicit contract, the project is separate from Padel House, and the foundation can be checked without production access.

### Phase 2 — Branded desktop interface

Implement the Gaming House player UI with sample catalog/session providers. Include waiting/authorized/launching/active/error/disconnected states. Keep native launch and API access behind defined interfaces.

**Gate:** The application renders and its navigation, search, favorites, and state views work. Clearly distinguish simulated behavior from native functionality.

### Phase 3 — Real game launching on one PC

Implement the native agent/helper boundary, protected station setup, installation validation, and launch profiles. Test actual installed Steam and executable games on a Windows PC. Detect relevant processes and handle launcher handoffs, login prompts, failures, and slow starts.

**Gate:** Real games open in the correct desktop session and generate accurate launch results. If Windows hardware is unavailable, mark this gate unverified and provide exact tests to run; do not claim native success from a browser or Linux test.

### Phase 4 — Session lifecycle and simulated cashier connection

Implement the contract-compatible simulator with backend-owned configurable grace/rates, authorization flow, immediate launch events, periodic observed-duration reports, durable events, backend-derived session display, and cashier-only stop commands. Verify restriction acknowledgements. Switching or closing games must preserve the paid session. Keep billing calculation inside the simulator, not inside the production station application.

**Gate:** The same unmodified desktop application works with backend delays of 0, 5, 10, 20, and 30 seconds and different hourly rates. The simulated backend session survives game changes, starts according to its policy, and ends only from the simulated cashier action. Failed launches and repeated requests do not create extra sessions. A settings change does not retroactively alter an existing session's policy unless explicitly requested through an authorized staff action.

### Phase 5 — Reliability, restrictions, and packaging

Handle disconnects, restarts, clock changes, duplicate/stale events and commands, protected configuration, and installer/update recovery. Produce a development installer and an operator setup guide.

**Gate:** Meaningful recovery tests pass, Windows restriction behavior is verified on target equipment, and remaining environment-dependent limitations are documented.

### Phase 6 — Connect to my partner’s real system

Implement/configure the real API adapter against the agreed contract. Run end-to-end checks with the partner's staging backend: authorization, actual game launch, configurable automatic paid start, raw duration reporting, live session display, cashier end, PC restriction, and the partner's resulting bill. Change delay and hourly rate in the partner's settings, start a new session, and verify the new behavior without rebuilding the desktop application.

Do not modify the partner’s application. Report backend contract discrepancies with reproducible request/response examples for my partner to fix. Do not compensate for a backend issue by granting the PC financial authority.

**Gate:** Real PC events and cashier actions stay synchronized, and the partner confirms the correct single charge/receipt. If the backend is not ready, deliver the working simulator, adapter, and handoff without claiming real integration is complete.

### Phase 7 — Venue pilot and rollout

Prepare deployment and verification for two PCs first. Check real game behavior, timing, restrictions, and daily operation. After the pilot is accepted, install/enroll all 12 PCs using authorized venue access. Keep each device identity unique when cloning machines.

The partner separately validates the two manually timed PS5 stations.

**Gate:** All PCs have verified catalog mappings, unique credentials, working session controls, and a documented staff recovery procedure.

## 11. Engineering and verification rules

Before changing code, inspect what already exists, understand dependencies and related files, and preserve working behavior. Use focused changes with clear responsibilities. Do not rewrite unrelated modules, add unnecessary frameworks, or create production infrastructure outside this project’s scope.

Write meaningful tests for session transitions, configurable backend-owned grace/rates, one-time grace per session, policy snapshots, raw versus billable durations, duplicate/concurrent requests, event ordering, command/session matching, recovery, and permissions. Verify launch profiles and restriction behavior on actual Windows equipment. Test customer-visible UI behavior without creating tests that merely copy implementation details.

Never claim that a mock request, generated screenshot, type check, or successful build proves real game launch, cashier integration, or PC locking. Report each form of verification accurately. Investigate and disclose errors; do not silently hide failures or hardcode successful responses.

At the end of a phase, report:

1. What changed and which responsibilities it implements.
2. What was verified and in which environment.
3. What remains unverified or needs partner/hardware input.
4. How to run the current version.
5. The next phase and its concrete starting task.

Make routine implementation choices independently. Ask only when a missing product decision materially blocks correct work. Do not publish, alter the live Padel House system, or install on venue machines without the corresponding authorization and access.

## 12. Your first task

**Start with Phase 1 only.** Inspect the workspace, establish the separate Gaming House foundation, and write the actual contract and handoff files. Do not stop at a verbal plan. Verify the artifacts you create and report the results using the format above. Leave a clear progress record so we can continue phase by phase.
