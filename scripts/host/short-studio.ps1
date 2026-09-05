# ==============================================================================
# Short Studio Server - operator command (Windows)
# ==============================================================================
# The Windows counterpart of /usr/local/bin/short-studio. The installer creates
# Start Menu shortcuts that call this with one command each, so the customer
# double-clicks rather than typing anything. scripts\host\abud-shorts.ps1 is
# kept as a thin legacy alias that forwards here, for installations upgraded
# from ABUD Shorts Engine 2.4 - it is not advertised to new customers.
#
#   .\short-studio.ps1 status
#   .\short-studio.ps1 update            [-Check] [-TargetVersion 2.2.1] [-Yes]
#   .\short-studio.ps1 backup
#   .\short-studio.ps1 diagnostics
#   .\short-studio.ps1 start | stop | restart
#   .\short-studio.ps1 rollback
#
# Applying an update means controlling Docker. That is why this runs on the host
# and not in the application container, which is never given the Docker socket.
# ==============================================================================

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("status", "update", "backup", "diagnostics", "doctor", "logs", "start", "stop", "restart", "rollback", "owner", "local-voice", "help")]
    [string]$Command = "status",

    [Parameter(Position = 1)]
    [string]$SubCommand = "",

    [switch]$Check,
    [string]$TargetVersion = "",
    [switch]$Yes,
    [switch]$Pause,

    # local-voice install [-LocalVoiceMode AUTO|HIGH_QUALITY|LIGHTWEIGHT|SKIP]
    [ValidateSet("AUTO", "HIGH_QUALITY", "LIGHTWEIGHT", "SKIP")]
    [string]$LocalVoiceMode = "AUTO"
)

$ErrorActionPreference = "Stop"

# The Local Voice lifecycle (hardware detection, runtime/model install, the
# host-native service, auto-start) is one implementation shared with
# install.ps1 - see scripts\host\local-voice-lib.ps1. Write-TextFile below is
# defined before this dot-source, which is the contract that file documents.

# ---------------------------------------------------------------------------
# Installation layout
# ---------------------------------------------------------------------------
# %ProgramData%\ShortStudio\ (fresh installs) or %ProgramData%\AbudShorts\
# (installs upgraded from ABUD Shorts Engine 2.4 - see the detection below):
#   current.txt                the release directory in use
#   releases\<version>\        one directory per installed version
#   shared\                    EVERYTHING THE CUSTOMER OWNS
#     data\ config\ backups\ logs\ state\ installation.json
#
# Windows has no reliable unprivileged directory symlink, so `current` is a text
# file holding a path rather than a link. The invariant is the same: a release
# directory may be replaced, shared\ may not.
if ($env:ABUD_HOME) {
    # Explicit override - always honored, matches the pre-2.5 contract.
    $AbudHome = $env:ABUD_HOME
} elseif (Test-Path (Join-Path $env:ProgramData "AbudShorts")) {
    # An ABUD Shorts Engine 2.4 installation already exists on this machine.
    # Reattaching to it - not a fresh ShortStudio\ root - is what makes the
    # upgrade preserve the owner account, jobs, videos and Provider Vault.
    $AbudHome = Join-Path $env:ProgramData "AbudShorts"
} else {
    $AbudHome = Join-Path $env:ProgramData "ShortStudio"
}
$env:ABUD_HOME   = $AbudHome
$AbudShared      = Join-Path $AbudHome "shared"
$AbudReleases    = Join-Path $AbudHome "releases"
$AbudCurrentFile = Join-Path $AbudHome "current.txt"
$AbudDataDir     = Join-Path $AbudShared "data"
$AbudConfigDir   = Join-Path $AbudShared "config"
$AbudEnvFile     = Join-Path $AbudConfigDir ".env"
$AbudBackupDir   = Join-Path $AbudShared "backups"
$AbudStateDir    = Join-Path $AbudShared "state"
$AbudLockFile    = Join-Path $AbudStateDir "update.lock"
$AbudInstallFile = Join-Path $AbudShared "installation.json"
# Read by the application to populate Settings -> Updates. It lives in the data
# directory because that is the only path both the host and the container see.
$AbudUpdateStateFile = Join-Path $AbudDataDir "updates\update-state.json"
# Fresh installs default to short-studio; an ABUD Shorts Engine 2.4 install
# (detected above by its existing %ProgramData%\AbudShorts root) defaults to
# its existing abud-shorts container/compose project name instead, so this
# script reattaches to the running containers rather than creating new ones.
$DefaultComposeProject = if ($AbudHome -eq (Join-Path $env:ProgramData "AbudShorts")) { "abud-shorts" } else { "short-studio" }
$ComposeProject  = if ($env:SHORT_STUDIO_COMPOSE_PROJECT) { $env:SHORT_STUDIO_COMPOSE_PROJECT }
                    elseif ($env:ABUD_COMPOSE_PROJECT) { $env:ABUD_COMPOSE_PROJECT }
                    else { $DefaultComposeProject }
$DefaultManifestUrl = "https://github.com/3bud-ZC/Abud-Shorts-Engine/releases/latest/download/update-manifest.json"

function Write-Step { param([string]$Text) Write-Host $Text -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "      $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "      $Text" -ForegroundColor Yellow }
function Write-Bad  { param([string]$Text) Write-Host "      $Text" -ForegroundColor Red }

function Stop-WithMessage {
    param([string]$Message)
    Write-Host ""
    Write-Host "  $Message" -ForegroundColor Red
    Write-Host ""
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
    exit 1
}

<#
Writes UTF-8 WITHOUT a byte order mark.

Windows PowerShell 5.1 emits a BOM from both Out-File -Encoding utf8 and
Set-Content -Encoding utf8. Everything that reads these files afterwards is
not PowerShell: the application parses the update record with JSON.parse,
which rejects a leading BOM outright, and docker compose reads the .env file,
where a BOM would corrupt the first variable name. So every file this script
produces is written through here.
#>
function Write-TextFile {
    param([string]$Path, [string]$Content)
    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

. (Join-Path $PSScriptRoot "local-voice-lib.ps1")

function Get-CurrentReleaseDir {
    if (Test-Path $AbudCurrentFile) { return (Get-Content $AbudCurrentFile -Raw).Trim() }
    return ""
}

function Read-InstallationRecord {
    if (Test-Path $AbudInstallFile) {
        try { return Get-Content $AbudInstallFile -Raw | ConvertFrom-Json } catch { return $null }
    }
    return $null
}

function Write-InstallationRecord {
    param([string]$Current, [string]$Previous, [string]$Image, [string]$Channel, [string]$PublicUrl)
    $record = [ordered]@{
        product         = "Short Studio Server"
        currentVersion  = $Current
        previousVersion = $(if ([string]::IsNullOrWhiteSpace($Previous)) { $null } else { $Previous })
        image           = $Image
        channel         = $Channel
        publicUrl       = $PublicUrl
        installRoot     = $AbudHome
        updatedAt       = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    New-Item -ItemType Directory -Path (Split-Path $AbudInstallFile) -Force | Out-Null
    Write-TextFile $AbudInstallFile ($record | ConvertTo-Json -Depth 6)
}

function Get-EnvValue {
    param([string]$Key, [string]$Default = "")
    if (-not (Test-Path $AbudEnvFile)) { return $Default }
    $line = Select-String -Path $AbudEnvFile -Pattern "^$([regex]::Escape($Key))=" | Select-Object -Last 1
    if ($null -eq $line) { return $Default }
    return $line.Line.Substring($Key.Length + 1)
}

function Get-ComposeProject {
    $v = Get-EnvValue "SHORT_STUDIO_COMPOSE_PROJECT" ""
    if (-not $v) { $v = Get-EnvValue "SHORT_STUDIO_CONTAINER_PREFIX" "" }
    if (-not $v) { $v = Get-EnvValue "ABUD_COMPOSE_PROJECT" "" }
    if (-not $v) { $v = Get-EnvValue "ABUD_CONTAINER_PREFIX" "" }
    if (-not $v) { $v = $ComposeProject }
    return $v
}

function Get-ContainerName {
    param([string]$Role)
    $prefix = Get-EnvValue "SHORT_STUDIO_CONTAINER_PREFIX" ""
    if (-not $prefix) { $prefix = Get-EnvValue "ABUD_CONTAINER_PREFIX" "" }
    if (-not $prefix) { $prefix = Get-ComposeProject }
    return "$prefix-$Role"
}

<#
Resolves an installation identifier that has a new SHORT_STUDIO_ name and a
legacy ABUD_ name, in that order, then a hardcoded fallback. Used for the
handful of values (the image reference, most notably) whose historical name
must keep working unchanged on an installation upgraded from ABUD Shorts
Engine 2.4, while a fresh install only ever sees the new name.
#>
function Get-EnvValueDual {
    param([string]$NewKey, [string]$LegacyKey, [string]$Default = "")
    $v = Get-EnvValue $NewKey ""
    if ($v) { return $v }
    $v = Get-EnvValue $LegacyKey ""
    if ($v) { return $v }
    return $Default
}

function Set-EnvValue {
    param([string]$Key, [string]$Value)
    $lines = @()
    if (Test-Path $AbudEnvFile) { $lines = Get-Content $AbudEnvFile }
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^$([regex]::Escape($Key))=") { $found = $true; "$Key=$Value" } else { $line }
    }
    if (-not $found) { $out = @($out) + "$Key=$Value" }
    Write-TextFile $AbudEnvFile (($out -join "`r`n") + "`r`n")
}

function Get-HostPort { return (Get-EnvValue "HOST_PORT" "3130") }
function Get-AppBaseUrl { return "http://127.0.0.1:$(Get-HostPort)" }

<#
Runs docker and returns its exit code in $LASTEXITCODE.

Windows PowerShell wraps anything a native program writes to stderr in an
ErrorRecord, and with $ErrorActionPreference = 'Stop' that aborts the script.
Docker writes all of its normal progress - "Pulling", "Waiting", layer
progress - to stderr, so without this a successful pull would abort an update
halfway through, leaving the installation between versions. The exit code is
the only thing that actually says whether docker succeeded, and every caller
checks it.
#>
function Invoke-Docker {
    # A single array, not ValueFromRemainingArguments: PowerShell would try to
    # bind tokens like -f, -i and --project-name as parameters of this function
    # instead of passing them through to docker.
    param([Parameter(Mandatory = $true, Position = 0)][string[]]$DockerArgs)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker @DockerArgs 2>&1 | ForEach-Object { "$_" }
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Assert-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Stop-WithMessage "Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/ and try again."
    }
    Invoke-Docker @("info") | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Stop-WithMessage "Docker Desktop is not running. Start it, wait for the whale icon to settle, then try again."
    }
}

