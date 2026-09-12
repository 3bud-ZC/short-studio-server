# ==============================================================================
# Short Studio Server - Client Installer (Windows)
# ==============================================================================
# Right-click install.ps1 -> Run with PowerShell, or:
#
#   .\install.ps1
#   .\install.ps1 -Port 3131
#   .\install.ps1 -PublicUrl https://shorts.example.com
#
# What a fresh install produces:
#
#   %ProgramData%\ShortStudio\
#     current.txt                 the release directory in use
#     releases\<version>\         this release, and every earlier one
#     shared\                     EVERYTHING THE CUSTOMER OWNS
#       data\ config\ backups\ logs\ state\ installation.json
#
# Re-running this installer over a machine that already has an ABUD Shorts
# Engine 2.4 installation (%ProgramData%\AbudShorts\) is an upgrade, not a
# fresh install: it keeps operating out of that same existing root instead of
# creating a new ShortStudio\ one, so the owner account, jobs, videos,
# Provider Vault and backups are never orphaned. See the detection below.
#
# Updating replaces a release directory. It never writes inside shared\, which
# is why videos, uploads, brands, settings and backups survive every update.
# ==============================================================================

[CmdletBinding()]
param(
    [int]$Port = 3130,
    [string]$PublicUrl = "",
    [string]$InstallRoot = "",
    [string]$Image = "",
    [switch]$BehindProxy,
    # Used by the isolated rehearsal harness so a test installation cannot
    # collide with a real one on the same machine. Left empty, it is resolved
    # below to "abud-shorts" over a detected ABUD 2.4 install, or
    # "short-studio" for a fresh one.
    [string]$ComposeProject = "",
    [switch]$NoShortcuts,
    [switch]$NoBrowser,
    # AUTO detects hardware and picks the best supported Local Voice option.
    # HIGH_QUALITY/LIGHTWEIGHT force VoiceTut/KemeTone respectively; SKIP
    # installs the product without any local Arabic voice (the app then
    # truthfully reports Local Voice setup is required - it never silently
    # falls back to a paid provider).
    [ValidateSet("AUTO", "HIGH_QUALITY", "LIGHTWEIGHT", "SKIP")]
    [string]$LocalVoice = "AUTO"
)

$ErrorActionPreference = "Stop"
$PackageDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$LegacyAbudRoot = Join-Path $env:ProgramData "AbudShorts"
$FreshShortStudioRoot = Join-Path $env:ProgramData "ShortStudio"
if (-not $InstallRoot) {
    if (Test-Path (Join-Path $LegacyAbudRoot "shared\config\.env")) {
        # An ABUD Shorts Engine 2.4 installation already lives here. Moving its
        # data to a new root would itself be a risky migration this installer
        # does not perform - the safe move is to keep operating where the real
        # data already is.
        $InstallRoot = $LegacyAbudRoot
    } else {
        $InstallRoot = $FreshShortStudioRoot
    }
}
$ExistingEnvFile = Join-Path $InstallRoot "shared\config\.env"
$IsLegacyAbudInstall = (($InstallRoot -eq $LegacyAbudRoot) -and (Test-Path $ExistingEnvFile))
if (-not $IsLegacyAbudInstall -and $InstallRoot -and (Test-Path $ExistingEnvFile)) {
    $legacyEnvLine = Get-Content $ExistingEnvFile | Where-Object { $_ -match "^ABUD_CONTAINER_PREFIX=" } | Select-Object -Last 1
    $IsLegacyAbudInstall = [bool]$legacyEnvLine
}
$AbudShared      = Join-Path $InstallRoot "shared"
$AbudReleases    = Join-Path $InstallRoot "releases"
$AbudCurrentFile = Join-Path $InstallRoot "current.txt"
$AbudDataDir     = Join-Path $AbudShared "data"
$AbudConfigDir   = Join-Path $AbudShared "config"
$AbudEnvFile     = Join-Path $AbudConfigDir ".env"

