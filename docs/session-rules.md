# Session and timing rules — proposed v1

## Separate dimensions

- Session: absent → pending → active → ended; pending may become cancelled on
  backend cancellation/expiry. Only the cashier ends an active paid session.
- Authorization: absent or a backend-issued authorization ID, station epoch and expiry.
- Connection: connecting, connected, disconnected, stale (local transport state).
- Restriction: unknown, unrestricted, pending, restricted, failed.
- Launch attempt: permitted, running, failed, cancelled, expired.

An ended session can remain restricted/unavailable and unpaid. Payment belongs to
the partner. Disconnection never means the session ended. A later station snapshot
may retain the ended session for enforcement and reconciliation.

## First Play and grace

Browsing does not require authorization. Play does. The first request includes
authorization ID, station epoch, known snapshot revision, game ID and a stable
idempotency UUID. Persist its body/key before send. On a lost response retry that
same logical request. Do not generate a fresh key for a double click.

The backend atomically creates or reuses one pending/active session for that
station. It anchors first Play at server acceptance, snapshots its policy, and
returns a pending session and an expiring game launch permit. A stale revision is
reconciled; never blindly authorize from stale client state. Same-key retry is
looked up before revision validation. Concurrent distinct requests still share
the one station session. A deliberate game switch may create a new attempt only
under that session. Accepted first-Play time and original grace do not move.

The interactive helper revalidates the current authorization/epoch/attempt before
launch. Launch a trusted profile in the player's Windows session. Observe the
configured game process; opening Steam, a login dialog or launcher is insufficient.
Persist and send `game_running` immediately, then heartbeats and raw use observations.

Backend-only proposed paid-start rule:

```text
billable_start_at = max(accepted_first_play_at + snapshotted_delay,
                       validated_confirmed_game_running_at)
```

The backend's independent scheduler evaluates this automatically. At transition,
the session must still be pending, authorization and attempt valid, and process
evidence current. No game-running event means no automatic billing. A reported
process is not proof of an online match or completed loading screen.

| Configured backend delay | Confirmed game running | Earliest paid start |
| --- | --- | --- |
| 20 seconds | second 8 | second 20, if still running |
| 5 seconds | second 8 | second 8 |
| 30 seconds | second 50 | second 50, if permit remains valid |
| 0 seconds | second 8 | second 8 |

Zero is a legitimate explicit backend setting. The desktop receives timestamps
and display values, with no production fallback delay or hourly rate. Missing
policy is a backend configuration failure, not permission to choose a default.

Launch failure/cancellation affects the attempt only. Pending session expiry is
backend-owned, fixed from first Play, and cannot be extended by repeated clicks.
A pending session that expires requires a fresh cashier authorization to try
again. A failed/replaced/expired attempt cannot activate billing later. If a game
exits before grace, require a currently valid running attempt before transition.
If launching is ambiguous, report `process_unreliable` for staff review.

## Active sessions and time

Changing/closing games, UI restarts and minimizing the app do not end or reset the
session. Locally observed Station Time continues across game switches and idle
gaps while use remains observed and authorized. It is not the sum of game runtimes.

The agent reports cumulative duration for one session/boot/segment. The backend
reconciles each segment's maximum validated cumulative value, never adds every
heartbeat or repeated cumulative report. Non-overlapping verified segments can
be combined; recovered/unverified gaps are held for reconciliation. Do not bill
power-off time automatically or trust client wall-clock jumps.

Use UTC `Z` timestamps on the wire; display dates in Asia/Baghdad. Use monotonic
elapsed time for local display after a server snapshot. Label local observation
as **Station Time**. **Billable Time** begins from the backend's confirmed duration
and may advance monotonically while its active snapshot and authorization lease
remain fresh. Mark stale estimates, freeze when ended, and show unknown when no
confirmed value exists. Never convert Station Time into a bill or subtract grace
in the station. Display amounts exactly as supplied by the backend.

## Offline/restart recovery

No new offline sessions or offline launch permits. Pending launches use the
earliest of their permit expiry, backend authorized-play deadline and configured
pending-launch offline timeout. On communication failure beyond this window,
request graceful game closure and apply the approved local restriction policy;
report outcome after reconnection. A launch must not permit unlimited untracked play.

Previously authorized active use may continue only to the backend's absolute
`authorized_play_until`. Convert server-relative remaining validity to a
conservative monotonic deadline (deduct request round-trip uncertainty). On loss
of trusted monotonic continuity/restart, reconcile before further launch/access;
do not extend validity from the local wall clock. If the lease expires offline,
enforce the local approved profile and queue telemetry. Billing remains backend-owned.

On reconnect, renew/revalidate credentials, retrieve snapshot/commands, reconcile
session/epoch, then drain eligible events. Reports from old sessions never change
the current occupant. Events can be retained for historical review without
retroactive financial effects. Preserve outbox and last session through UI restarts.

## Cashier end and enforcement

The backend records the end once, freezes the charge, revokes access, and enqueues
a `restrict_station` command atomically. End does not depend on PC acknowledgement.
Validate command origin via authenticated HTTPS, station ID, exact current/ended
session ID, station epoch, session revision, command ID, supported profile and
expiry. On uncertain identity or time, reconcile; never act on a guessed target.

Journal the command. Attempt graceful closure of only approved session game
processes, apply the supported restriction and verify its actual OS state. Only
then return `outcome: verified`, `restriction_state: restricted`, a verification
time and evidence. A dialog or attempted lock is not sufficient. Failure leaves
the station unavailable and raises an operator diagnostic.

Repeated commands reuse the journaled result; after interruption recheck state
without duplicating unsafe effects. An expired or earlier-epoch command is
rejected and cannot affect a later session. Pending/failed enforcement blocks
reassignment at the backend. Fresh authorization is only granted after enforcement
resolution and an explicit cashier action; the helper may then release the
approved local restriction under a fresh snapshot. The particular release/lock
mechanism awaits target Windows validation, not a remote arbitrary command.
