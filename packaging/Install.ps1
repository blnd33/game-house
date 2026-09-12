param(
    [string]$PlayerSid,
    [string]$ExpectedPublisherThumbprint,
    [switch]$AllowUnsignedDevelopment,
    [switch]$ActivateExisting,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$manifestPath = Join-Path $packageRoot 'manifest.ps1'
$signature = Get-AuthenticodeSignature -LiteralPath $manifestPath
if (-not $AllowUnsignedDevelopment) {
    if (-not $ExpectedPublisherThumbprint -or $signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $ExpectedPublisherThumbprint) {
        throw 'A valid signed manifest and the expected publisher thumbprint are required. Unsigned development packages require -AllowUnsignedDevelopment.'
    }
}
$manifestText = Get-Content -LiteralPath $manifestPath -Raw
$match = [regex]::Match($manifestText, "(?s)\A# Gaming House package manifest\r?\n@'\r?\n(.+?)\r?\n'@")
if (-not $match.Success) { throw 'Invalid package manifest.' }
$manifest = $match.Groups[1].Value | ConvertFrom-Json
if ($manifest.schema_version -ne 1 -or $manifest.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+-[a-zA-Z0-9-]+$') { throw 'Unsupported package version/schema.' }
foreach ($file in $manifest.files) {
    $path = [IO.Path]::GetFullPath((Join-Path $packageRoot $file.path))
    if (-not $path.StartsWith($packageRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path escapes its directory.' }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) { throw "Package integrity failed: $($file.path)" }
}
$installRoot = Join-Path $env:ProgramFiles 'GamingHouse'
$target = [IO.Path]::GetFullPath((Join-Path $installRoot "versions\$($manifest.version)"))
if (-not $target.StartsWith([IO.Path]::GetFullPath($installRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid install destination.' }
$dataRoot = Join-Path $env:ProgramData 'GamingHouse'
$currentPath = Join-Path $installRoot 'current.json'
if ($DryRun) {
    [pscustomobject]@{ Integrity='Verified'; Version=$manifest.version; Destination=$target; Data=$dataRoot; FileCount=$manifest.files.Count; Signed=($signature.Status -eq 'Valid'); SystemChanges='None' }
    return
}
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run the installer from an elevated PowerShell window.' }
if (-not $PlayerSid -or $PlayerSid -notmatch '^S-1-5-21-(\d+-){3}\d+$') { throw 'Provide the SID of the restricted Windows player account using -PlayerSid.' }
if (Test-Path -LiteralPath $currentPath) {
    $current = Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json
    $oldAgent = Join-Path $current.path 'agent\GamingHouse.Agent.exe'
    & $oldAgent maintenance-enter --config-dir $dataRoot
    if ($LASTEXITCODE -ne 0) { throw 'Station is occupied or enforcement needs attention. Finish recovery before updating.' }
}
if ($ActivateExisting) {
    if ($target -ne $packageRoot) { throw 'ActivateExisting must run from the selected installed version directory.' }
} else {
    if (Test-Path -LiteralPath $target) { throw 'This version directory already exists. Use its installer with -ActivateExisting for rollback.' }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($file in $manifest.files) {
        $destination = Join-Path $target $file.path
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $packageRoot $file.path) -Destination $destination
    }
    Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $target 'manifest.ps1')
}
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$acl = New-Object Security.AccessControl.DirectorySecurity
$admins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
$system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$acl.SetOwner($admins)
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($admins, $system)) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $dataRoot -AclObject $acl
$agent = Join-Path $target 'agent\GamingHouse.Agent.exe'
$desktop = Join-Path $target 'desktop\GamingHouse.exe'
$binary = '"' + $agent + '" service --config-dir "' + $dataRoot + '"'
$service = Get-Service -Name 'GamingHouse.Agent' -ErrorAction SilentlyContinue
if ($service) {
    Stop-Service -Name 'GamingHouse.Agent'
    $result = Get-CimInstance Win32_Service -Filter "Name='GamingHouse.Agent'" | Invoke-CimMethod -MethodName Change -Arguments @{PathName=$binary}
    if ($result.ReturnValue -ne 0) { throw 'Service update failed; previous version is retained.' }
} else { New-Service -Name 'GamingHouse.Agent' -DisplayName 'Gaming House station agent' -BinaryPathName $binary -StartupType Automatic | Out-Null }
& sc.exe failure GamingHouse.Agent reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
$action = New-ScheduledTaskAction -Execute $desktop
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $PlayerSid
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $PlayerSid -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'Gaming House player' -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
if (Test-Path -LiteralPath $currentPath) { Copy-Item -LiteralPath $currentPath -Destination (Join-Path $installRoot 'previous.json') -Force }
@{version=$manifest.version; path=$target; player_sid=$PlayerSid} | ConvertTo-Json | Set-Content -LiteralPath $currentPath
& $agent maintenance-exit --config-dir $dataRoot
if ($LASTEXITCODE -ne 0) { throw 'Could not clear maintenance mode; investigate before starting the service.' }
Start-Service -Name 'GamingHouse.Agent'
Write-Output 'Installed. Enroll from an elevated terminal, pass the same player SID, and restart GamingHouse.Agent. Restriction is disabled until explicitly configured.'