if (-not $ComposeProject) {
    if ($IsLegacyAbudInstall) {
        $existingPrefixLine = if (Test-Path $AbudEnvFile) { Get-Content $AbudEnvFile | Where-Object { $_ -match "^ABUD_CONTAINER_PREFIX=" } | Select-Object -Last 1 } else { $null }
        $ComposeProject = if ($existingPrefixLine) { $existingPrefixLine.Substring("ABUD_CONTAINER_PREFIX=".Length) } else { "abud-shorts" }
    } else {
        $ComposeProject = "short-studio"
    }
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Short Studio Server - Installer" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

function Fail([string]$Message) {
    Write-Host ""
    Write-Host "  $Message" -ForegroundColor Red
    Write-Host ""
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

<#
Runs docker and returns its exit code in $LASTEXITCODE.

Windows PowerShell wraps anything a native program writes to stderr in an
ErrorRecord, and with $ErrorActionPreference = 'Stop' that aborts the script.
Docker writes all of its normal progress - "Pulling", "Waiting", layer
progress - to stderr, so without this every successful image pull would kill
the installer partway through. The exit code is the only thing that actually
says whether docker succeeded, and each caller checks it.
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

# The Local Voice lifecycle (hardware detection, runtime/model install, the
# host-native service, auto-start) is one implementation shared with
# scripts\host\abud-shorts.ps1's `local-voice` command - see
# scripts\host\local-voice-lib.ps1. Write-TextFile above is defined before
# this dot-source, which is the contract that file documents.
. (Join-Path $PackageDir "scripts\host\local-voice-lib.ps1")

# ---------------------------------------------------------------------------
# 1. Docker
# ---------------------------------------------------------------------------
Write-Host "[1/10] Checking Docker..." -ForegroundColor Yellow
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/ and run this installer again."
}
Invoke-Docker @("info") | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fail "Docker Desktop is not running. Start it, wait for the whale icon to settle, then run this installer again."
}
Invoke-Docker @("compose", "version") | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "The Docker Compose plugin is missing from this Docker Desktop installation." }
Write-Host "      Docker is running." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. Disk
# ---------------------------------------------------------------------------
Write-Host "[2/10] Checking disk space..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$driveLetter = (Split-Path -Qualifier $InstallRoot).TrimEnd(":")
$freeGb = [math]::Round((Get-PSDrive -Name $driveLetter).Free / 1GB, 1)
if ($freeGb -lt 15) { Fail "$freeGb GB free. Short Studio needs at least 15 GB to install." }
Write-Host "      $freeGb GB available." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. Address
# ---------------------------------------------------------------------------
Write-Host "[3/10] Checking the address this installation will serve..." -ForegroundColor Yellow
$portBusy = $false
try {
    $probe = New-Object System.Net.Sockets.TcpClient
    $probe.Connect("127.0.0.1", $Port)
    $probe.Close()
    $portBusy = $true
} catch { $portBusy = $false }
if ($portBusy) {
    # The port being busy is only a problem if something ELSE has it. Re-running
    # the installer over an existing installation - to repair it, or to move it
    # to a newer package - is a legitimate action, and it must not be refused
    # just because that installation is currently running. Matches both brands
    # so an ABUD Shorts Engine 2.4 install in the middle of this same upgrade
    # run is still recognized as "ours".
    $ownedByUs = $false
    try {
        $probe = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v2/system/info" -TimeoutSec 5 -ErrorAction Stop
        $ownedByUs = ($probe.name -like "Short Studio*") -or ($probe.name -like "ABUD Shorts Engine*")
    } catch { $ownedByUs = $false }

    if ($ownedByUs) {
        Write-Host "      Port $Port is serving an existing installation; reinstalling over it." -ForegroundColor Yellow
        Write-Host "      Your videos, settings and backups are not touched."
    } else {
        Fail "Port $Port is already in use by another program on this machine. Choose another one: .\install.ps1 -Port 3131"
    }
}