function Invoke-Compose {
    param([string[]]$Arguments)
    $releaseDir = Get-CurrentReleaseDir
    $composeFile = Join-Path $releaseDir "docker-compose.prod.yml"
    if (-not (Test-Path $composeFile)) {
        Stop-WithMessage "This installation is incomplete: docker-compose.prod.yml is missing."
    }
    $project = Get-ComposeProject
    # Set both the new and legacy env var names directly, so
    # docker-compose.prod.yml resolves the same real values regardless of
    # which tier of its fallback interpolation actually matches.
    $env:SHORT_STUDIO_DATA_DIR = $AbudDataDir
    $env:ABUD_DATA_DIR = $AbudDataDir
    $env:SHORT_STUDIO_RELEASE_DIR = $releaseDir
    $env:ABUD_RELEASE_DIR = $releaseDir
    $env:SHORT_STUDIO_CONTAINER_PREFIX = $project
    $env:ABUD_CONTAINER_PREFIX = $project
    $composeArgs = @("compose", "--project-name", $project, "--env-file", $AbudEnvFile, "--file", $composeFile) + $Arguments
    Invoke-Docker $composeArgs
}

function Get-ContainerHealth {
    param([string]$Name)
    $state = Invoke-Docker @("inspect", "-f", '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', $Name)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($state)) { return "missing" }
    return $state.Trim()
}

<#
Waits, briefly, for the application container health to settle.

The app answers /health/ready as soon as it is up, but Docker only re-runs its
own healthcheck on an interval. Without this pause the summary printed straight
after a state change reports "ABUD Shorts: Problem" on an installation that is
in fact healthy, which reads as a failed update to the operator.
#>
function Wait-ForContainerSettle {
    param([int]$Attempts = 20)
    for ($i = 0; $i -lt $Attempts; $i++) {
        if ((Get-ContainerHealth (Get-ContainerName "app")) -eq "healthy") { return }
        Start-Sleep -Seconds 2
    }
}

function Show-HealthSummary {
    $app        = Get-ContainerHealth (Get-ContainerName "app")
    $worker     = Get-ContainerHealth (Get-ContainerName "render-worker")
    $db         = Get-ContainerHealth (Get-ContainerName "postgres")
    $automation = Get-ContainerHealth (Get-ContainerName "n8n")

    function Friendly([string]$s) {
        switch ($s) {
            "healthy"  { "Healthy" }
            "running"  { "Healthy" }
            "starting" { "Starting" }
            "missing"  { "Not installed" }
            default    { "Problem" }
        }
    }

    $overall = "Healthy"
    foreach ($s in @($app, $worker, $db, $automation)) {
        if ($s -ne "healthy" -and $s -ne "running") { $overall = "Problem" }
    }

    $record = Read-InstallationRecord
    $url = if ($record -and $record.publicUrl) { $record.publicUrl } else { Get-AppBaseUrl }

    Write-Host ""
    Write-Host "  Short Studio:  $overall" -ForegroundColor $(if ($overall -eq "Healthy") { "Green" } else { "Yellow" })
    Write-Host "  Application:   $(Friendly $app)"
    Write-Host "  Video Engine:  $(Friendly $worker)"
    Write-Host "  Database:      $(Friendly $db)"
    Write-Host "  Automation:    $(Friendly $automation)"
    Write-Host "  URL:           $url"
    Write-Host ""
    return ($overall -eq "Healthy")
}

