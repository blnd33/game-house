# Contract acceptance plan

Phase 1 executable tests validate JSON schema examples, rejection of device
financial inputs/commands, required identifiers, UTC shape, and generated-type
consistency. They **do not execute lifecycle, billing, persistence or enforcement**.

The following cases are required executable behavior tests as later components
arrive. Use an injected server clock in the simulator; reserve real timing tests
for native/staging integration. Do not wait minutes for unit tests.

| ID | Scenario | Required assertion | Phase |
| --- | --- | --- | --- |
| S01 | Unauthenticated, wrong station, revoked token | Deny access; no session, cross-station data or cashier powers | 4/6 |
| S02 | Missing/expired cashier authorization | Browsing allowed, launch denied | 4 |
| S03 | Duplicate and concurrent first Play, same/different keys | One session, one original timing anchor, stable response or defined conflict | 4 |
| S04 | Delays 0, 5, 10, 20, 30; fast/slow game | Unmodified desktop; backend starts at max(deadline, valid confirmation) only while running | 4/6 |
| S05 | Different rates, units, rounding, minimum; zero delay | Only backend computes amounts; zero is not a missing setting | 4/6 |
| S06 | Change policy after pending or active session | Existing snapshot unchanged; next authorized session uses new policy | 4/6 |
| S07 | Login dialog, missing process, failure, unreliable detection | No paid transition based on launcher alone; diagnostic shown | 3/4 |
| S08 | Exit before grace; stale running arrives after exit/cancel/expiry | No stale activation; preserve first timing anchor for valid retry | 4 |
| S09 | Repeat cancellations or switching during grace | No resetting grace/expiry; diagnostic; fresh staff authorization after pending expiry | 4 |
| S10 | Switch/close games after paid start, restart UI | Billing continues; same session; raw station time spans observed idle gaps | 4/5 |
| S11 | Repeat cumulative 10, 20, 20 seconds; reordered events | Reconcile maximum 20 for segment, not sum 50; no state rollback | 4/5 |
| S12 | Boot/segment change, clock forward/back, powered-off gap | Isolated monotonic segments; no automatic charge for unverified gaps | 5 |
| S13 | Crash before send, after send before ack, mixed/omitted ack | Outbox survives; stable IDs; no extra financial effects or lost unacked event | 4/5 |
| S14 | Connection loss pending/active; lease expires; fresh launch offline | No new offline permit; bounded access; honest disconnected/restriction state | 4/5 |
| S15 | Cashier end repeated/concurrent; game exits | One immutable end/charge, no player stop path | 4/6 |
| S16 | Duplicate/expired/stale session or earlier epoch command | No duplicate unsafe effects and no impact on a later customer | 4/5 |
| S17 | Restriction fails, offline, verification missing, crash mid-action | Never acknowledge success prematurely; station unavailable until resolved | 4/5 |
| S18 | Malicious renderer, modified profile, untrusted path/args/pipe client | Reject arbitrary commands and invalid sender/permission scope | 3/5 |
| S19 | Real installed Steam game and approved executable | Correct player desktop, true process detection, handoff/timeout results | 3 |
| S20 | Target restriction profile with Steam and anti-cheat | Supported OS behavior, safe closure/release, operator recovery proven | 5 |
| S21 | Staging setting change and cashier receipt | Same desktop reflects new policy for new session, partner confirms single charge | 6 |
| S22 | Idle update interruption/rollback, cloned device identities | Recovery works; unique enrollment on every PC | 5/7 |

Phase 4 must exercise automatic transition with the simulated cashier page closed.
An active session is never ended by the simulator merely because a game exits or a
UI crashes. Any backend gap reconciliation rule must be agreed with the partner.