$TrustedProxyValue = ""
if ($BehindProxy) { $TrustedProxyValue = "1" }
if (-not $PublicUrl) {
    $PublicUrl = "http://localhost:$Port"
    Write-Host "      Local installation: $PublicUrl" -ForegroundColor Green
    Write-Host "      For a server with a domain, rerun with: -PublicUrl https://shorts.example.com"
} else {
    if ($PublicUrl -notmatch '^https?://') { Fail "-PublicUrl must start with http:// or https://" }
    $PublicUrl = $PublicUrl.TrimEnd("/")
    Write-Host "      Public address: $PublicUrl" -ForegroundColor Green
    if (-not $BehindProxy) {
        Write-Host "      Forwarded proxy headers will stay ignored. Add -BehindProxy only when a trusted reverse proxy is in front." -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# 4. Release identity
# ---------------------------------------------------------------------------
Write-Host "[4/10] Reading this release..." -ForegroundColor Yellow
$releaseJsonPath = Join-Path $PackageDir "release.json"
if (-not (Test-Path $releaseJsonPath)) {
    Fail "release.json is missing. This does not look like a Short Studio Server client package."
}
$releaseInfo = Get-Content $releaseJsonPath -Raw | ConvertFrom-Json
$ReleaseVersion = $releaseInfo.version
$ReleaseImage   = if ($Image) { $Image } else { $releaseInfo.image }
$ReleaseDigest  = $releaseInfo.imageDigest
$ReleaseChannel = if ($releaseInfo.channel) { $releaseInfo.channel } else { "stable" }
if (-not $ReleaseVersion) { Fail "This package does not declare a version." }
Write-Host "      Version $ReleaseVersion ($ReleaseChannel)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 5. The application image: offline archive first, otherwise pull
# ---------------------------------------------------------------------------
Write-Host "[5/10] Preparing the application..." -ForegroundColor Yellow
$offlineArchive = $null
$imagesDir = Join-Path $PackageDir "images"
if (Test-Path $imagesDir) {
    $offlineArchive = Get-ChildItem $imagesDir -Filter "*.tar*" -ErrorAction SilentlyContinue | Select-Object -First 1
}
$imageAlreadyLocal = $false
if ($ReleaseImage) {
    Invoke-Docker @("image", "inspect", $ReleaseImage) | Out-Null
    $imageAlreadyLocal = ($LASTEXITCODE -eq 0)
}

if ($offlineArchive) {
    Write-Host "      Offline package: loading the bundled image (this takes a few minutes)..."
    Invoke-Docker @("load", "-i", $offlineArchive.FullName) | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "The bundled application image could not be loaded." }
    Write-Host "      Image loaded from the package." -ForegroundColor Green
} elseif ($imageAlreadyLocal) {
    # Already present locally - the case an offline reinstall and the isolated
    # F4 rehearsal both hit. No download needed.
    Write-Host "      The application image is already on this machine." -ForegroundColor Green
} else {
    # Pull by digest when the package publishes one: a tag can be moved, a
    # digest cannot, so this is what makes the installed version reproducible.
    $pullRef = $ReleaseImage
    if ($ReleaseDigest -and $ReleaseDigest -ne "null") {
        $pullRef = "$(($ReleaseImage -split ':')[0])@$ReleaseDigest"
    }
    Write-Host "      Downloading the application (this takes a few minutes)..."
    Invoke-Docker @("pull", $pullRef) | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Fail "The application image could not be downloaded. Check this machine's internet connection and try again."
    }
    $ReleaseImage = $pullRef
    Write-Host "      Application downloaded." -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 6. Persistent layout
# ---------------------------------------------------------------------------
Write-Host "[6/10] Creating the installation..." -ForegroundColor Yellow
foreach ($dir in @("videos", "thumbnails", "uploads", "cache", "models", "backups", "logs", "updates")) {
    New-Item -ItemType Directory -Path (Join-Path $AbudDataDir $dir) -Force | Out-Null
}
foreach ($dir in @($AbudConfigDir, (Join-Path $AbudShared "backups"), (Join-Path $AbudShared "logs"), (Join-Path $AbudShared "state"), $AbudReleases)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$ReleaseDir = Join-Path $AbudReleases $ReleaseVersion

# Local Voice is host-native and can hold its process working directory
# inside a release's services\local-tts, which blocks Windows from replacing
# that directory below - the exact case of repairing/reinstalling the same
# version while Local Voice is already running. Stop it first; Local Voice
# setup later in this script (or the next `local-voice start`) always starts
# it again against whichever release ends up current.
if (Test-Path $AbudEnvFile) {
    try {
        $existingPort = 8765
        $portLine = Get-Content $AbudEnvFile | Where-Object { $_ -match "^LOCAL_TTS_PORT=" } | Select-Object -Last 1
        if ($portLine) { $existingPort = [int]$portLine.Substring("LOCAL_TTS_PORT=".Length) }
        $stopPaths = Get-LocalVoicePaths -AbudShared $AbudShared -AbudDataDir $AbudDataDir -Port $existingPort
        Stop-LocalVoiceService -Paths $stopPaths | Out-Null
    } catch { }
}

if (Test-Path "$ReleaseDir.incoming") { Remove-Item "$ReleaseDir.incoming" -Recurse -Force }
New-Item -ItemType Directory -Path "$ReleaseDir.incoming" -Force | Out-Null
# The image archive is not copied into the release directory: it is many
# gigabytes and Docker already holds it.
Get-ChildItem $PackageDir -Exclude "images" | Copy-Item -Destination "$ReleaseDir.incoming" -Recurse -Force
if (Test-Path $ReleaseDir) { Remove-Item $ReleaseDir -Recurse -Force }
Move-Item "$ReleaseDir.incoming" $ReleaseDir
Write-Host "      Installed to $ReleaseDir" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 7. Configuration and secrets
# ---------------------------------------------------------------------------
Write-Host "[7/10] Configuring..." -ForegroundColor Yellow
function New-SecretHex([int]$Bytes) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buffer = New-Object byte[] $Bytes
    $rng.GetBytes($buffer)
    return [System.BitConverter]::ToString($buffer).Replace("-", "").ToLower()
}

function Update-EnvLine([string[]]$Lines, [string]$Key, [string]$Value) {
    $found = $false
    $out = foreach ($line in $Lines) {
        if ($line -match "^$([regex]::Escape($Key))=") { $found = $true; "$Key=$Value" } else { $line }
    }
    if (-not $found) { $out = @($out) + "$Key=$Value" }
    return $out
}
function Test-EnvKeyPresent([string[]]$Lines, [string]$Key) {
    return [bool]($Lines | Where-Object { $_ -match "^$([regex]::Escape($Key))=" })
}

function Get-DeviceFingerprintMaterial {
    $parts = @()
    try {
        $guid = (Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Cryptography" -Name MachineGuid -ErrorAction Stop).MachineGuid
        if ($guid) { $parts += "win_guid:$guid" }
    } catch { }
    try {
        $uuid = (Get-CimInstance Win32_ComputerSystemProduct -ErrorAction Stop).UUID
        if ($uuid) { $parts += "system_uuid:$uuid" }
    } catch { }
    try {
        $cpu = (Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1).ProcessorId
        if ($cpu) { $parts += "cpu:$cpu" }
    } catch { }
    $raw = if ($parts.Count -gt 0) { $parts -join "|" } else { "$env:COMPUTERNAME|$env:USERNAME" }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($raw)
    $hash = (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "").ToUpperInvariant()
    return "SS-$($hash.Substring(0,4))-$($hash.Substring(4,4))-$($hash.Substring(8,4))-$($hash.Substring(12,4))"
}

$HostDeviceFingerprint = Get-DeviceFingerprintMaterial

if (-not (Test-Path $AbudEnvFile)) {
    # Never reached for an upgrade: $IsLegacyAbudInstall guarantees this file
    # already exists whenever a real ABUD Shorts Engine 2.4 install is present.
    # This is always a genuinely fresh installation.
    $pgPass = "short_studio_pg_" + (New-SecretHex 16)
    $envContent = @"
# Short Studio Server - installation configuration
# Generated by the installer. Every secret below is unique to this machine;
# there is no shared or default password anywhere in the product.

HOST_PORT=$Port
V2_PUBLIC_URL=$PublicUrl
TRUSTED_PROXY=$TrustedProxyValue
SHORT_STUDIO_ACCESS_MODE=local
SHORT_STUDIO_PUBLIC_BIND_HOST=127.0.0.1

SHORT_STUDIO_IMAGE=$ReleaseImage
SHORT_STUDIO_RELEASE_CHANNEL=$ReleaseChannel
SHORT_STUDIO_HOST_PLATFORM=windows
SHORT_STUDIO_INSTALL_TYPE=docker_windows
SHORT_STUDIO_COMPOSE_PROJECT=$ComposeProject
SHORT_STUDIO_CONTAINER_PREFIX=$ComposeProject
SHORT_STUDIO_POSTGRES_VOLUME=$ComposeProject-postgres-data
SHORT_STUDIO_N8N_VOLUME=$ComposeProject-n8n-data
SHORT_STUDIO_NETWORK=$ComposeProject-v2

NODE_ENV=production
V2_ENABLED=true
LOG_LEVEL=info
GENERIC_TIMEZONE=Africa/Cairo
WHISPER_MODEL=small
KOKORO_MODEL_PRECISION=q4
ABUD_HOST_DEVICE_FINGERPRINT=$HostDeviceFingerprint

POSTGRES_DB=short_studio
POSTGRES_USER=short_studio
POSTGRES_PASSWORD=$pgPass

INTERNAL_SERVICE_TOKEN=short_studio_sec_$(New-SecretHex 32)
N8N_ENCRYPTION_KEY=$(New-SecretHex 16)
SESSION_SECRET=$(New-SecretHex 32)
PROVIDER_VAULT_MASTER_KEY=$(New-SecretHex 32)
WEBHOOK_SIGNING_SECRET=whsec_$(New-SecretHex 24)

# Arabic narration defaults to Local Voice (VoiceTut/KemeTone, set up below).
# ElevenLabs is an optional premium alternative, configured from the app:
# Providers -> ElevenLabs -> Configure. The key is held encrypted in the
# provider vault, so editing this file is not required.
ELEVENLABS_API_KEY=
ELEVENLABS_DEFAULT_VOICE_ID=
PEXELS_API_KEY=
"@
    Write-TextFile $AbudEnvFile $envContent
    Write-Host "      Generated a unique configuration with fresh secrets." -ForegroundColor Green
} else {
    # An existing installation keeps its secrets and its data. Only the version
    # pointers move - and, for an install upgraded from ABUD Shorts Engine 2.4,
    # the compose identity variables that keep it attached to its real,
    # already-running containers and volumes instead of creating empty new ones.
    $lines = Get-Content $AbudEnvFile
    $usesLegacyKeys = Test-EnvKeyPresent $lines "ABUD_CONTAINER_PREFIX"
    if ($usesLegacyKeys) {
        $lines = Update-EnvLine $lines "ABUD_IMAGE" $ReleaseImage
        $lines = Update-EnvLine $lines "ABUD_RELEASE_CHANNEL" $ReleaseChannel
        $lines = Update-EnvLine $lines "ABUD_COMPOSE_PROJECT" $ComposeProject
        $lines = Update-EnvLine $lines "ABUD_CONTAINER_PREFIX" $ComposeProject
        # The pre-2.5 compose file never set an explicit external `name:` on
        # these, so Docker Compose applied its own default: "<project>_<key>".
        # The real, already-existing volumes/network are therefore prefixed by
        # this installation's actual compose project name (normally
        # "abud-shorts", but whatever -ComposeProject it was originally
        # installed with if that was customized) - NOT the bare key. The 2.5
        # compose sets an explicit `name:`, so an upgrade must pin the real
        # existing name here itself, once, the first time it sees this legacy
        # .env. Getting the prefix wrong here is the one mistake that would
        # silently create empty replacement volumes instead of reattaching.
        if (-not (Test-EnvKeyPresent $lines "ABUD_POSTGRES_VOLUME")) {
            $lines = Update-EnvLine $lines "ABUD_POSTGRES_VOLUME" "${ComposeProject}_abud-shorts-postgres-data"
        }
        if (-not (Test-EnvKeyPresent $lines "ABUD_N8N_VOLUME")) {
            $lines = Update-EnvLine $lines "ABUD_N8N_VOLUME" "${ComposeProject}_abud-shorts-n8n-data"
        }
        if (-not (Test-EnvKeyPresent $lines "ABUD_NETWORK")) {
            $lines = Update-EnvLine $lines "ABUD_NETWORK" "${ComposeProject}_abud-shorts-v2"
        }
    } else {
        $lines = Update-EnvLine $lines "SHORT_STUDIO_IMAGE" $ReleaseImage
        $lines = Update-EnvLine $lines "SHORT_STUDIO_RELEASE_CHANNEL" $ReleaseChannel
        $lines = Update-EnvLine $lines "SHORT_STUDIO_COMPOSE_PROJECT" $ComposeProject
        $lines = Update-EnvLine $lines "SHORT_STUDIO_CONTAINER_PREFIX" $ComposeProject
        if (-not (Test-EnvKeyPresent $lines "SHORT_STUDIO_POSTGRES_VOLUME")) {
            $lines = Update-EnvLine $lines "SHORT_STUDIO_POSTGRES_VOLUME" "$ComposeProject-postgres-data"
        }
        if (-not (Test-EnvKeyPresent $lines "SHORT_STUDIO_N8N_VOLUME")) {
            $lines = Update-EnvLine $lines "SHORT_STUDIO_N8N_VOLUME" "$ComposeProject-n8n-data"
        }
        if (-not (Test-EnvKeyPresent $lines "SHORT_STUDIO_NETWORK")) {
            $lines = Update-EnvLine $lines "SHORT_STUDIO_NETWORK" "$ComposeProject-v2"
        }
    }
    if (-not (Test-EnvKeyPresent $lines "SHORT_STUDIO_ACCESS_MODE")) {
        $lines = Update-EnvLine $lines "SHORT_STUDIO_ACCESS_MODE" "local"
    }
    if (-not (Test-EnvKeyPresent $lines "SHORT_STUDIO_PUBLIC_BIND_HOST")) {
        $lines = Update-EnvLine $lines "SHORT_STUDIO_PUBLIC_BIND_HOST" "127.0.0.1"
    }
    $lines = Update-EnvLine $lines "ABUD_HOST_DEVICE_FINGERPRINT" $HostDeviceFingerprint
    Write-TextFile $AbudEnvFile (($lines -join "`r`n") + "`r`n")
    Write-Host "      Existing configuration kept; secrets and data untouched." -ForegroundColor Green
}

$installationJsonPath = Join-Path $AbudShared "installation.json"
$priorInstallation = $null
if (Test-Path $installationJsonPath) {
    try { $priorInstallation = Get-Content $installationJsonPath -Raw | ConvertFrom-Json } catch { $priorInstallation = $null }
}
# Only true the very first time a 2.5+ installer runs over a real ABUD Shorts
# Engine 2.4 installation - a truthful one-time migration record, not shown
# again once installation.json itself already says Short Studio Server.
$migratedFromAbud = $IsLegacyAbudInstall -and $priorInstallation -and ($priorInstallation.product -eq "ABUD Shorts Engine")
$installationRecord = [ordered]@{
    product         = "Short Studio Server"
    previousProduct = $(if ($migratedFromAbud) { "ABUD Shorts Engine $($priorInstallation.currentVersion)" } else { $(if ($priorInstallation) { $priorInstallation.previousProduct } else { $null }) })
    currentVersion  = $ReleaseVersion
    previousVersion = $(if ($priorInstallation) { $priorInstallation.currentVersion } else { $null })
    image           = $ReleaseImage
    channel         = $ReleaseChannel
    publicUrl       = $PublicUrl
    installRoot     = $InstallRoot
    updatedAt       = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
}

# ---------------------------------------------------------------------------
# 8. Local Voice (Egyptian Arabic) - hardware detection, runtime/model
#    install, host-native service, auto-start. A customer never runs
#    scripts\install-local-voice.ps1 themselves; this is the one place that
#    does, via the shared lifecycle in scripts\host\local-voice-lib.ps1.
# ---------------------------------------------------------------------------
Write-Host "[8/10] Setting up Local Voice ($LocalVoice)..." -ForegroundColor Yellow
if ($LocalVoice -eq "SKIP") {
    Write-Host "      Skipped by request. Arabic jobs will report Local Voice setup is required" -ForegroundColor Yellow
    Write-Host "      until it is installed later (Local Voice command, or the app's Providers page)."
} else {
    try {
        $localVoiceAppSource = Join-Path $ReleaseDir "services\local-tts"
        $tokenLine = Get-Content $AbudEnvFile | Where-Object { $_ -match "^INTERNAL_SERVICE_TOKEN=" } | Select-Object -Last 1
        $internalToken = if ($tokenLine) { $tokenLine.Substring("INTERNAL_SERVICE_TOKEN=".Length) } else { "" }

        $localVoiceResult = Invoke-LocalVoiceSetup -Mode $LocalVoice -AbudShared $AbudShared -AbudDataDir $AbudDataDir `
            -AppSourceDir $localVoiceAppSource -LibRoot (Join-Path $ReleaseDir "scripts\host") `
            -InternalServiceToken $internalToken

        function Update-EnvLineInstaller([string[]]$Lines, [string]$Key, [string]$Value) {
            $found = $false
            $out = foreach ($line in $Lines) {
                if ($line -match "^$([regex]::Escape($Key))=") { $found = $true; "$Key=$Value" } else { $line }
            }
            if (-not $found) { $out = @($out) + "$Key=$Value" }
            return $out
        }
        $envLines = Get-Content $AbudEnvFile
        $envLines = Update-EnvLineInstaller $envLines "LOCAL_VOICE_MODE" $localVoiceResult.resolvedMode
        if ($localVoiceResult.port) { $envLines = Update-EnvLineInstaller $envLines "LOCAL_TTS_PORT" "$($localVoiceResult.port)" }
        if ($localVoiceResult.baseUrl) { $envLines = Update-EnvLineInstaller $envLines "LOCAL_TTS_BASE_URL" $localVoiceResult.baseUrl }
        Write-TextFile $AbudEnvFile (($envLines -join "`r`n") + "`r`n")

        if ($localVoiceResult.error) {
            Write-Host "      Local High Quality setup failed: $($localVoiceResult.error)" -ForegroundColor Yellow
            Write-Host "      The rest of Short Studio will still install and start normally." -ForegroundColor Yellow
            Write-Host "      Retry from the Start Menu: Short Studio Doctor, or the Repair Local Voice shortcut." -ForegroundColor Yellow
            Write-Host "      ElevenLabs is not used automatically; Arabic jobs will report setup is required until this is fixed."
        } elseif ($localVoiceResult.resolvedMode -eq "SKIP") {
            Write-Host "      $($localVoiceResult.resolutionReason)" -ForegroundColor Yellow
        } else {
            Write-Host "      Mode: $($localVoiceResult.resolvedMode) ($($localVoiceResult.resolutionReason))" -ForegroundColor Green
            Write-Host "      Model: $($localVoiceResult.modelId), ready: $($localVoiceResult.modelReady)" -ForegroundColor Green
            Write-Host "      Service healthy: $($localVoiceResult.serviceStarted); starts automatically at login: $($localVoiceResult.autoStartRegistered) ($($localVoiceResult.autoStartMechanism))" -ForegroundColor Green
        }
    } catch {
        Write-Host "      Local High Quality setup failed: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "      The rest of Short Studio will still install and start normally." -ForegroundColor Yellow
        Write-Host "      Retry from the Start Menu: Short Studio - Repair Local Voice." -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# 9. Start
# ---------------------------------------------------------------------------
Write-Host "[9/10] Starting Short Studio Server..." -ForegroundColor Yellow
# Set both the new and legacy variable names directly - docker-compose.prod.yml
# resolves the same real values regardless of which tier of its fallback
# interpolation ends up matching, and an upgraded install's .env may only
# define the ABUD_* keys (see the config step above).
$env:SHORT_STUDIO_DATA_DIR = $AbudDataDir
$env:ABUD_DATA_DIR = $AbudDataDir
$env:SHORT_STUDIO_RELEASE_DIR = $ReleaseDir
$env:ABUD_RELEASE_DIR = $ReleaseDir
$env:SHORT_STUDIO_CONTAINER_PREFIX = $ComposeProject
$env:ABUD_CONTAINER_PREFIX = $ComposeProject
$env:ABUD_HOST_DEVICE_FINGERPRINT = $HostDeviceFingerprint
if (-not $IsLegacyAbudInstall) {
    $env:SHORT_STUDIO_POSTGRES_VOLUME = "$ComposeProject-postgres-data"
    $env:SHORT_STUDIO_N8N_VOLUME = "$ComposeProject-n8n-data"
    $env:SHORT_STUDIO_NETWORK = "$ComposeProject-v2"
}
if ($IsLegacyAbudInstall) {
    # Belt-and-suspenders alongside the .env write above: pins compose to the
    # real, already-existing volumes/network from the pre-2.5 compose file
    # (Docker Compose's own default "<project>_<key>" naming, since that file
    # never set an explicit `name:`).
    $env:ABUD_POSTGRES_VOLUME = "${ComposeProject}_abud-shorts-postgres-data"
    $env:ABUD_N8N_VOLUME = "${ComposeProject}_abud-shorts-n8n-data"
    $env:ABUD_NETWORK = "${ComposeProject}_abud-shorts-v2"
}
$composeFile = Join-Path $ReleaseDir "docker-compose.prod.yml"
Invoke-Docker @("compose", "--project-name", $ComposeProject, "--env-file", $AbudEnvFile, "--file", $composeFile, "up", "-d", "--remove-orphans")
if ($LASTEXITCODE -ne 0) { Fail "The system could not be started. Check that Docker Desktop has enough memory assigned." }
Write-TextFile $AbudCurrentFile $ReleaseDir
Write-TextFile $installationJsonPath ($installationRecord | ConvertTo-Json -Depth 6)

# Start Menu shortcuts, so the customer never types a Docker command.
if (-not $NoShortcuts) {
    $cliPath = Join-Path $ReleaseDir "scripts\host\short-studio.ps1"
    $startMenu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Short Studio"
    # An install upgraded from ABUD Shorts Engine 2.4 leaves its old shortcut
    # group behind under the previous name - remove it so the customer is not
    # left with two folders for one product.
    $legacyStartMenu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\ABUD Shorts"
    if (Test-Path $legacyStartMenu) {
        try { Remove-Item $legacyStartMenu -Recurse -Force } catch { }
    }
    try {
        New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
        $shell = New-Object -ComObject WScript.Shell
        $shortcuts = @(
            @{ Name = "Short Studio - Open";        Cmd = "start";       Desc = "Start Short Studio and open the dashboard" },
            @{ Name = "Short Studio - Update";      Cmd = "update";      Desc = "Install the latest version, safely" },
            @{ Name = "Short Studio - Backup";      Cmd = "backup";      Desc = "Create a backup now" },
            @{ Name = "Short Studio - Diagnostics"; Cmd = "diagnostics"; Desc = "Write a support bundle" },
            @{ Name = "Short Studio - Status";      Cmd = "status";      Desc = "Show system health and version" },
            @{ Name = "Short Studio - Repair Local Voice"; Cmd = "local-voice repair"; Desc = "Retry Local Voice (Arabic) setup" }
        )
        foreach ($entry in $shortcuts) {
            $link = $shell.CreateShortcut((Join-Path $startMenu "$($entry.Name).lnk"))
            $link.TargetPath = "powershell.exe"
            $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$cliPath`" $($entry.Cmd) -Pause"
            $link.WorkingDirectory = $ReleaseDir
            $link.Description = $entry.Desc
            $link.Save()
        }
        Write-Host "      Start Menu shortcuts created under 'Short Studio'." -ForegroundColor Green
    } catch {
        Write-Host "      Note: Start Menu shortcuts could not be created (run as administrator to add them)." -ForegroundColor Yellow
        Write-Host "      Run operations from: $cliPath"
    }
}

Write-Host "[10/10] Waiting for the system to become ready..." -ForegroundColor Yellow
$ready = $false
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health/ready" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop | Out-Null
        $ready = $true
        break
    } catch { Start-Sleep -Seconds 2 }
}

# ---------------------------------------------------------------------------
# Health summary
# ---------------------------------------------------------------------------
function Get-Health([string]$Name) {
    $state = Invoke-Docker @("inspect", "-f", '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', $Name)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($state)) { return "missing" }
    return $state.Trim()
}
function Friendly([string]$s) {
    switch ($s) {
        "healthy" { "Healthy" } "running" { "Healthy" } "starting" { "Starting" } default { "Problem" }
    }
}

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
if ($ready) {
    Write-Host "  Short Studio Server $ReleaseVersion is installed and running" -ForegroundColor Green
} else {
    Write-Host "  Short Studio Server $ReleaseVersion is installed" -ForegroundColor Green
}
if ($migratedFromAbud) {
    Write-Host "  Upgraded from ABUD Shorts Engine $($priorInstallation.currentVersion)" -ForegroundColor Green
}
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Short Studio:  $(if ($ready) { 'Healthy' } else { 'Still starting' })"
Write-Host "  Application:   $(Friendly (Get-Health "$ComposeProject-app"))"
Write-Host "  Video Engine:  $(Friendly (Get-Health "$ComposeProject-render-worker"))"
Write-Host "  Database:      $(Friendly (Get-Health "$ComposeProject-postgres"))"
Write-Host "  Automation:    $(Friendly (Get-Health "$ComposeProject-n8n"))"
$localVoiceModeReport = Get-Content $AbudEnvFile | Where-Object { $_ -match "^LOCAL_VOICE_MODE=" } | Select-Object -Last 1
$localVoiceModeReport = if ($localVoiceModeReport) { $localVoiceModeReport.Substring("LOCAL_VOICE_MODE=".Length) } else { "SKIP" }
Write-Host "  Local Voice:   $localVoiceModeReport$(if ($localVoiceModeReport -eq 'SKIP') { ' (Arabic jobs need setup - see the Repair Local Voice shortcut)' })"
Write-Host "  URL:           $PublicUrl"
Write-Host ""
Write-Host "  Next step - open this address and create your administrator account:" -ForegroundColor Yellow
Write-Host "      $PublicUrl/setup" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Day-to-day, use the Start Menu shortcuts under 'Short Studio':"
Write-Host "      Short Studio - Status, Update, Backup, Diagnostics, Repair Local Voice"
Write-Host ""
if (-not $ready) {
    Write-Host "  The system is taking longer than usual to start. Check it with the Status shortcut." -ForegroundColor Yellow
    Write-Host ""
}

# Leave the customer at the Setup Wizard rather than a terminal window - this is
# the one moment a double-click installer has to hand off to a browser tab.
if ($ready -and -not $NoBrowser) {
    try { Start-Process "$PublicUrl/setup" | Out-Null } catch { }
}