function Wait-ForEndpoint {
    param([string]$Url, [int]$Attempts = 60)
    for ($i = 0; $i -lt $Attempts; $i++) {
        try {
            Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop | Out-Null
            return $true
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

function Get-RunningSystemInfo {
    try {
        return Invoke-RestMethod -Uri "$(Get-AppBaseUrl)/api/v2/system/info" -TimeoutSec 10 -ErrorAction Stop
    } catch { return $null }
}

# ---------------------------------------------------------------------------
# Update lock
# ---------------------------------------------------------------------------
$script:LockStream = $null

function Enter-UpdateLock {
    New-Item -ItemType Directory -Path $AbudStateDir -Force | Out-Null
    try {
        # An exclusive handle is released by the OS even if this process is
        # killed, so a crashed updater cannot wedge the installation.
        $script:LockStream = [System.IO.File]::Open(
            $AbudLockFile, [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch {
        Stop-WithMessage "Update already in progress. Wait for the running update to finish, then try again."
    }
}

function Exit-UpdateLock {
    if ($script:LockStream) {
        $script:LockStream.Close()
        $script:LockStream = $null
        Remove-Item $AbudLockFile -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# Update transaction state
# ---------------------------------------------------------------------------
$script:Txn = $null

function Initialize-Transaction {
    # $Kind distinguishes an update from an administrator asking to go back.
    # Both can end in ROLLED_BACK, but only one of them is a failure, and the
    # Update Center must not describe a deliberate rollback as an update that
    # did not complete.
    param([string]$From, [string]$To, [string]$Channel, [string]$Kind = "update")
    $prefix = if ($Kind -eq "rollback") { "rbk_" } else { "upd_" }
    $script:Txn = [ordered]@{
        transactionId = $prefix + (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss") + "_" + $PID
        state         = "PREPARING"
        kind          = $Kind
        channel       = $Channel
        fromVersion   = $From
        toVersion     = $To
        startedAt     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        updatedAt     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
}

function Save-Transaction {
    param([string]$State)
    if (-not $script:Txn) { return }
    $script:Txn.state = $State
    $script:Txn.updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $terminal = @("SUCCESS", "FAILED", "ROLLED_BACK") -contains $State
    if ($terminal) { $script:Txn.finishedAt = $script:Txn.updatedAt }

    $doc = [ordered]@{ history = @() }
    if (Test-Path $AbudUpdateStateFile) {
        try { $doc = Get-Content $AbudUpdateStateFile -Raw | ConvertFrom-Json } catch { }
    }

    $history = @()
    if ($doc.PSObject.Properties.Name -contains "history" -and $doc.history) {
        $history = @($doc.history | Where-Object { $_.transactionId -ne $script:Txn.transactionId })
    }
    $snapshot = $script:Txn | ConvertTo-Json -Depth 6 | ConvertFrom-Json
    $history += $snapshot
    if ($history.Count -gt 20) { $history = $history[-20..-1] }

    $lastSuccessful = $null
    if ($doc.PSObject.Properties.Name -contains "lastSuccessful") { $lastSuccessful = $doc.lastSuccessful }
    if ($State -eq "SUCCESS") { $lastSuccessful = $snapshot }

    $out = [ordered]@{ history = $history; lastSuccessful = $lastSuccessful }
    if (-not $terminal) { $out.current = $snapshot }

    New-Item -ItemType Directory -Path (Split-Path $AbudUpdateStateFile) -Force | Out-Null
    try {
        Write-TextFile $AbudUpdateStateFile ($out | ConvertTo-Json -Depth 8)
    } catch {
        # Never fabricate a record; say so and carry on with the update itself.
        Write-Warn "Could not write the update transaction record."
    }
}

function Get-InterruptedTransaction {
    if (-not (Test-Path $AbudUpdateStateFile)) { return $null }
    try {
        $doc = Get-Content $AbudUpdateStateFile -Raw | ConvertFrom-Json
        if ($doc.PSObject.Properties.Name -contains "current" -and $doc.current) { return $doc.current }
    } catch { }
    return $null
}

# ---------------------------------------------------------------------------
# Version comparison
# ---------------------------------------------------------------------------
# Numeric, never string: "2.10.0" sorts before "2.9.0" alphabetically, which
# would offer a downgrade as if it were an update.
function Compare-SemVer {
    param([string]$A, [string]$B)
    $aCore, $aPre = ($A -split "-", 2) + @("")
    $bCore, $bPre = ($B -split "-", 2) + @("")
    $aParts = @($aCore -split "\." | ForEach-Object { [int]$_ })
    $bParts = @($bCore -split "\." | ForEach-Object { [int]$_ })
    for ($i = 0; $i -lt 3; $i++) {
        $x = if ($i -lt $aParts.Count) { $aParts[$i] } else { 0 }
        $y = if ($i -lt $bParts.Count) { $bParts[$i] } else { 0 }
        if ($x -ne $y) { return $(if ($x -gt $y) { 1 } else { -1 }) }
    }
    if ($aPre -eq $bPre) { return 0 }
    # A build with no pre-release tag outranks the same version with one.
    if ([string]::IsNullOrEmpty($aPre)) { return 1 }
    if ([string]::IsNullOrEmpty($bPre)) { return -1 }
    return $(if ($aPre -gt $bPre) { 1 } else { -1 })
}

# Strips the tag, and only the tag. A registry host may carry a port
# (registry.example.com:5000/abud/app:2.2.1), and that colon does not introduce
# a tag - cutting at the first colon would turn the reference into the bare
# hostname and the pull would fail.
function Get-ImageRepository {
    param([string]$Reference)
    $lastColon = $Reference.LastIndexOf(":")
    if ($lastColon -lt 0) { return $Reference }
    $suffix = $Reference.Substring($lastColon + 1)
    if ($suffix.Contains("/")) { return $Reference }
    return $Reference.Substring(0, $lastColon)
}

function Get-FileSha256 {
    param([string]$Path)
    if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
        return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLower()
    }

    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $sha.Dispose()
    }
}

# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
# Taken straight from PostgreSQL so it does not depend on the application being
# reachable - which is exactly the case it exists for.
function New-PreUpgradeBackup {
    param([string]$BackupId)
    New-Item -ItemType Directory -Path $AbudBackupDir -Force | Out-Null
    $target = Join-Path $AbudBackupDir "$BackupId.sql"
    $pgUser = Get-EnvValue "POSTGRES_USER" "abud_shorts"
    $pgDb   = Get-EnvValue "POSTGRES_DB" "abud_shorts"

    # Not routed through Invoke-Docker: that merges stderr into the output
    # stream, which would corrupt the dump. stderr is discarded instead, and
    # the preference is relaxed so a warning on it cannot abort the run.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker exec (Get-ContainerName "postgres") pg_dump -U $pgUser -d $pgDb 2>$null |
            Out-File -FilePath $target -Encoding utf8
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $target) -or (Get-Item $target).Length -eq 0) {
        Remove-Item $target -Force -ErrorAction SilentlyContinue
        return $null
    }
    if (Test-Path $AbudEnvFile) {
        Copy-Item $AbudEnvFile (Join-Path $AbudBackupDir "$BackupId.env") -Force
    }
    return $target
}

function Restore-PreUpgradeBackup {
    param([string]$BackupId)
    $source = Join-Path $AbudBackupDir "$BackupId.sql"
    if (-not (Test-Path $source)) { return $false }
    $pgUser = Get-EnvValue "POSTGRES_USER" "abud_shorts"
    $pgDb   = Get-EnvValue "POSTGRES_DB" "abud_shorts"
    # As above: psql reads the dump on stdin, so stderr must not be folded in.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        Get-Content $source | & docker exec -i (Get-ContainerName "postgres") psql -U $pgUser -d $pgDb 2>$null | Out-Null
    } finally {
        $ErrorActionPreference = $previous
    }
    return $true
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
function Invoke-Status {
    Assert-Docker
    $record = Read-InstallationRecord
    $version = if ($record) { $record.currentVersion } else { "unknown" }
    $channel = if ($record -and $record.channel) { $record.channel } else { "stable" }

    Write-Host ""
    Write-Host "  Short Studio Server"
    Write-Host "  Version:       $version"
    Write-Host "  Channel:       $channel"
    $info = Get-RunningSystemInfo
    if ($info) { Write-Host "  Database:      schema $($info.schemaVersion)" }
    $interrupted = Get-InterruptedTransaction
    if ($interrupted) {
        Write-Warn "An update is in progress or was interrupted (state: $($interrupted.state))."
        Write-Host "      Use the 'Short Studio - Update' shortcut to finish it safely."
    }
    Show-HealthSummary | Out-Null
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
}


<#
Local Voice is host-native, not a Compose service, so the full-product
start/stop/restart commands drive it alongside Docker rather than through it.
Any failure here is reported but never blocks the Docker-side result - the
same "do not break the whole app" rule the setup path follows.
#>
function Sync-LocalVoiceWithProductLifecycle {
    param([ValidateSet("start", "stop", "restart")][string]$Action)
    $mode = Get-EnvValue "LOCAL_VOICE_MODE" "SKIP"
    if ($mode -eq "SKIP" -or -not $mode) { return }
    try {
        $appSourceDir = Get-LocalVoiceAppSourceDir
        $port = [int](Get-EnvValue "LOCAL_TTS_PORT" "8765")
        $paths = Get-LocalVoicePaths -AbudShared $AbudShared -AbudDataDir $AbudDataDir -Port $port
        $token = Get-EnvValue "INTERNAL_SERVICE_TOKEN" ""
        switch ($Action) {
            "start"   { Start-LocalVoiceService -Paths $paths -AppSourceDir $appSourceDir -InternalServiceToken $token | Out-Null }
            "stop"    { Stop-LocalVoiceService -Paths $paths | Out-Null }
            "restart" { Restart-LocalVoiceService -Paths $paths -AppSourceDir $appSourceDir -InternalServiceToken $token | Out-Null }
        }
    } catch {
        Write-Warn "Local Voice $Action failed: $($_.Exception.Message)"
    }
}

function Invoke-Start {
    Assert-Docker
    Write-Step "Starting Short Studio..."
    Invoke-Compose @("up", "-d")
    Sync-LocalVoiceWithProductLifecycle "start"
    Wait-ForEndpoint "$(Get-AppBaseUrl)/health/ready" 90 | Out-Null
    Wait-ForContainerSettle
    Show-HealthSummary | Out-Null
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
}

function Invoke-Stop {
    Assert-Docker
    Write-Step "Stopping Short Studio..."
    # `stop`, never `down -v`: containers halt, every volume and every file in
    # the data directory stays exactly where it is.
    Invoke-Compose @("stop")
    Sync-LocalVoiceWithProductLifecycle "stop"
    Write-Ok "Stopped. Your videos, settings and backups are untouched."
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
}

function Invoke-Restart {
    Assert-Docker
    Write-Step "Restarting Short Studio..."
    Invoke-Compose @("restart")
    Sync-LocalVoiceWithProductLifecycle "restart"
    Wait-ForEndpoint "$(Get-AppBaseUrl)/health/ready" 90 | Out-Null
    Wait-ForContainerSettle
    Show-HealthSummary | Out-Null
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
}

function Invoke-OwnerCommand {
    param([string]$Action)
    Assert-Docker

    if ($Action -ne "reset-password") {
        Write-Host 'Usage: short-studio.ps1 owner reset-password'
        Write-Host '  Interactively resets the owner account when you cannot sign in.'
        Write-Host '  Requires local access to this machine. No customer data is touched.'
        return
    }

    $appContainer = Get-ContainerName "app"
    $running = Invoke-Docker @("inspect", "-f", "{{.State.Running}}", $appContainer)
    if ($LASTEXITCODE -ne 0 -or ($running | Select-Object -Last 1) -ne "true") {
        Stop-WithMessage "The app service is not running. Start Short Studio first (Status shortcut), then try again."
    }

    Write-Step "Owner password recovery"
    Write-Host "      This runs inside the application, asks for the new username/password"
    Write-Host "      directly (never on this command line), and signs out every existing"
    Write-Host "      session. Nothing else about this installation is changed."
    Write-Host ""

    & docker exec -it $appContainer node dist/scripts/resetOwnerCredentials.js
    exit $LASTEXITCODE
}

<# The services\local-tts source ships inside the current release directory;
   the runtime venv and model cache live under shared\ (see local-voice-lib.ps1),
   which is what makes the setup survive an update. #>
function Get-LocalVoiceAppSourceDir {
    $releaseDir = Get-CurrentReleaseDir
    if (-not $releaseDir) { Stop-WithMessage "Short Studio is not installed yet. Run install.ps1 first." }
    return (Join-Path $releaseDir "services\local-tts")
}

function Show-LocalVoiceStatus {
    param($Paths, $Result = $null)
    $status = Get-LocalVoiceServiceStatus -Paths $Paths
    Write-Host ""
    Write-Host "  Local Voice"
    Write-Host "  Mode:            $(Get-EnvValue "LOCAL_VOICE_MODE" "not set")"
    Write-Host "  Port:            $($Paths.Port)"
    Write-Host "  Runtime ready:   $(Test-LocalVoiceRuntimeReady -Paths $Paths)"
    Write-Host "  Service running: $($status.running)"
    Write-Host "  Service healthy: $($status.healthy)"
    Write-Host "  Models ready:    $(if ($status.modelsReady.Count -gt 0) { $status.modelsReady -join ', ' } else { 'none' })"
    Write-Host "  Auto-start:      $((Test-LocalVoiceAutoStartRegistered).mechanism)"
    if ($Result -and $Result.error) { Write-Bad "Last setup error: $($Result.error)" }
    Write-Host ""
}

function Invoke-LocalVoiceCommand {
    param([string]$Action)
    $appSourceDir = Get-LocalVoiceAppSourceDir
    $port = [int](Get-EnvValue "LOCAL_TTS_PORT" "8765")
    $paths = Get-LocalVoicePaths -AbudShared $AbudShared -AbudDataDir $AbudDataDir -Port $port
    $token = Get-EnvValue "INTERNAL_SERVICE_TOKEN" ""

    switch ($Action) {
        "install" {
            Write-Step "Setting up Local Voice ($LocalVoiceMode)..."
            $result = Invoke-LocalVoiceSetup -Mode $LocalVoiceMode -AbudShared $AbudShared -AbudDataDir $AbudDataDir `
                -AppSourceDir $appSourceDir -LibRoot $PSScriptRoot `
                -InternalServiceToken $token
            if ($result.resolvedMode -ne "SKIP") {
                Set-EnvValue "LOCAL_VOICE_MODE" $result.resolvedMode
                if ($result.port) { Set-EnvValue "LOCAL_TTS_PORT" "$($result.port)" }
                if ($result.baseUrl) { Set-EnvValue "LOCAL_TTS_BASE_URL" $result.baseUrl }
            } else {
                Set-EnvValue "LOCAL_VOICE_MODE" "SKIP"
            }
            if ($result.error) {
                Write-Bad "Local High Quality setup failed: $($result.error)"
                Write-Host "      Retry with: short-studio.ps1 local-voice repair"
                Write-Host "      ElevenLabs was not used. Arabic jobs will report Local Voice setup is required until this is fixed."
            } else {
                Write-Ok "Resolved mode: $($result.resolvedMode) ($($result.resolutionReason))"
                if ($result.resolvedMode -ne "SKIP") {
                    Write-Ok "Model: $($result.modelId), ready: $($result.modelReady)"
                    Write-Ok "Service healthy: $($result.serviceStarted); auto-start: $($result.autoStartMechanism)"
                }
            }
        }
        "start" {
            $r = Start-LocalVoiceService -Paths $paths -AppSourceDir $appSourceDir -InternalServiceToken $token
            if ($r.ready) { Write-Ok "Local Voice is running on port $($paths.Port)." }
            else { Write-Bad "Local Voice did not become healthy. Check $($paths.LogFile)." }
        }
        "stop" {
            Stop-LocalVoiceService -Paths $paths | Out-Null
            Write-Ok "Local Voice stopped."
        }
        "restart" {
            $r = Restart-LocalVoiceService -Paths $paths -AppSourceDir $appSourceDir -InternalServiceToken $token
            if ($r.ready) { Write-Ok "Local Voice restarted and healthy." }
            else { Write-Bad "Local Voice did not become healthy after restart. Check $($paths.LogFile)." }
        }
        "repair" {
            Write-Step "Repairing Local Voice..."
            $mode = Get-EnvValue "LOCAL_VOICE_MODE" "AUTO"
            if ($mode -eq "SKIP" -or $mode -eq "not set") { $mode = "AUTO" }
            $result = Invoke-LocalVoiceSetup -Mode $mode -AbudShared $AbudShared -AbudDataDir $AbudDataDir `
                -AppSourceDir $appSourceDir -LibRoot $PSScriptRoot `
                -InternalServiceToken $token -Repair
            if ($result.error) { Write-Bad "Repair failed: $($result.error)" }
            else { Write-Ok "Repair complete. Resolved mode: $($result.resolvedMode)." }
        }
        "uninstall" {
            Stop-LocalVoiceService -Paths $paths | Out-Null
            Unregister-LocalVoiceAutoStart -AbudShared $AbudShared | Out-Null
            Write-Ok "Local Voice service stopped and auto-start removed."
            Write-Host "      The downloaded model and Python runtime were preserved."
            Write-Host "      To remove them too: Remove-Item -Recurse -Force `"$($paths.RuntimeDir)`", `"$($paths.ModelCacheDir)`""
        }
        "status" {
            Show-LocalVoiceStatus -Paths $paths
        }
        default {
            Write-Host 'Usage: short-studio.ps1 local-voice <install|start|stop|restart|repair|uninstall|status>'
            Write-Host '  install [-LocalVoiceMode AUTO|HIGH_QUALITY|LIGHTWEIGHT|SKIP]'
        }
    }
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
}

function Invoke-Backup {
    Assert-Docker
    Write-Step "Creating a backup..."
    $id = "manual-" + (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
    $path = New-PreUpgradeBackup $id
    if ($path) {
        Write-Ok "Backup created: $path"
        Write-Host "      It contains the database and this installation's configuration."
        Write-Host "      Videos and media are not copied; they already live in $AbudDataDir."
    } else {
        Write-Bad "The backup could not be created. Check the system with the Status shortcut."
    }
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
}

function Invoke-Diagnostics {
    Assert-Docker
    Write-Step "Running diagnostics..."
    $out = Join-Path (Join-Path $AbudShared "logs") ("short-studio-support-bundle-" + (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss") + ".json")
    New-Item -ItemType Directory -Path (Split-Path $out) -Force | Out-Null
    # The application already builds the bundle with secrets redacted, so the
    # terminal and the browser produce the same file. It is fetched over the
    # internal route with this installation's own service token, because the
    # browser route needs an administrator session and a freshly installed
    # system does not have one yet.
    $internalToken = Get-EnvValue "INTERNAL_SERVICE_TOKEN"
    $reason = "The application could not be reached"
    $written = $false
    if ($internalToken) {
        try {
            Invoke-WebRequest -Uri "$(Get-AppBaseUrl)/internal/v1/system/diagnostics/bundle" `
                -Headers @{ "x-internal-token" = $internalToken } `
                -OutFile $out -TimeoutSec 60 -UseBasicParsing -ErrorAction Stop
            Write-Ok "Support bundle written to: $out"
            $written = $true
        } catch {
            # Say what actually happened rather than blaming the network for
            # what may be a rejected token.
            $status = $null
            if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
            if ($status -eq 401 -or $status -eq 403) {
                $reason = "The application rejected this installation's service token"
            } elseif ($status) {
                $reason = "The application answered with HTTP $status"
            }
        }
    } else {
        $reason = "This installation's configuration has no service token"
    }

    if (-not $written) {
        Write-Warn "$reason, so a reduced bundle was written instead."
        $reduced = [ordered]@{
            generatedAt      = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            installedVersion = (Read-InstallationRecord).currentVersion
            note             = "$reason; container status only."
            containers       = [ordered]@{
                app          = Get-ContainerHealth (Get-ContainerName "app")
                renderWorker = Get-ContainerHealth (Get-ContainerName "render-worker")
                database     = Get-ContainerHealth (Get-ContainerName "postgres")
                automation   = Get-ContainerHealth (Get-ContainerName "n8n")
            }
        }
        Write-TextFile $out ($reduced | ConvertTo-Json -Depth 6)
        Write-Ok "Reduced bundle written to: $out"
    }
    Show-HealthSummary | Out-Null
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
}

<#
A concise, safe support tool: PASS/WARN/FAIL against the things a real support
call actually needs (version, Docker, every service, Local Voice, disk, the
port, and update-manifest reachability), reusing the exact same internal
diagnostics bundle `diagnostics` already writes to a file - never a second,
divergent implementation of "is this installation healthy." Never prints a
password, token, API key, vault plaintext or session cookie: only booleans
and status strings the bundle itself already redacted.
#>
function Write-DoctorLine {
    param([string]$Result, [string]$Text)
    $color = switch ($Result) { "PASS" { "Green" } "WARN" { "Yellow" } default { "Red" } }
    Write-Host ("  [{0,-4}] {1}" -f $Result, $Text) -ForegroundColor $color
    return $Result
}

function Invoke-Doctor {
    Write-Step "SHORT STUDIO SERVER - Doctor"
    $record = Read-InstallationRecord
    Write-Host "  Version: $(if ($record) { $record.currentVersion } else { '2.5.0' })"
    $results = @()

    if ($record) {
        $results += Write-DoctorLine "PASS" "Installed version $($record.currentVersion), channel $($record.channel)"
    } else {
        $results += Write-DoctorLine "FAIL" "No installation record found (is this an installed system?)"
    }

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        $results += Write-DoctorLine "FAIL" "Docker is not installed"
    } else {
        Invoke-Docker @("info") | Out-Null
        if ($LASTEXITCODE -eq 0) { $results += Write-DoctorLine "PASS" "Docker Desktop is running" }
        else { $results += Write-DoctorLine "FAIL" "Docker Desktop is installed but not running" }
    }

    foreach ($role in @("app", "render-worker", "postgres", "n8n")) {
        $health = Get-ContainerHealth (Get-ContainerName $role)
        $r = switch ($health) { "healthy" { "PASS" } "running" { "PASS" } "starting" { "WARN" } default { "FAIL" } }
        $results += Write-DoctorLine $r "Container $role : $health"
    }

    $internalToken = Get-EnvValue "INTERNAL_SERVICE_TOKEN"
    $bundle = $null
    if ($internalToken) {
        try {
            $bundle = Invoke-RestMethod -Uri "$(Get-AppBaseUrl)/internal/v1/system/diagnostics/bundle" `
                -Headers @{ "x-internal-token" = $internalToken } -TimeoutSec 15 -ErrorAction Stop
        } catch { }
    }
    if ($bundle) {
        $results += Write-DoctorLine "PASS" "Application diagnostics reachable (schema $($bundle.product.schemaVersion))"
        $pg = $bundle.services.postgres
        $results += Write-DoctorLine $(if ($pg.ok) { "PASS" } else { "FAIL" }) "Database connectivity: $($pg.message)"
        if ($bundle.providers) {
            $healthy = @($bundle.providers | Where-Object { $_.healthy }).Count
            $configured = @($bundle.providers | Where-Object { $_.configured }).Count
            $results += Write-DoctorLine "PASS" "Providers: $configured configured, $healthy healthy, $($bundle.providers.Count) total"
        }
        if ($null -ne $bundle.recentFailedJobs) {
            $failedCount = @($bundle.recentFailedJobs).Count
            $r = if ($failedCount -eq 0) { "PASS" } else { "WARN" }
            $results += Write-DoctorLine $r "Recent failed jobs: $failedCount"
        }
    } else {
        $results += Write-DoctorLine "WARN" "Could not reach application diagnostics (app may still be starting)"
    }

    $port = Get-HostPort
    $portOpen = $false
    try {
        $probe = New-Object System.Net.Sockets.TcpClient
        $probe.Connect("127.0.0.1", [int]$port)
        $probe.Close()
        $portOpen = $true
    } catch { }
    $results += Write-DoctorLine $(if ($portOpen) { "PASS" } else { "FAIL" }) "Port $port is reachable"

    try {
        $driveLetter = (Split-Path -Qualifier $AbudHome).TrimEnd(":")
        $freeGb = [math]::Round((Get-PSDrive -Name $driveLetter).Free / 1GB, 1)
        $r = if ($freeGb -ge 10) { "PASS" } elseif ($freeGb -ge 3) { "WARN" } else { "FAIL" }
        $results += Write-DoctorLine $r "Disk free on $($driveLetter): $freeGb GB"
    } catch {
        $results += Write-DoctorLine "WARN" "Could not determine free disk space"
    }

    foreach ($dir in @($AbudDataDir, $AbudBackupDir)) {
        $r = if (Test-Path $dir) { "PASS" } else { "FAIL" }
        $results += Write-DoctorLine $r "Data path exists: $dir"
    }

    $lvMode = Get-EnvValue "LOCAL_VOICE_MODE" "SKIP"
    if ($lvMode -eq "SKIP" -or -not $lvMode) {
        $results += Write-DoctorLine "WARN" "Local Voice: setup skipped (Arabic jobs will report setup required)"
    } else {
        try {
            $lvPort = [int](Get-EnvValue "LOCAL_TTS_PORT" "8765")
            $lvPaths = Get-LocalVoicePaths -AbudShared $AbudShared -AbudDataDir $AbudDataDir -Port $lvPort
            $lvStatus = Get-LocalVoiceServiceStatus -Paths $lvPaths
            $r = if ($lvStatus.healthy -and $lvStatus.modelsReady.Count -gt 0) { "PASS" } elseif ($lvStatus.running) { "WARN" } else { "FAIL" }
            $modelsText = if ($lvStatus.modelsReady.Count -gt 0) { $lvStatus.modelsReady -join ", " } else { "none ready" }
            $results += Write-DoctorLine $r "Local Voice ($lvMode): healthy=$($lvStatus.healthy), models=$modelsText"
            $autoStart = Test-LocalVoiceAutoStartRegistered
            $results += Write-DoctorLine $(if ($autoStart.any) { "PASS" } else { "WARN" }) "Local Voice auto-start: $($autoStart.mechanism)"
        } catch {
            $results += Write-DoctorLine "WARN" "Local Voice status could not be checked: $($_.Exception.Message)"
        }
    }

    $manifestUrl = if ($env:SHORT_STUDIO_UPDATE_MANIFEST_URL) { $env:SHORT_STUDIO_UPDATE_MANIFEST_URL } elseif ($env:ABUD_UPDATE_MANIFEST_URL) { $env:ABUD_UPDATE_MANIFEST_URL } else { $DefaultManifestUrl }
    try {
        Invoke-WebRequest -Uri $manifestUrl -Method Head -TimeoutSec 8 -UseBasicParsing -ErrorAction Stop | Out-Null
        $results += Write-DoctorLine "PASS" "Update manifest reachable"
    } catch {
        $results += Write-DoctorLine "WARN" "Update manifest not reachable right now (offline, or no release published yet)"
    }

    $fail = @($results | Where-Object { $_ -eq "FAIL" }).Count
    $warn = @($results | Where-Object { $_ -eq "WARN" }).Count
    $pass = @($results | Where-Object { $_ -eq "PASS" }).Count
    Write-Host ""
    Write-Host "  Summary: $pass passed, $warn warnings, $fail failed" -ForegroundColor $(if ($fail -gt 0) { "Red" } elseif ($warn -gt 0) { "Yellow" } else { "Green" })
    Write-Host ""
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
}

<#
One supported way to see recent logs, instead of an operator needing to know
each container's own name or that Local Voice logs somewhere else entirely.
Bounded by Docker's own configured log rotation (max-size/max-file, set on
every production service) and, for Local Voice, by the same bounded/rotated
file Start-LocalVoiceService already writes - this command never reads an
unbounded log.
#>
function Invoke-Logs {
    param([string]$Target = "", [int]$Lines = 200)
    $targets = if ($Target) { @($Target) } else { @("app", "worker", "postgres", "n8n", "local-voice") }
    foreach ($t in $targets) {
        Write-Step "--- $t ---"
        switch ($t) {
            "worker" { Invoke-Docker @("logs", "--tail", "$Lines", (Get-ContainerName "render-worker")) | ForEach-Object { Write-Host $_ } }
            "database" { Invoke-Docker @("logs", "--tail", "$Lines", (Get-ContainerName "postgres")) | ForEach-Object { Write-Host $_ } }
            "postgres" { Invoke-Docker @("logs", "--tail", "$Lines", (Get-ContainerName "postgres")) | ForEach-Object { Write-Host $_ } }
            "local-voice" {
                $lvPort = [int](Get-EnvValue "LOCAL_TTS_PORT" "8765")
                $lvPaths = Get-LocalVoicePaths -AbudShared $AbudShared -AbudDataDir $AbudDataDir -Port $lvPort
                if (Test-Path $lvPaths.LogFile) { Get-Content $lvPaths.LogFile -Tail $Lines }
                else { Write-Host "      No Local Voice log yet." }
            }
            default { Invoke-Docker @("logs", "--tail", "$Lines", (Get-ContainerName $t)) | ForEach-Object { Write-Host $_ } }
        }
        Write-Host ""
    }
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
}

function Invoke-Rollback {
    Assert-Docker
    $record = Read-InstallationRecord
    if (-not $record -or -not $record.previousVersion) {
        Stop-WithMessage "There is no previous version to return to. This installation has not been updated yet."
    }
    $previous = $record.previousVersion
    $previousDir = Join-Path $AbudReleases $previous
    if (-not (Test-Path $previousDir)) {
        Stop-WithMessage "Version $previous is recorded but its files are no longer on this machine. Restore from a backup instead."
    }

    Write-Host ""
    Write-Host "  This returns Short Studio from version $($record.currentVersion) to version $previous."
    Write-Host "  Videos, media, brands, settings and publication history are not removed."
    Write-Host ""
    if (-not $Yes) {
        $reply = Read-Host "  Type YES to continue"
        if ($reply -ne "YES") { Write-Host "  Cancelled. Nothing has been changed."; return }
    }

    Enter-UpdateLock
    try {
        Initialize-Transaction $record.currentVersion $previous $record.channel "rollback"
        Save-Transaction "ROLLING_BACK"

        $previousImage = ""
        $previousReleaseJson = Join-Path $previousDir "release.json"
        if (Test-Path $previousReleaseJson) {
            $previousImage = (Get-Content $previousReleaseJson -Raw | ConvertFrom-Json).image
        }

        Invoke-Compose @("stop", "short-studio-app", "short-studio-render-worker") 2>$null | Out-Null
        if ($previousImage) { Set-EnvValue "SHORT_STUDIO_IMAGE" $previousImage; Set-EnvValue "ABUD_IMAGE" $previousImage }
        Write-TextFile $AbudCurrentFile $previousDir
        Write-InstallationRecord $previous "" $previousImage $record.channel $record.publicUrl

        Invoke-Compose @("up", "-d") 2>$null | Out-Null

        if (Wait-ForEndpoint "$(Get-AppBaseUrl)/health/ready" 90) {
            $script:Txn.rollback = [ordered]@{
                attempted = $true; result = "succeeded"; restoredVersion = $previous
                databaseRestored = $false
                message = "Manual rollback requested by the administrator."
            }
            Save-Transaction "ROLLED_BACK"
            Wait-ForContainerSettle
            Write-Ok "Returned to version $previous."
        } else {
            $script:Txn.rollback = [ordered]@{
                attempted = $true; result = "failed"; restoredVersion = $previous
                databaseRestored = $false
                message = "Manual rollback did not reach a healthy state."
            }
            Save-Transaction "FAILED"
            Write-Bad "Version $previous was restored but the system is not healthy."
        }
    } finally {
        Exit-UpdateLock
    }
    Show-HealthSummary | Out-Null
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
}

function Invoke-Update {
    Assert-Docker

    $manifestUrl = if ($env:SHORT_STUDIO_UPDATE_MANIFEST_URL) { $env:SHORT_STUDIO_UPDATE_MANIFEST_URL } elseif ($env:ABUD_UPDATE_MANIFEST_URL) { $env:ABUD_UPDATE_MANIFEST_URL } else { $DefaultManifestUrl }
    $record = Read-InstallationRecord
    if (-not $record) { Stop-WithMessage "This does not look like an installed system. Run install.ps1 first." }
    $channel = if ($record.channel) { $record.channel } else { "stable" }
    $currentVersion = $record.currentVersion

    Write-Step "Checking for updates..."
    $workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("abud-update-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $workDir -Force | Out-Null

    try {
        $manifestFile = Join-Path $workDir "update-manifest.json"
        try {
            Invoke-WebRequest -Uri $manifestUrl -OutFile $manifestFile -TimeoutSec 30 -UseBasicParsing -ErrorAction Stop
        } catch {
            Stop-WithMessage "Could not reach the update service. Check this machine's internet connection and try again."
        }

        try { $manifest = Get-Content $manifestFile -Raw | ConvertFrom-Json }
        catch { Stop-WithMessage "The update manifest is not valid. Nothing has been changed." }

        $release = $null
        if ($manifest.PSObject.Properties.Name -contains "channels") {
            $release = $manifest.channels.$channel
        } elseif ($manifest.channel -eq $channel) {
            $release = $manifest
        }
        if (-not $release) { Stop-WithMessage "No $channel release is published yet." }

        # Every field the updater acts on is validated before anything stops.
        # Accepts either the current or the pre-rebrand product label: a manifest
        # published right after the 2.5.0 cutover must still be installable by an
        # ABUD Shorts Engine 2.4 install whose own updater has not run this file yet.
        if ($release.product -ne "Short Studio Server" -and $release.product -ne "ABUD Shorts Engine") { Stop-WithMessage "The manifest does not describe this product." }
        if ($release.channel -ne $channel) { Stop-WithMessage "The published release is not on the $channel channel. Nothing has been changed." }
        if ($release.version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { Stop-WithMessage "The manifest carries an invalid version." }
        if ($release.imageDigest -notmatch '^sha256:[a-f0-9]{64}$') { Stop-WithMessage "The manifest carries an invalid image digest." }
        if ($release.packageSha256 -notmatch '^[a-fA-F0-9]{64}$') { Stop-WithMessage "The manifest carries an invalid package checksum." }
        if (-not $release.image -or -not $release.packageUrl) { Stop-WithMessage "The manifest is missing the release artifacts." }

        if ($TargetVersion -and $TargetVersion -ne $release.version) {
            Stop-WithMessage "Version $TargetVersion is not the version published on the $channel channel ($($release.version)). Only published releases can be installed."
        }

        Write-Host ""
        Write-Host "  Installed version: $currentVersion"
        Write-Host "  Latest version:    $($release.version) ($channel)"
        Write-Host "  Release notes:     $($release.releaseUrl)"
        Write-Host ""

        if ((Compare-SemVer $release.version $currentVersion) -le 0) {
            Write-Ok "You are already running the latest version."
            if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
            return
        }
        if ((Compare-SemVer $currentVersion $release.minimumUpdaterVersion) -lt 0) {
            Stop-WithMessage "Version $($release.version) cannot be installed directly from $currentVersion. Install $($release.minimumUpdaterVersion) first."
        }
        if ($Check) {
            Write-Ok "An update is available: $($release.version)"
            Write-Host '      Install it with the "Short Studio - Update" shortcut.'
            if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
            return
        }

        Enter-UpdateLock

        $interrupted = Get-InterruptedTransaction
        if ($interrupted) {
            Write-Warn "A previous update stopped in state $($interrupted.state) without finishing."
            Write-Host "      This run starts a fresh, verified update and finishes with a health check."
            Write-Host "      If it fails, the installation is rolled back to $currentVersion."
            if (-not $Yes) {
                $reply = Read-Host "  Continue? [y/N]"
                if ($reply -notmatch '^(y|Y|yes|YES)$') { Write-Host "  Cancelled. Nothing has been changed."; return }
            }
        }

        Initialize-Transaction $currentVersion $release.version $channel
        $script:Txn.schemaVersion  = $release.schemaVersion
        $script:Txn.imageDigest    = $release.imageDigest
        $script:Txn.packageSha256  = $release.packageSha256
        Save-Transaction "PREPARING"

        # --- disk ---------------------------------------------------------
        Write-Step "[1/9] Checking this machine..."
        $drive = Get-PSDrive -Name (Split-Path -Qualifier $AbudHome).TrimEnd(":")
        $freeGb = [math]::Round($drive.Free / 1GB, 1)
        if ($freeGb -lt 8) {
            $script:Txn.error = "Not enough free disk space ($freeGb GB available, 8 GB required)."
            Save-Transaction "FAILED"
            Stop-WithMessage "Not enough free disk space: $freeGb GB available, at least 8 GB is needed. Nothing has been changed."
        }
        Write-Ok "Docker is running and there is $freeGb GB free."

        # --- download and verify, before anything is stopped ---------------
        Write-Step "[2/9] Downloading version $($release.version)..."
        $packageFile = Join-Path $workDir "package.tar.gz"
        try {
            Invoke-WebRequest -Uri $release.packageUrl -OutFile $packageFile -TimeoutSec 900 -UseBasicParsing -ErrorAction Stop
        } catch {
            $script:Txn.error = "The release package could not be downloaded."
            Save-Transaction "FAILED"
            Stop-WithMessage "The update could not be downloaded. Nothing has been changed."
        }

        Write-Step "[3/9] Verifying the download..."
        $actual = Get-FileSha256 $packageFile
        if ($actual -ne $release.packageSha256.ToLower()) {
            $script:Txn.error = "Checksum mismatch on the downloaded package."
            Save-Transaction "FAILED"
            Stop-WithMessage "Download verification failed: the file does not match the checksum published for this release. Nothing has been changed."
        }
        Write-Ok "Checksum verified."

        # Pulling by digest rather than tag is what makes the image immutable.
        $imageRepo = Get-ImageRepository $release.image
        $pinnedImage = "$imageRepo@$($release.imageDigest)"
        Invoke-Docker @("pull", $pinnedImage) | Out-Null
        if ($LASTEXITCODE -ne 0) {
            $script:Txn.error = "The application image could not be downloaded."
            Save-Transaction "FAILED"
            Stop-WithMessage "The application image could not be downloaded. Nothing has been changed."
        }
        Invoke-Docker @("image", "inspect", $pinnedImage) | Out-Null
        if ($LASTEXITCODE -ne 0) {
            $script:Txn.error = "The downloaded image could not be verified."
            Save-Transaction "FAILED"
            Stop-WithMessage "The downloaded application image could not be verified. Nothing has been changed."
        }
        Write-Ok "Application image verified by digest."

        $extractDir = Join-Path $workDir "extract"
        New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
        & tar -xzf $packageFile -C $extractDir 2>$null
        if ($LASTEXITCODE -ne 0) {
            $script:Txn.error = "The release package could not be extracted."
            Save-Transaction "FAILED"
            Stop-WithMessage "The downloaded update could not be opened. Nothing has been changed."
        }
        $packageRoot = $extractDir
        $entries = @(Get-ChildItem $extractDir)
        if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) { $packageRoot = $entries[0].FullName }
        foreach ($required in @("docker-compose.prod.yml", "scripts\host\short-studio.ps1")) {
            if (-not (Test-Path (Join-Path $packageRoot $required))) {
                $script:Txn.error = "The release package is missing $required."
                Save-Transaction "FAILED"
                Stop-WithMessage "The downloaded update is not a valid Short Studio client package. Nothing has been changed."
            }
        }
        Write-Ok "Package contents verified."

        # --- pre-upgrade backup -------------------------------------------
        Write-Step "[4/9] Creating a safety backup..."
        $backupId = "pre-upgrade-$currentVersion-to-$($release.version)-" + (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
        $backupPath = New-PreUpgradeBackup $backupId
        if (-not $backupPath) {
            $script:Txn.error = "The pre-upgrade backup could not be created."
            Save-Transaction "FAILED"
            Stop-WithMessage "A safety backup could not be created, so the update was stopped. Nothing has been changed."
        }
        Write-Ok "Backup saved: $(Split-Path $backupPath -Leaf)"
        $script:Txn.backupId = $backupId
        Save-Transaction "BACKED_UP"

        # --- switch version ------------------------------------------------
        Write-Step "[5/9] Installing version $($release.version)..."
        $previousReleaseDir = Get-CurrentReleaseDir
        $previousImage = Get-EnvValueDual "SHORT_STUDIO_IMAGE" "ABUD_IMAGE"
        $newReleaseDir = Join-Path $AbudReleases $release.version

        if (Test-Path "$newReleaseDir.incoming") { Remove-Item "$newReleaseDir.incoming" -Recurse -Force }
        New-Item -ItemType Directory -Path "$newReleaseDir.incoming" -Force | Out-Null
        Copy-Item (Join-Path $packageRoot "*") "$newReleaseDir.incoming" -Recurse -Force
        if (Test-Path $newReleaseDir) { Remove-Item $newReleaseDir -Recurse -Force }
        Move-Item "$newReleaseDir.incoming" $newReleaseDir

        # Each release records the image it runs, so rollback needs no network.
        [ordered]@{
            version = $release.version; image = $pinnedImage; imageDigest = $release.imageDigest
            schemaVersion = $release.schemaVersion; channel = $channel
            installedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            schemaBackwardsCompatible = [bool]$release.schemaBackwardsCompatible
        } | ConvertTo-Json -Depth 6 | ForEach-Object { Write-TextFile (Join-Path $newReleaseDir "release.json") $_ }

        Save-Transaction "APPLYING"

        # Only the two services whose image changes stop. PostgreSQL and n8n
        # keep running, so no data volume is ever detached.
        Invoke-Compose @("stop", "short-studio-app", "short-studio-render-worker") 2>$null | Out-Null

        Set-EnvValue "SHORT_STUDIO_IMAGE" $pinnedImage; Set-EnvValue "ABUD_IMAGE" $pinnedImage
        Write-TextFile $AbudCurrentFile $newReleaseDir
        Write-InstallationRecord $release.version $currentVersion $pinnedImage $channel $record.publicUrl

        # --- rollback closure ---------------------------------------------
        $rollback = {
            param([string]$Reason)
            Write-Bad $Reason
            Write-Step "[!] Rolling back to version $currentVersion..."
            Save-Transaction "ROLLING_BACK"

            $databaseRestored = $false
            if ($previousReleaseDir) { Write-TextFile $AbudCurrentFile $previousReleaseDir }
            if ($previousImage) { Set-EnvValue "SHORT_STUDIO_IMAGE" $previousImage; Set-EnvValue "ABUD_IMAGE" $previousImage }
            # Restore the record exactly as it was before this attempt, keeping
            # the version that preceded $currentVersion. Clearing it would leave
            # `abud-shorts rollback` with no target even though that release is
            # still on disk.
            Write-InstallationRecord $currentVersion $record.previousVersion $previousImage $channel $record.publicUrl

            # A release whose migrations are not backwards compatible cannot be
            # undone by restoring code alone: the old application would meet a
            # schema it does not understand.
            if (-not $release.schemaBackwardsCompatible) {
                Write-Warn "This release changed the database in a way the previous version cannot read."
                Invoke-Compose @("stop", "short-studio-app", "short-studio-render-worker") 2>$null | Out-Null
                if (Restore-PreUpgradeBackup $backupId) {
                    $databaseRestored = $true
                    Write-Ok "Database restored from the pre-upgrade backup."
                } else {
                    Write-Bad "The database could not be restored automatically."
                }
            }

            Invoke-Compose @("up", "-d") 2>$null | Out-Null

            $result = "failed"
            if (Wait-ForEndpoint "$(Get-AppBaseUrl)/health/ready" 60) {
                $result = "succeeded"
                Write-Ok "Rolled back to version $currentVersion and the system is healthy again."
                Wait-ForContainerSettle
                Sync-LocalVoiceWithProductLifecycle "restart"
            } else {
                Write-Bad "Rollback finished but the system is not reporting healthy."
            }

            $script:Txn.error = $Reason
            $script:Txn.rollback = [ordered]@{
                attempted = $true; result = $result; restoredVersion = $currentVersion
                databaseRestored = $databaseRestored; message = $Reason
            }
            Save-Transaction "ROLLED_BACK"

            Show-HealthSummary | Out-Null
            Write-Host "  A safety backup of the state before this update is kept as: $backupId"
            Exit-UpdateLock
            if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
            exit 1
        }

        # --- start ----------------------------------------------------------
        Write-Step "[6/9] Starting version $($release.version)..."
        Invoke-Compose @("up", "-d") 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { & $rollback "Version $($release.version) could not be started." }
        Save-Transaction "VERIFYING"

        Write-Step "[7/9] Waiting for the system to come back..."
        if (-not (Wait-ForEndpoint "$(Get-AppBaseUrl)/health/live" 90))  { & $rollback "Version $($release.version) never finished starting." }
        if (-not (Wait-ForEndpoint "$(Get-AppBaseUrl)/health/ready" 90)) { & $rollback "Version $($release.version) started but never became ready." }
        Write-Ok "The application is live and ready."

        Write-Step "[8/9] Verifying the installed version..."
        $info = Get-RunningSystemInfo
        if (-not $info) { & $rollback "The system did not report its version after the update." }
        if ($info.version -ne $release.version) { & $rollback "The system reports version $($info.version) after the update, not $($release.version)." }
        if ($info.schemaVersion -ne $release.schemaVersion) { & $rollback "The database schema reports $($info.schemaVersion) after the update, not $($release.schemaVersion)." }
        Write-Ok "Version $($release.version) and database schema $($release.schemaVersion) confirmed."

        Write-Step "[9/9] Verifying the video engine..."
        $workerHealthy = $false
        for ($i = 0; $i -lt 45; $i++) {
            $state = Get-ContainerHealth (Get-ContainerName "render-worker")
            if ($state -eq "healthy") { $workerHealthy = $true; break }
            if ($state -eq "missing") { & $rollback "The video engine is not running after the update." }
            Start-Sleep -Seconds 2
        }
        if (-not $workerHealthy) { & $rollback "The video engine did not become healthy after the update." }
        Write-Ok "Video engine healthy."

        Wait-ForContainerSettle

        # Local Voice is host-native and runs the *release directory's* copy of
        # services\local-tts, so a version update that only recreates app and
        # render-worker leaves it serving the old release's code until this
        # restarts it against the just-activated release directory. The model
        # cache and Python runtime are untouched (they live under shared\, not
        # under any release directory).
        Sync-LocalVoiceWithProductLifecycle "restart"

        $script:Txn.rollback = [ordered]@{ attempted = $false; result = "not_required" }
        Save-Transaction "SUCCESS"

        Write-Host ""
        Write-Host "=================================================================" -ForegroundColor Green
        Write-Host "  Short Studio Server updated to version $($release.version)" -ForegroundColor Green
        Write-Host "=================================================================" -ForegroundColor Green
        Show-HealthSummary | Out-Null
        Write-Host "  Previous version $currentVersion is kept for rollback."
        Write-Host "  Pre-update backup: $backupId"
        Write-Host ""
    } finally {
        Exit-UpdateLock
        Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($Pause) { Read-Host "  Press Enter to close" | Out-Null }
}

function Show-Usage {
    Write-Host @"
Short Studio Server

  short-studio.ps1 status                     Show system health and the installed version
  short-studio.ps1 update                     Install the latest stable version, safely
  short-studio.ps1 update -Check              Report whether an update is available
  short-studio.ps1 update -TargetVersion X.Y.Z  Install a specific published version
  short-studio.ps1 backup                     Create a database and configuration backup
  short-studio.ps1 diagnostics                Write a support bundle
  short-studio.ps1 doctor                     PASS/WARN/FAIL health report for support
  short-studio.ps1 logs [app|worker|postgres|n8n|local-voice]  Show recent logs (all, if none named)
  short-studio.ps1 start | stop | restart
  short-studio.ps1 rollback                   Return to the previous working version
  short-studio.ps1 owner reset-password       Recover a lost owner username/password locally
  short-studio.ps1 local-voice install [-LocalVoiceMode AUTO|HIGH_QUALITY|LIGHTWEIGHT|SKIP]
  short-studio.ps1 local-voice start | stop | restart | repair | uninstall | status

Backups, videos, media and settings are never removed by any of these commands.
"@
}

switch ($Command) {
    "status"      { Invoke-Status }
    "update"      { Invoke-Update }
    "backup"      { Invoke-Backup }
    "diagnostics" { Invoke-Diagnostics }
    "doctor"      { Invoke-Doctor }
    "logs"        { Invoke-Logs $SubCommand }
    "start"       { Invoke-Start }
    "stop"        { Invoke-Stop }
    "restart"     { Invoke-Restart }
    "rollback"    { Invoke-Rollback }
    "owner"       { Invoke-OwnerCommand $SubCommand }
    "local-voice" { Invoke-LocalVoiceCommand $SubCommand }
    default       { Show-Usage }
}
