// Builds a copy-and-run folder for testing real games on another Windows PC.
// Development only: the app runs unpackaged so it talks to the agent directly
// (no Windows service, no installer, no administrator), the backend is the
// development simulator on loopback, and nothing is installed on that PC.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve('.');
const kit = join(root, 'release', 'GamingHouse-TestKit');
const run = (command, args) => new Promise((ok, fail) => {
  const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
  child.on('error', fail);
  child.on('exit', code => (code === 0 ? ok() : fail(new Error(`${command} exited ${code}`))));
});

await rm(kit, { recursive: true, force: true });
await mkdir(kit, { recursive: true });

// 1. The agent, self-contained: no .NET needed on the test PC.
await run('dotnet', ['publish', 'services/station-agent/GamingHouse.Agent.csproj', '-c', 'Release', '-r', 'win-x64',
  '--self-contained', 'true', '-p:RuntimeFrameworkVersion=10.0.12', '-o', join(kit, 'agent')]);

// 2. The app, unpackaged: electron.exe keeps its name so development flags stay
//    available and the desktop connects straight to the agent's pipe.
await cp(join(root, 'node_modules/electron/dist'), join(kit, 'app'), { recursive: true });
const app = join(kit, 'app', 'gaming-house');
await cp(join(root, 'apps/desktop/dist'), join(app, 'apps/desktop/dist'), { recursive: true });
await mkdir(join(app, 'apps/desktop/dist-electron'), { recursive: true });
for (const file of ['main.js', 'preload.cjs', 'native.js', 'agent-client.js', 'launch-spec.js']) {
  await cp(join(root, 'apps/desktop/dist-electron', file), join(app, 'apps/desktop/dist-electron', file));
}
await writeFile(join(app, 'package.json'), JSON.stringify({
  name: 'gaming-house', version: JSON.parse(await readFile('package.json', 'utf8')).version,
  type: 'module', main: 'apps/desktop/dist-electron/main.js',
}, null, 2));

