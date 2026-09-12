# Add and verify games after the system work

Owner decision: build the station system first, then add and test real games one
at a time. No venue game has been added or launched during this review. The
concept image is not a verified catalog. Steam was not detected by the development
agent self-check on this PC.

## Preparation

Use an authorized Windows test PC with Steam/account licensing and the actual
game installed. Complete the development-backend enrollment in operator-setup.md.
Start with one catalog entry. Confirm the precise executable path and actual game
process name through Task Manager or the game's installation; a launcher/login
process is not enough. Use approved artwork only.

Set `$agent` to the built or installed `GamingHouse.Agent.exe`. The following
paths and IDs are placeholders, not the venue's games:

```powershell
& $agent setup steam-scan --json
& $agent setup add-steam --id '<game-id>' --app-id '<confirmed-Steam-AppID>' --exe '<ActualGame.exe>' --category 'Action' --timeout 120 --config-dir '<station-config-directory>'
& $agent setup add-exe --id '<game-id>' --title '<Game title>' --category 'Sports' --path 'C:\Games\ExampleTitle\Game.exe' --exe 'Game.exe' --timeout 120 --config-dir '<station-config-directory>'
& $agent setup validate --json --config-dir '<station-config-directory>'
```

For a development-only user-writable installation, append `--dev` explicitly.
Production catalog/configuration and launch targets must satisfy their ACL checks.
Never put a shell command in the game ID or use a script/shortcut as an executable.
Structured `--arg` is repeatable; do not concatenate arguments through a shell.

## Per-game acceptance record

Record PC label, Windows edition/build/scaling, agent version, game ID, launcher
type/AppID, installation and process paths, profile version, timeout and result.

1. Without cashier authorization, Play is unavailable and native IPC is denied.
2. Authorize the station using the development cashier. Press Play once. Verify
   the game opens in the logged-in standard player's session, never Session 0.
3. Verify a pending session and immediate launch request; a platform window alone
   must not confirm game-running. Exercise signed-out Steam and slow updates.
4. Test success, wrong executable profile, launch failure, slow start and timeout.
   An unverifiable process must report staff review, not invented success.
5. With backend delays 0, 5, 10, 20 and 30 seconds, record actual running evidence
   and paid start. Repeat with a different backend hourly rate; no desktop rebuild.
6. Close/change games after Active. Session identity, paid start and Station Time
   must persist. Repeat a click and restart the UI; no second session or reset.
7. Temporarily disconnect networking. No new offline launch is allowed. Verify
   durable events, reconnection and bounded authorization. Check UI/service restart
   and machine restart separately; unverified boot gaps must require reconciliation.
8. Cashier stop freezes the backend bill once. On a separately authorized machine
   with the approved restriction profile enabled, verify Windows access is actually
   restricted and a later customer cannot access a leftover game before first Play.
   If that fails, keep enforcement failed and do not roll out the profile.
9. Redeliver a command and an older-session command. Neither may produce duplicate
   effects or stop the next customer. Test the staff reconnect/recovery procedure.
10. Confirm saves/account data are preserved deliberately, not erased by cleanup.

Only after that game's record passes should the next title be added. Then pilot
two PCs before any 12-station rollout. Signed delivery, real partner staging/API
agreement and the partner's single correct charge/receipt remain separate gates.

The earlier `--native-test` file is a Phase 3 standalone harness and is not current
acceptance evidence: the system now requires backend authorization. Use the above
authorized path for real games and `npm run test:system` for synthetic lifecycle
coverage. Synthetic observations never prove Steam, anti-cheat or Windows locking.
