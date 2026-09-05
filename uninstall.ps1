# ==============================================================================
# Short Studio Server - Safe Uninstaller (Windows)
# ==============================================================================
# The default removes the running software and leaves every byte the customer
# produced exactly where it is. Destroying data requires an explicit switch and
# a typed confirmation.
# ==============================================================================

[CmdletBinding()]
param(
    [string]$InstallRoot = "",
    [string]$ComposeProject = "",
    [switch]$RemoveData
)

$ErrorActionPreference = "Stop"

function Write-TextFile {
    param([string]$Path, [string]$Content)
    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

$LegacyAbudRoot = Join-Path $env:ProgramData "AbudShorts"
$FreshShortStudioRoot = Join-Path $env:ProgramData "ShortStudio"
if (-not $InstallRoot) {
    if (Test-Path (Join-Path $LegacyAbudRoot "shared\config\.env")) {
        $InstallRoot = $LegacyAbudRoot
    } else {
        $InstallRoot = $FreshShortStudioRoot
    }
}
$IsLegacyAbudInstall = ($InstallRoot -eq $LegacyAbudRoot) -and (Test-Path (Join-Path $InstallRoot "shared\config\.env"))
$AbudShared      = Join-Path $InstallRoot "shared"
$AbudDataDir     = Join-Path $AbudShared "data"
$AbudEnvFile     = Join-Path $AbudShared "config\.env"
$AbudCurrentFile = Join-Path $InstallRoot "current.txt"

if (-not $ComposeProject) {
    $existingPrefixLine = if (Test-Path $AbudEnvFile) {
        Get-Content $AbudEnvFile | Where-Object { $_ -match "^(SHORT_STUDIO_CONTAINER_PREFIX|ABUD_CONTAINER_PREFIX)=" } | Select-Object -Last 1
    } else { $null }
    if ($existingPrefixLine) {
        $ComposeProject = $existingPrefixLine.Substring($existingPrefixLine.IndexOf("=") + 1)
    } else {
        $ComposeProject = if ($IsLegacyAbudInstall) { "abud-shorts" } else { "short-studio" }
    }
}
# The real, already-existing volume/network names on a legacy installation are
# project-prefixed - see the identical note in install.ps1. A fresh Short
# Studio install pins an explicit `name:` in docker-compose.prod.yml instead,
# so its real names are the bare short-studio-*-data / short-studio-v2.
$PostgresVolumeName = if ($IsLegacyAbudInstall) { "${ComposeProject}_abud-shorts-postgres-data" } else { "short-studio-postgres-data" }

# Local Voice is host-native, so it is never removed by `docker compose down`
# below - it has to be stopped explicitly, always, or an uninstall (even the
# non-destructive default) leaves an orphaned python process and a scheduled
# task that keeps relaunching it after every future login.
$localVoiceLibPath = if (Test-Path $AbudCurrentFile) {
    Join-Path (Join-Path (Get-Content $AbudCurrentFile -Raw).Trim() "scripts\host") "local-voice-lib.ps1"
} else { Join-Path $PSScriptRoot "scripts\host\local-voice-lib.ps1" }
if (Test-Path $localVoiceLibPath) {
    . $localVoiceLibPath
    try {
        $lvPaths = Get-LocalVoicePaths -AbudShared $AbudShared -AbudDataDir $AbudDataDir -Port 8765
        Stop-LocalVoiceService -Paths $lvPaths | Out-Null
        Unregister-LocalVoiceAutoStart -AbudShared $AbudShared | Out-Null
    } catch { }
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Short Studio Server - Uninstaller" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$composeFile = ""
if (Test-Path $AbudCurrentFile) {
    $composeFile = Join-Path (Get-Content $AbudCurrentFile -Raw).Trim() "docker-compose.prod.yml"
}
# Fall back to the in-place layout used by a developer checkout.
if (-not (Test-Path $composeFile)) {
    foreach ($candidate in @("docker-compose.prod.yml", "docker-compose.v2.yml")) {
        if (Test-Path $candidate) { $composeFile = (Resolve-Path $candidate).Path; break }
    }
}

function Invoke-ComposeDown([string[]]$ExtraArgs) {
    if (-not (Test-Path $composeFile)) {
        & docker compose --project-name $ComposeProject down @ExtraArgs 2>$null | Out-Null
        return
    }
    $env:SHORT_STUDIO_DATA_DIR = $AbudDataDir
    $env:ABUD_DATA_DIR = $AbudDataDir
    $env:SHORT_STUDIO_RELEASE_DIR = (Split-Path $composeFile)
    $env:ABUD_RELEASE_DIR = (Split-Path $composeFile)
    if ($IsLegacyAbudInstall) {
        $env:ABUD_POSTGRES_VOLUME = $PostgresVolumeName
        $env:ABUD_N8N_VOLUME = "${ComposeProject}_abud-shorts-n8n-data"
        $env:ABUD_NETWORK = "${ComposeProject}_abud-shorts-v2"
    }
    $composeArgs = @("compose", "--project-name", $ComposeProject)
    if (Test-Path $AbudEnvFile) { $composeArgs += @("--env-file", $AbudEnvFile) }
    $composeArgs += @("--file", $composeFile, "down") + $ExtraArgs
    & docker @composeArgs 2>$null | Out-Null
}

Write-Host "[1/2] Stopping and removing the application containers..." -ForegroundColor Yellow
Invoke-ComposeDown @()
Write-Host "      Containers removed." -ForegroundColor Green

if (-not $RemoveData) {
    Write-Host "[2/2] Keeping your data." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  PRESERVED:" -ForegroundColor Green
    Write-Host "    Videos, uploads and media   $AbudDataDir"
    Write-Host "    Database                    Docker volume $PostgresVolumeName"
    Write-Host "    Backups                     $(Join-Path $AbudShared 'backups')"
    Write-Host "    Configuration and secrets   $(Join-Path $AbudShared 'config')"
    Write-Host "    Local Voice model + runtime  $(Join-Path $AbudShared 'runtime') , $(Join-Path $AbudDataDir 'models')"
    Write-Host ""
    Write-Host "  Local Voice was stopped and no longer starts automatically at login."
    Write-Host "  Reinstalling over this directory picks everything up again."
    Write-Host "  To erase all of it permanently: .\uninstall.ps1 -RemoveData"
    Write-Host "=================================================================" -ForegroundColor Cyan
    exit 0
}

Write-Host ""
Write-Host "  WARNING - DESTRUCTIVE" -ForegroundColor Red
Write-Host "  This permanently deletes every video, upload, brand, publication record," -ForegroundColor Red
Write-Host "  backup and setting on this machine. It cannot be undone." -ForegroundColor Red
Write-Host ""
$reply = Read-Host "  Type DELETE to confirm"
if ($reply -ne "DELETE") {
    Write-Host "  Cancelled. Nothing was removed." -ForegroundColor Green
    exit 1
}

Write-Host "[2/2] Removing all data..." -ForegroundColor Yellow
Invoke-ComposeDown @("-v")
if (Test-Path $AbudShared) { Remove-Item $AbudShared -Recurse -Force }
foreach ($groupName in @("Short Studio", "ABUD Shorts")) {
    $startMenu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\$groupName"
    if (Test-Path $startMenu) { Remove-Item $startMenu -Recurse -Force -ErrorAction SilentlyContinue }
}
Write-Host "      All data removed." -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
