# Operator setup and recovery

Development release 0.4.0. Real game and venue Windows restriction tests remain
pending. Do not treat synthetic observations as verified native games.

## Local development

1. Run `npm ci`, then `npm run verify`.
2. Run `npm run simulator` in a separate terminal. It binds only loopback. Data is
   under `artifacts/simulator` and survives restarts. No production system is used.
3. Set an explicit fictional policy: `npm run cashier -- policy apps/backend-simulator/policy.example.json`.
4. Issue a development pairing code: `npm run cashier -- pair PC-01`.
5. Enroll the development agent:

```powershell
dotnet run --project services/station-agent -- enroll --dev --api-url http://127.0.0.1:4317/gaming/v1 --station-label PC-01 --config-dir config/dev-station
```

Paste the one-time **development** code at its prompt. Retries use an encrypted
record. Do not post live secrets in chat. Run `npm run start:native` to launch the
desktop and its development agent. The catalog starts empty. `npm run start:sample`
is an isolated UI demonstration; its controls cannot launch native games.

`npm run cashier -- status` shows IDs and state. Authorize using
`npm run cashier -- authorize <station-id>`, stop using `npm run cashier -- stop
<station-id>`. `fault 10` temporarily makes device APIs unavailable. All cashier
commands are development-only and need a local admin token file; browser origins
are refused. The production player bundle excludes the development sample.

In development, restriction always reports unconfigured/failed. After checking a
test has ended, `resolve-enforcement <station-id>` is an explicit simulated
operator override so the next test can run; it is not device verification or a
production unlock. Changing a policy file has no effect until `cashier policy`
loads it, and only new sessions receive it.

## Development package and venue preparation

`npm run package` produces a self-contained Windows agent plus Electron desktop,
an installer script, and a SHA-256 manifest under `release/`. It does not install
or change this PC. Validate a package without changes:

```powershell
& '<package-folder>\Install.ps1' -DryRun -AllowUnsignedDevelopment
```

For an authorized test machine, create a dedicated standard player account and
record its SID. Run the installer elevated with `-PlayerSid '<SID>'
-AllowUnsignedDevelopment`. It creates a versioned Program Files installation,
service with recovery, restricted ProgramData storage, and a player-logon task.
It preserves previous versions and refuses updates while a session is pending,
active, or enforcement unresolved. No games or catalogs are bundled.

Enroll the installed agent from an elevated terminal using the partner's agreed
HTTPS endpoint, `--station-label PC-01`, and `--player-sid '<same SID>'`. Omit
`--dev`. Restart the service afterward. Repeat with unique identities for every
station; never clone `station.json`, credentials, SQLite, or enrollment retries.
The renderer never receives station credentials. Credentials are protected with
DPAPI; ProgramData must remain readable only by SYSTEM and administrators.

Production IPC uses a relay that checks the server PID against the Windows Service
Control Manager. The service checks the relay executable and player session and
restricts pipe access to SYSTEM and the configured player SID. Do not grant
players write access to installed binaries, station configuration or game profiles.

## Restriction profile — target validation required

`disconnect-session-v1` uses Windows WTS session disconnection and verifies
`WTSDisconnected`. It does not force-kill games or erase saves. Reconnection must
require a staff-held Windows credential; customers must not know that credential.
This is a supported Windows session operation, but compatibility with the venue's
accounts, Steam/anti-cheat, consoles and monitor setup is **not yet tested**.
See [Microsoft WTS state documentation](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/ne-wtsapi32-wts_connectstate_class).

`enable_restriction` defaults to false in protected `station.json`. Only set it
true during an authorized target-machine test after confirming the account and
reconnect setup. Development mode cannot activate it. A disabled/failed restriction
is reported honestly and blocks reassignment. Never treat the Electron end screen
as a Windows lock. Service restarts/new monitoring epochs and expired offline leases
require reconciliation; the simulator holds uncertain sessions for staff.

## Recovery, updates and signing

- UI crash: reopen the launcher; session identity stays in the service/database.
- Agent/backend disconnected: inspect service status and network; do not delete
  the event queue, reset timing or create an offline authorization.
- Agent restart/power gap: the monitoring epoch changes; unverified time is not
  silently charged. Cashier resolves the session before another customer uses it.
- Restriction failure: keep the station unavailable, secure it using the tested
  staff procedure, then resolve from the backend. Payment is separate.
- Credentials revoked: staff revoke the old station family first, archive its
  protected data for diagnosis, and re-pair via protected setup. Do not reuse IDs
  on a second PC. Never delete an unresolved event history to hide a problem.
- Update only idle PCs. Retain `%ProgramFiles%\GamingHouse\previous.json` and the
  referenced version. For rollback, run that version's `Install.ps1` with
  `-ActivateExisting`, the same player SID and signing options. Schema version 1
  is shared by these development builds; future migrations need their own rollback plan.
- Packages are unsigned development artifacts. For release, sign application
  executables and `Install.ps1` first, regenerate file hashes, then Authenticode-sign
  `manifest.ps1` with the release certificate. Installer validation requires
  its expected publisher thumbprint unless explicit unsigned development mode is
  used. Certificate custody/distribution and a signed production update channel
  remain venue inputs. Never disable signature checks for unattended production updates.

No service installation, Windows disconnection, venue enrollment, or partner API
change has been performed by building this package.