// 3. The development backend. It keeps the project's folder layout, because the
//    server reads the contract relative to its own location.
await mkdir(join(kit, 'apps/backend-simulator'), { recursive: true });
for (const file of ['server.mjs', 'engine.mjs', 'cli.mjs', 'policy.example.json']) {
  await cp(join(root, 'apps/backend-simulator', file), join(kit, 'apps/backend-simulator', file));
}
await cp(join(root, 'contracts/openapi.json'), join(kit, 'contracts/openapi.json'));
for (const dependency of ['ajv', 'ajv-formats', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string']) {
  await cp(join(root, 'node_modules', dependency), join(kit, 'node_modules', dependency), { recursive: true });
}

for (const [name, text] of Object.entries(await scripts())) await writeFile(join(kit, name), text);
console.log(`Test kit ready: ${kit}`);

async function scripts() {
  return {
    'READ-ME-FIRST.txt': `GAMING HOUSE - TEST KIT (development only)

Use this on a Windows PC that has a real game installed, to check that the game
launches and is detected. Nothing is installed: no service, no installer, no
administrator. Delete this folder when you are finished.

WHAT YOU NEED
  - Windows 10 or 11, 64-bit.
  - For step 3 only: Node.js 24 or newer (https://nodejs.org). Steps 1 and 2 work without it.

STEP 1 - see which games this PC has (read-only)
  Right-click 1-Find-Games.ps1 > Run with PowerShell
  Note the AppID and the game's program file (for example RocketLeague.exe).
  For a game that is not on Steam, note the full path to its .exe instead.

STEP 2 - add one game
  Open PowerShell in this folder, then for a Steam game:
    .\\2-Add-Game.ps1 -Name "Rocket League" -AppId 252950 -Exe RocketLeague.exe -Category Sports
  or for any other game:
    .\\2-Add-Game.ps1 -Name "My Game" -Path "C:\\Games\\MyGame\\Game.exe" -Exe Game.exe
  It says "ready" when the game passed every check on this PC.

STEP 3 - run the real test
    .\\3-Run-Test.ps1
  This starts a test cashier on this PC only, connects this PC to it, opens the
  Gaming House app and starts a session. Press Play on your game and watch:
    - the game should open
    - the app should show "Now playing" and start Billable time
  Close the game; the session keeps running, which is correct.

STEP 4 - stop and clean up
    .\\4-Stop-Test.ps1
  Then delete this folder. To remove the test data only, delete the "station"
  and "backend-data" folders.

WHAT THIS IS NOT
  The cashier, the prices and the session here are a local test stand-in, not
  Padel House. No money is calculated, no receipt is produced, and this PC is
  never locked. Everything runs on this PC only (127.0.0.1) and nothing is sent
  anywhere.
`,

    '1-Find-Games.ps1': `# Lists Steam games installed on this PC. Read-only: nothing is changed.
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot\\agent\\GamingHouse.Agent.exe" setup steam-scan
Write-Host ""
Write-Host "For a game that is not on Steam, note the full path to its .exe instead." -ForegroundColor Yellow
`,

    '2-Add-Game.ps1': `# Adds one game to this PC's list and checks it.
#   Steam:  .\\2-Add-Game.ps1 -Name "Rocket League" -AppId 252950 -Exe RocketLeague.exe -Category Sports
#   Other:  .\\2-Add-Game.ps1 -Name "My Game" -Path "C:\\Games\\MyGame\\Game.exe" -Exe Game.exe
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$AppId,
  [string]$Path,
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Category = 'Action'
)
$ErrorActionPreference = 'Stop'
$agent = Join-Path $PSScriptRoot 'agent\\GamingHouse.Agent.exe'
$station = Join-Path $PSScriptRoot 'station'
$id = ($Name.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
if ($AppId) {
  & $agent setup add-steam --id $id --app-id $AppId --exe $Exe --title $Name --category $Category --multiplayer --config-dir $station --dev
} elseif ($Path) {
  & $agent setup add-exe --id $id --title $Name --category $Category --path $Path --exe $Exe --multiplayer --config-dir $station --dev
} else {
  Write-Error 'Give -AppId for a Steam game, or -Path for any other game.'
}
Write-Host ""
& $agent setup validate --config-dir $station --dev
`,

    '3-Run-Test.ps1': `# Starts the test cashier, connects this PC, and opens the app.
$ErrorActionPreference = 'Stop'
$kit = $PSScriptRoot
$agent = Join-Path $kit 'agent\\GamingHouse.Agent.exe'
$station = Join-Path $kit 'station'
$env:GH_SIM_DATA = Join-Path $kit 'backend-data'
if (-not (Test-Path (Join-Path $station 'catalog.json'))) { Write-Error 'Add a game first with 2-Add-Game.ps1.' }
try { node --version | Out-Null } catch { Write-Error 'Node.js 24+ is required for the test cashier. Install it from https://nodejs.org and run this again.' }

$cli = "$kit\\apps\\backend-simulator\\cli.mjs"
Write-Host 'Starting the test cashier (this PC only)...' -ForegroundColor Cyan
$backend = Start-Process node -ArgumentList "\`"$kit\\apps\\backend-simulator\\server.mjs\`"" -WorkingDirectory "$kit" -PassThru -WindowStyle Minimized
$ready = $false
$ErrorActionPreference = 'Continue'   # a starting server prints to stderr; that is not a failure
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  node $cli status *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
}
$ErrorActionPreference = 'Stop'
if (-not $ready) { Write-Error 'The test cashier did not start. Check that Node.js 24 or newer is installed.' }
node $cli policy "$kit\\apps\\backend-simulator\\policy.example.json" | Out-Null

if (-not (Test-Path (Join-Path $station 'station.json'))) {
  Write-Host 'Connecting this PC to the test cashier...' -ForegroundColor Cyan
  $pair = node $cli pair PC-01 | ConvertFrom-Json
  $sid = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
  $pair.pairing_code | & $agent enroll --dev --api-url 'http://127.0.0.1:4317/gaming/v1' --station-label PC-01 --config-dir $station --player-sid $sid
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $station 'station.json'))) { Write-Error 'Connecting this PC failed; nothing else was started.' }
}

Write-Host 'Starting the station agent...' -ForegroundColor Cyan
$agentProcess = Start-Process $agent -ArgumentList 'run', '--dev', '--config-dir', "\`"$station\`"" -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 2
$stationId = (node $cli status | ConvertFrom-Json)[0].station_id
node $cli authorize $stationId | Out-Null
Write-Host 'Session authorized for this PC.' -ForegroundColor Green

$appProcess = Start-Process "$kit\\app\\electron.exe" -ArgumentList "\`"$kit\\app\\gaming-house\`"" -PassThru
@{ backend = $backend.Id; agent = $agentProcess.Id; app = $appProcess.Id } | ConvertTo-Json | Set-Content (Join-Path $kit 'running.json')

Write-Host ''
Write-Host 'The app is open. Press Play on your game and watch:' -ForegroundColor Cyan
Write-Host '  - the game opens'
Write-Host '  - the app shows "Now playing" and Billable time starts'
Write-Host 'To end the session like a cashier would:' -ForegroundColor Cyan
Write-Host "  node \`"$cli\`" stop $stationId"
Write-Host 'When finished, run 4-Stop-Test.ps1' -ForegroundColor Yellow
`,

    '4-Stop-Test.ps1': `# Stops everything this kit started. Your PC is left as it was.
$ErrorActionPreference = 'SilentlyContinue'
$file = Join-Path $PSScriptRoot 'running.json'
if (Test-Path $file) {
  $ids = Get-Content $file | ConvertFrom-Json
  foreach ($id in @($ids.app, $ids.agent, $ids.backend)) { if ($id) { Stop-Process -Id $id -Force } }
  Remove-Item $file
}
Write-Host 'Stopped. Delete this folder to remove everything, or delete "station" and "backend-data" to clear the test data only.' -ForegroundColor Green
`,
  };
}
