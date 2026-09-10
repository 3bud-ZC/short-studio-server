# ==============================================================================
# Short Studio Server - Local Voice (VoiceTut / KemeTone) lifecycle library
# ==============================================================================
# One canonical implementation of the host-native Local Voice lifecycle, dot-
# sourced by both entry points so there is a single place that knows how to
# detect hardware, install the Python runtime, install a model, and run the
# service - install.ps1 (first-run setup) and scripts\host\short-studio.ps1
# (the `local-voice` command family: install/start/stop/restart/status/repair/
# uninstall).
#
# Every function takes its paths as parameters instead of reading globals,
# because the two callers use differently-scoped variables with the same
# names. Callers must define Write-TextFile (UTF-8, no BOM) before dot-
# sourcing this file - both entry points already do, for the same reason
# every other file in this product writes config through it: Windows
# PowerShell's own UTF-8 encoders emit a BOM that breaks JSON.parse and
# docker's .env parsing.
#
# VoiceTut is the accepted, human-reviewed local high-quality Egyptian Arabic
# route (see ABUD_SHORTS_ENGINE_STATUS.md Pass 9.7-9.9); KemeTone is the
# lightweight CPU fallback. Neither is a new model choice - this file only
# productizes the lifecycle around the already-accepted pair. ElevenLabs is
# never started, installed or called from here.
# ==============================================================================

$script:LocalVoicePinned = [ordered]@{
    PythonVersion      = "3.11"
    TorchVersion       = "2.5.1+cu121"
    TorchaudioVersion  = "2.5.1+cu121"
    VoicetutTtsVersion = "0.1.1"
    OmniVoiceSource    = "git+https://github.com/k2-fsa/OmniVoice.git"
    TorchIndexUrl      = "https://download.pytorch.org/whl/cu121"
}

$script:LocalVoiceHighQualityMinVramMb = 4096
$script:LocalVoiceHighQualityMinDiskGb = 10
$script:LocalVoiceLightweightMinDiskGb = 2
$script:LocalVoiceTaskName = "Short Studio - Local Voice"
# The scheduled task / Startup shortcut name used by every ABUD Shorts Engine
# 2.4 installation. Detection and cleanup below always check both names, so an
# upgraded install's existing registration is found (instead of reporting
# "not registered" next to one that is, in fact, already running) and never
# duplicated under the new name.
$script:LegacyLocalVoiceTaskName = "ABUD Shorts - Local Voice"

<#
Runs a native executable (py, python, pip, nvidia-smi, schtasks...) and
returns its stdout+stderr, with $LASTEXITCODE set to its real exit code.

Both install.ps1 and short-studio.ps1 set $ErrorActionPreference = "Stop"
before dot-sourcing this file. Under that preference, Windows PowerShell
wraps ANY text a native executable writes to stderr in an ErrorRecord and
throws - the `py` launcher's own "no matching runtime" message, or pip's
progress output, would otherwise abort the whole Local Voice setup as an
uncaught exception instead of the caller seeing a normal non-zero exit code.
This is the exact issue install.ps1's own Invoke-Docker already works around;
every native call in this file goes through here for the same reason.
#>
function Invoke-LocalVoiceNative {
    param(
        [Parameter(Mandatory = $true, Position = 0)][string]$Path,
        [Parameter(Position = 1)][string[]]$ArgumentList = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Path @ArgumentList 2>&1 | ForEach-Object { "$_" }
    } finally {
        $ErrorActionPreference = $previous
    }
}

# ---------------------------------------------------------------------------
# Hardware detection
# ---------------------------------------------------------------------------
<#
Truthful, best-effort hardware read. Never throws - a detection failure must
degrade to "unknown" (which Resolve-LocalVoiceMode treats conservatively),
never abort the installer that called it.
#>
function Get-LocalVoiceHardwareProfile {
    $cpuCount = [Environment]::ProcessorCount
    $ramTotalMb = $null
    try {
        $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
        $ramTotalMb = [math]::Round($cs.TotalPhysicalMemory / 1MB)
    } catch { }

    $gpuName = $null
    $cudaCapable = $false
    try {
        $gpus = Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop
        $nvidia = $gpus | Where-Object { $_.Name -match "NVIDIA" } | Select-Object -First 1
        if ($nvidia) { $gpuName = $nvidia.Name; $cudaCapable = $true }
    } catch { }

    $vramMb = $null
    $driverVersion = $null
    $nvidiaSmiPath = $null
    $cmd = Get-Command "nvidia-smi.exe" -ErrorAction SilentlyContinue
    if ($cmd) { $nvidiaSmiPath = $cmd.Source }
    elseif (Test-Path (Join-Path $env:SystemRoot "System32\nvidia-smi.exe")) {
        $nvidiaSmiPath = Join-Path $env:SystemRoot "System32\nvidia-smi.exe"
    }
    if ($nvidiaSmiPath -and $cudaCapable) {
        try {
            $csv = Invoke-LocalVoiceNative $nvidiaSmiPath @("--query-gpu=memory.total,driver_version", "--format=csv,noheader,nounits")
            if ($LASTEXITCODE -eq 0 -and $csv) {
                $first = @($csv)[0]
                $parts = $first -split ","
                if ($parts.Count -ge 2) {
                    $vramMb = [int]($parts[0].Trim())
                    $driverVersion = $parts[1].Trim()
                }
            }
        } catch { }
    }

    return [ordered]@{
        osVersion      = [System.Environment]::OSVersion.VersionString
        cpuCount       = $cpuCount
        ramTotalMb     = $ramTotalMb
        gpuName        = $gpuName
        cudaCapable    = $cudaCapable
        vramMb         = $vramMb
        driverVersion  = $driverVersion
        nvidiaSmiFound = [bool]$nvidiaSmiPath
    }
}

function Get-LocalVoiceDiskFreeGb {
    param([Parameter(Mandatory = $true)][string]$Path)
    try {
        $qualifier = (Split-Path -Qualifier $Path -ErrorAction Stop).TrimEnd(":")
        $drive = Get-PSDrive -Name $qualifier -ErrorAction Stop
        return [math]::Round($drive.Free / 1GB, 1)
    } catch {
        return 0
    }
}

<#
AUTO decision. Never recommends HIGH_QUALITY on unverified VRAM - a GPU whose
memory could not be read is treated the same as no GPU, because overstating
compatibility here means promising a multi-gigabyte download that then fails
partway through.
#>
function Resolve-LocalVoiceMode {
    param(
        [ValidateSet("AUTO", "HIGH_QUALITY", "LIGHTWEIGHT", "SKIP")]
        [string]$Requested = "AUTO",
        [Parameter(Mandatory = $true)]$Hardware,
        [Parameter(Mandatory = $true)][double]$DiskFreeGb
    )
    if ($Requested -eq "SKIP") {
        return [ordered]@{ mode = "SKIP"; reason = "Local Voice setup was explicitly skipped." }
    }
    if ($Requested -eq "HIGH_QUALITY" -or $Requested -eq "LIGHTWEIGHT") {
        return [ordered]@{ mode = $Requested; reason = "Explicitly requested." }
    }

    $vramVerifiedOk = ($null -ne $Hardware.vramMb) -and ($Hardware.vramMb -ge $script:LocalVoiceHighQualityMinVramMb)
    if ($Hardware.cudaCapable -and $vramVerifiedOk -and $DiskFreeGb -ge $script:LocalVoiceHighQualityMinDiskGb) {
        return [ordered]@{ mode = "HIGH_QUALITY"; reason = "Compatible NVIDIA GPU detected ($($Hardware.gpuName), $($Hardware.vramMb) MB VRAM)." }
    }
    if ($DiskFreeGb -ge $script:LocalVoiceLightweightMinDiskGb) {
        $why = if (-not $Hardware.cudaCapable) { "No NVIDIA GPU detected." }
        elseif (-not $vramVerifiedOk) { "GPU VRAM could not be verified." }
        else { "Not enough free disk space for the high-quality model." }
        return [ordered]@{ mode = "LIGHTWEIGHT"; reason = "$why Lightweight local voice is supported instead." }
    }
    return [ordered]@{ mode = "SKIP"; reason = "Not enough free disk space for any local voice option ($DiskFreeGb GB free)." }
}

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
<#
Runtime (venv) and model cache both live under shared\, never under a
versioned release directory, so an update - which replaces the release
directory - never touches either. This is the same invariant install.ps1
already applies to data\, config\ and backups\.
#>
function Get-LocalVoicePaths {
    param(
        [Parameter(Mandatory = $true)][string]$AbudShared,
        [Parameter(Mandatory = $true)][string]$AbudDataDir,
        [int]$Port = 8765
    )
    $runtimeDir = Join-Path $AbudShared "runtime\local-tts"
    return [ordered]@{
        RuntimeDir    = $runtimeDir
        VenvDir       = Join-Path $runtimeDir "venv"
        ManifestFile  = Join-Path $runtimeDir "runtime-manifest.json"
        ModelCacheDir = Join-Path $AbudDataDir "models"
        LogFile       = Join-Path $AbudShared "logs\local-tts.log"
        PidFile       = Join-Path $AbudShared "state\local-tts.pid"
        Port          = $Port
    }
}

# ---------------------------------------------------------------------------
# Port selection
# ---------------------------------------------------------------------------
function Test-LocalVoiceOwnsPort {
    param([int]$Port)
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2 -ErrorAction Stop
        return ($health.PSObject.Properties.Name -contains "hardware")
    } catch {
        return $false
    }
}

function Resolve-LocalVoicePort {
    param([int]$PreferredPort = 8765, [int]$MaxAttempts = 10)
    for ($i = 0; $i -lt $MaxAttempts; $i++) {
        $candidate = $PreferredPort + $i
        $busy = $true
        try {
            $probe = New-Object System.Net.Sockets.TcpClient
            $probe.Connect("127.0.0.1", $candidate)
            $probe.Close()
        } catch {
            $busy = $false
        }
        if (-not $busy) { return $candidate }
        if (Test-LocalVoiceOwnsPort -Port $candidate) { return $candidate }
    }
    throw "Could not find a free port for Local Voice starting at $PreferredPort."
}

# ---------------------------------------------------------------------------
# Runtime (Python venv) install / repair
# ---------------------------------------------------------------------------
function Test-LocalVoiceRuntimeReady {
    param([Parameter(Mandatory = $true)]$Paths)
    $python = Join-Path $Paths.VenvDir "Scripts\python.exe"
    if (-not (Test-Path $python)) { return $false }
    $probe = Invoke-LocalVoiceNative $python @("-c", "import torch, voicetut_tts; print(torch.__version__)")
    if ($LASTEXITCODE -ne 0 -or -not $probe) { return $false }
    return (@($probe)[-1]).Trim() -eq $script:LocalVoicePinned.TorchVersion
}

<#
Finds a real Python 3.11 interpreter, not just an official python.org one.

`py -3.11` only ever matches a `PythonCore`-registered install (the
python.org installer). It silently ignores anything registered under a
different Company - which is exactly what common alternatives use: `uv`
registers as `Astral`, some `pyenv-win`/Conda setups use their own tags too.
`py -0p` lists every registered interpreter regardless of company, so this
parses that list for a 3.11.x entry instead of assuming python.org is the
only way 3.11 got onto the machine. Falls back to `py -3.11` for the common
case, since `py -0p`'s exact column layout is not a documented contract.
#>
function Find-LocalVoicePython311 {
    $direct = Get-Command "py" -ErrorAction SilentlyContinue
    if ($direct) {
        $resolved = Invoke-LocalVoiceNative "py" @("-3.11", "-c", "import sys; print(sys.executable)")
        if ($LASTEXITCODE -eq 0 -and $resolved) { return (@($resolved)[-1]).Trim() }

        $listing = Invoke-LocalVoiceNative "py" @("-0p")
        if ($LASTEXITCODE -eq 0 -and $listing) {
            foreach ($line in $listing) {
                if ($line -match "3\.11" -and $line -match "(\S:\\[^\s]+python\.exe)") {
                    $candidate = $Matches[1]
                    if (Test-Path $candidate) { return $candidate }
                }
            }
        }
    }

    foreach ($name in @("python3.11", "python3.11.exe")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    return $null
}

function Write-LocalVoiceRuntimeManifest {
    param([Parameter(Mandatory = $true)]$Paths, [Parameter(Mandatory = $true)][string]$Source)
    $manifest = [ordered]@{
        pythonVersion      = $script:LocalVoicePinned.PythonVersion
        torchVersion       = $script:LocalVoicePinned.TorchVersion
        voicetutTtsVersion = $script:LocalVoicePinned.VoicetutTtsVersion
        source             = $Source
        installedAt        = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    Write-TextFile $Paths.ManifestFile ($manifest | ConvertTo-Json -Depth 4)
}

<#
Idempotent. Three paths, in order:
  1. Already ready (correct pinned versions importable) -> no-op.
  2. A verified developer venv ships next to the source in this same package
     (services\local-tts\.venv) -> copied into the product-owned location
     instead of re-downloading the multi-gigabyte CUDA wheels.
  3. Neither exists -> a real fresh install, pinned exactly as accepted in
     Pass 9.8.
#>
function Install-LocalVoiceRuntime {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)][string]$AppSourceDir,
        [switch]$Force
    )
    if (-not $Force -and (Test-LocalVoiceRuntimeReady -Paths $Paths)) {
        return [ordered]@{ status = "already_ready"; reused = $true }
    }

    $legacyVenv = Join-Path $AppSourceDir ".venv"
    $legacyPython = Join-Path $legacyVenv "Scripts\python.exe"
    if (Test-Path $legacyPython) {
        $legacyProbe = Invoke-LocalVoiceNative $legacyPython @("-c", "import torch, voicetut_tts; print(torch.__version__)")
        if ($LASTEXITCODE -eq 0 -and $legacyProbe -and (@($legacyProbe)[-1]).Trim() -eq $script:LocalVoicePinned.TorchVersion) {
            New-Item -ItemType Directory -Path $Paths.RuntimeDir -Force | Out-Null
            if (Test-Path $Paths.VenvDir) { Remove-Item $Paths.VenvDir -Recurse -Force }
            Copy-Item $legacyVenv $Paths.VenvDir -Recurse -Force
            Write-LocalVoiceRuntimeManifest -Paths $Paths -Source "reused_verified_dev_runtime"
            return [ordered]@{ status = "reused_existing_runtime"; reused = $true }
        }
    }

    $python311 = Find-LocalVoicePython311
    if (-not $python311) {
        throw "Python 3.11 was not found on this machine. Install it from python.org (or 'winget install Python.Python.3.11') and try again."
    }
    New-Item -ItemType Directory -Path $Paths.RuntimeDir -Force | Out-Null
    if (Test-Path $Paths.VenvDir) { Remove-Item $Paths.VenvDir -Recurse -Force }
    Invoke-LocalVoiceNative $python311 @("-m", "venv", $Paths.VenvDir) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not create the Local Voice Python 3.11 environment." }

    $python = Join-Path $Paths.VenvDir "Scripts\python.exe"
    # `python -m venv` is supposed to bootstrap pip itself, but some standalone/
    # portable CPython builds (e.g. python-build-standalone, as installed by
    # `uv python install`) silently skip that step - the venv is created (exit
    # 0, real pyvenv.cfg) with no pip module at all. `pip install --upgrade
    # pip` then fails with "No module named pip", and its exit code was never
    # checked here, so that failure was previously invisible until the next
    # step also failed. `ensurepip` is the one operation guaranteed to work
    # against a pip-less venv's own bundled wheels, so run it unconditionally
    # before ever invoking `-m pip`.
    Invoke-LocalVoiceNative $python @("-m", "ensurepip", "--upgrade") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not bootstrap pip inside the Local Voice Python environment." }
    Invoke-LocalVoiceNative $python @("-m", "pip", "install", "--upgrade", "pip", "--quiet") | Out-Null
    Invoke-LocalVoiceNative $python @("-m", "pip", "install", "-r", (Join-Path $AppSourceDir "requirements.txt"), "--quiet") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not install the Local Voice service's base dependencies." }
    Invoke-LocalVoiceNative $python @("-m", "pip", "install", "torch==$($script:LocalVoicePinned.TorchVersion)", "torchaudio==$($script:LocalVoicePinned.TorchaudioVersion)", "--index-url", $script:LocalVoicePinned.TorchIndexUrl, "--quiet") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not install the pinned PyTorch CUDA runtime ($($script:LocalVoicePinned.TorchVersion))." }
    Invoke-LocalVoiceNative $python @("-m", "pip", "install", $script:LocalVoicePinned.OmniVoiceSource, "voicetut-tts==$($script:LocalVoicePinned.VoicetutTtsVersion)", "--quiet") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not install VoiceTut-TTS $($script:LocalVoicePinned.VoicetutTtsVersion)." }

    if (-not (Test-LocalVoiceRuntimeReady -Paths $Paths)) {
        throw "The Local Voice runtime installed but does not report the expected pinned versions."
    }
    Write-LocalVoiceRuntimeManifest -Paths $Paths -Source "fresh_install"
    return [ordered]@{ status = "installed"; reused = $false }
}

# ---------------------------------------------------------------------------
# Model install (delegates to the canonical downloader - not duplicated here)
# ---------------------------------------------------------------------------
function Install-LocalVoiceModel {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("voicetut", "kemetone")][string]$ModelId,
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)][string]$LibRoot
    )
    $installer = Join-Path (Split-Path $LibRoot -Parent) "install-local-voice.ps1"
    if (-not (Test-Path $installer)) { throw "install-local-voice.ps1 is missing from this release." }
    & $installer -ModelId $ModelId -CacheDir $Paths.ModelCacheDir
    return ($LASTEXITCODE -eq 0)
}

# ---------------------------------------------------------------------------
# Host-native service lifecycle
# ---------------------------------------------------------------------------
function Get-LocalVoiceServiceStatus {
    param([Parameter(Mandatory = $true)]$Paths)
    $result = [ordered]@{ running = $false; processId = $null; healthy = $false; modelsReady = @() }
    if (Test-Path $Paths.PidFile) {
        $pidValue = (Get-Content $Paths.PidFile -Raw).Trim()
        if ($pidValue -match '^\d+$') {
            $proc = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -match "python") {
                $result.running = $true
                $result.processId = [int]$pidValue
            }
        }
    }
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($Paths.Port)/health" -TimeoutSec 3 -ErrorAction Stop
        $result.healthy = [bool]$health.ok
        if ($health.models_ready) { $result.modelsReady = @($health.models_ready) }
        if (-not $result.running) { $result.running = $true }
    } catch { }
    return $result
}

function Start-LocalVoiceService {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)][string]$AppSourceDir,
        [string]$InternalServiceToken = ""
    )
    $status = Get-LocalVoiceServiceStatus -Paths $Paths
    if ($status.healthy) { return [ordered]@{ started = $false; alreadyRunning = $true; ready = $true; processId = $status.processId } }

    $python = Join-Path $Paths.VenvDir "Scripts\pythonw.exe"
    if (-not (Test-Path $python)) { $python = Join-Path $Paths.VenvDir "Scripts\python.exe" }
    if (-not (Test-Path $python)) { throw "The Local Voice runtime is not installed." }

    New-Item -ItemType Directory -Path (Split-Path $Paths.LogFile) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path $Paths.PidFile) -Force | Out-Null

    # Bounded logs: a long-running host service must never grow without limit.
    if ((Test-Path $Paths.LogFile) -and (Get-Item $Paths.LogFile).Length -gt 20MB) {
        Move-Item $Paths.LogFile "$($Paths.LogFile).old" -Force
    }

    $previousPort = $env:PORT
    $previousCache = $env:ABUD_MODEL_CACHE_DIR
    $previousToken = $env:INTERNAL_SERVICE_TOKEN
    $env:PORT = "$($Paths.Port)"
    $env:ABUD_MODEL_CACHE_DIR = $Paths.ModelCacheDir
    $env:INTERNAL_SERVICE_TOKEN = $InternalServiceToken
    try {
        $proc = Start-Process -FilePath $python `
            -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "$($Paths.Port)") `
            -WorkingDirectory $AppSourceDir `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $Paths.LogFile `
            -RedirectStandardError "$($Paths.LogFile).err"
    } finally {
        $env:PORT = $previousPort
        $env:ABUD_MODEL_CACHE_DIR = $previousCache
        $env:INTERNAL_SERVICE_TOKEN = $previousToken
    }
    Set-Content -Path $Paths.PidFile -Value "$($proc.Id)" -Encoding ascii -NoNewline

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        try { Invoke-RestMethod -Uri "http://127.0.0.1:$($Paths.Port)/health" -TimeoutSec 3 -ErrorAction Stop | Out-Null; $ready = $true; break }
        catch { Start-Sleep -Seconds 2 }
    }
    return [ordered]@{ started = $true; alreadyRunning = $false; ready = $ready; processId = $proc.Id }
}

function Stop-LocalVoiceService {
    param([Parameter(Mandatory = $true)]$Paths)
    if (Test-Path $Paths.PidFile) {
        $pidValue = (Get-Content $Paths.PidFile -Raw).Trim()
        if ($pidValue -match '^\d+$') {
            Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $Paths.PidFile -Force -ErrorAction SilentlyContinue
    }
    return [ordered]@{ stopped = $true }
}

function Restart-LocalVoiceService {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)][string]$AppSourceDir,
        [string]$InternalServiceToken = ""
    )
    Stop-LocalVoiceService -Paths $Paths | Out-Null
    Start-Sleep -Seconds 1
    return Start-LocalVoiceService -Paths $Paths -AppSourceDir $AppSourceDir -InternalServiceToken $InternalServiceToken
}

# ---------------------------------------------------------------------------
# Windows auto-start (per-user, no admin, no stored password)
# ---------------------------------------------------------------------------
<#
Both the scheduled task and the Startup-folder fallback point at ONE fixed
path under shared\ instead of a specific release directory. A release
directory can be replaced or pruned on the next update; shared\ never is.
This file itself re-reads current.txt every time Windows runs it, so
whichever mechanism actually got registered keeps starting whichever
release is current - including after an update - without ever needing to
be re-registered.
#>
function Get-LocalVoiceAutoStartLauncherPath {
    param([Parameter(Mandatory = $true)][string]$AbudShared)
    return Join-Path $AbudShared "bin\start-local-voice.ps1"
}

<#
Embeds the exact install root this was registered for (usually the default
%ProgramData%\AbudShorts, but a custom -InstallRoot is a real, supported
override) as a literal, rather than re-deriving the default at run time -
otherwise a non-default install's autostart would silently resolve against
the wrong (or a nonexistent) default location.
#>
function Install-LocalVoiceAutoStartLauncher {
    param([Parameter(Mandatory = $true)][string]$AbudShared)
    $launcherPath = Get-LocalVoiceAutoStartLauncherPath -AbudShared $AbudShared
    $abudHome = Split-Path $AbudShared -Parent
    $escapedHome = $abudHome.Replace("'", "''")
    $content = @"
# Short Studio Server - stable Local Voice autostart launcher.
# Regenerated on every install/repair - do not edit by hand. Re-resolves
# current.txt on every run so it always starts whichever release is
# actually current, never a specific (and eventually obsolete) one.
`$ErrorActionPreference = "SilentlyContinue"
`$abudHome = '$escapedHome'
`$currentFile = Join-Path `$abudHome "current.txt"
if (-not (Test-Path `$currentFile)) { exit 0 }
`$releaseDir = (Get-Content `$currentFile -Raw).Trim()
`$cli = Join-Path `$releaseDir "scripts\host\short-studio.ps1"
if (-not (Test-Path `$cli)) { exit 0 }
`$env:ABUD_HOME = `$abudHome
& `$cli local-voice start
"@
    Write-TextFile $launcherPath $content
    return $launcherPath
}

function Get-LocalVoiceStartupShortcutPath {
    param([string]$Name = $script:LocalVoiceTaskName)
    $startupDir = [System.Environment]::GetFolderPath("Startup")
    return Join-Path $startupDir "$Name.lnk"
}

function Register-LocalVoiceStartupFolderFallback {
    param([Parameter(Mandatory = $true)][string]$LauncherPath)
    try {
        $shortcutPath = Get-LocalVoiceStartupShortcutPath
        $startupDir = Split-Path $shortcutPath -Parent
        if ($startupDir -and -not (Test-Path $startupDir)) {
            New-Item -ItemType Directory -Path $startupDir -Force | Out-Null
        }
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = "powershell.exe"
        $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$LauncherPath`""
        $shortcut.WorkingDirectory = Split-Path $LauncherPath -Parent
        $shortcut.Description = "Starts Short Studio Local Voice at login"
        $shortcut.Save()
        return (Test-Path $shortcutPath)
    } catch {
        return $false
    }
}

function Unregister-LocalVoiceStartupFolderFallback {
    foreach ($name in @($script:LocalVoiceTaskName, $script:LegacyLocalVoiceTaskName)) {
        $shortcutPath = Get-LocalVoiceStartupShortcutPath -Name $name
        if (Test-Path $shortcutPath) { Remove-Item $shortcutPath -Force -ErrorAction SilentlyContinue }
    }
    return $true
}

<#
Tries the primary mechanism (a per-user "at logon" scheduled task, no admin,
no stored password) first; if Task Scheduler itself denies task creation for
this account - a real, observed failure mode on some Windows accounts even
though the Task Scheduler service is running normally - falls back to a
Startup-folder shortcut, which needs no Task Scheduler access at all. Never
claims success it did not actually verify.
#>
function Register-LocalVoiceAutoStart {
    param([Parameter(Mandatory = $true)][string]$AbudShared)
    $launcherPath = Install-LocalVoiceAutoStartLauncher -AbudShared $AbudShared
    $action = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcherPath`""

    Invoke-LocalVoiceNative "schtasks" @("/create", "/tn", $script:LocalVoiceTaskName, "/tr", "powershell.exe $action", "/sc", "onlogon", "/rl", "limited", "/f") | Out-Null
    if ($LASTEXITCODE -eq 0) {
        # Registering under the new name never leaves an installation with two
        # competing autostart entries: an ABUD Shorts Engine 2.4 install's
        # legacy-named task/shortcut is cleaned up as part of the same call.
        Invoke-LocalVoiceNative "schtasks" @("/delete", "/tn", $script:LegacyLocalVoiceTaskName, "/f") | Out-Null
        Unregister-LocalVoiceStartupFolderFallback | Out-Null
        return [ordered]@{ registered = $true; mechanism = "scheduled_task" }
    }

    if (Register-LocalVoiceStartupFolderFallback -LauncherPath $launcherPath) {
        return [ordered]@{ registered = $true; mechanism = "startup_folder" }
    }

    return [ordered]@{ registered = $false; mechanism = "none" }
}

function Unregister-LocalVoiceAutoStart {
    param([Parameter(Mandatory = $true)][string]$AbudShared)
    foreach ($name in @($script:LocalVoiceTaskName, $script:LegacyLocalVoiceTaskName)) {
        Invoke-LocalVoiceNative "schtasks" @("/delete", "/tn", $name, "/f") | Out-Null
    }
    Unregister-LocalVoiceStartupFolderFallback | Out-Null
    $launcherPath = Get-LocalVoiceAutoStartLauncherPath -AbudShared $AbudShared
    if (Test-Path $launcherPath) { Remove-Item $launcherPath -Force -ErrorAction SilentlyContinue }
    return $true
}

function Test-LocalVoiceAutoStartRegistered {
    Invoke-LocalVoiceNative "schtasks" @("/query", "/tn", $script:LocalVoiceTaskName) | Out-Null
    $scheduledTask = ($LASTEXITCODE -eq 0)
    if (-not $scheduledTask) {
        # Detects an ABUD Shorts Engine 2.4 install's still-registered legacy
        # task, so this reports "registered" truthfully instead of a false
        # "none" next to Local Voice actually auto-starting.
        Invoke-LocalVoiceNative "schtasks" @("/query", "/tn", $script:LegacyLocalVoiceTaskName) | Out-Null
        $scheduledTask = ($LASTEXITCODE -eq 0)
    }
    $startupFolder = (Test-Path (Get-LocalVoiceStartupShortcutPath -Name $script:LocalVoiceTaskName)) -or
                      (Test-Path (Get-LocalVoiceStartupShortcutPath -Name $script:LegacyLocalVoiceTaskName))
    $mechanism = if ($scheduledTask) { "scheduled_task" } elseif ($startupFolder) { "startup_folder" } else { "none" }
    return [ordered]@{ scheduledTask = $scheduledTask; startupFolder = $startupFolder; any = ($scheduledTask -or $startupFolder); mechanism = $mechanism }
}

# ---------------------------------------------------------------------------
# Orchestration - the single entry point install.ps1 and short-studio.ps1 both
# call, so the two never duplicate the setup sequence itself.
# ---------------------------------------------------------------------------
function Invoke-LocalVoiceSetup {
    param(
        [ValidateSet("AUTO", "HIGH_QUALITY", "LIGHTWEIGHT", "SKIP")]
        [string]$Mode = "AUTO",
        [Parameter(Mandatory = $true)][string]$AbudShared,
        [Parameter(Mandatory = $true)][string]$AbudDataDir,
        [Parameter(Mandatory = $true)][string]$AppSourceDir,
        [Parameter(Mandatory = $true)][string]$LibRoot,
        [string]$InternalServiceToken = "",
        [switch]$Repair
    )

    $result = [ordered]@{
        requestedMode       = $Mode
        resolvedMode        = $null
        resolutionReason    = $null
        hardware            = $null
        diskFreeGb          = $null
        runtimeInstalled    = $false
        runtimeDetail       = $null
        modelId             = $null
        modelInstalled      = $false
        serviceStarted      = $false
        modelReady          = $false
        autoStartRegistered = $false
        autoStartMechanism  = "none"
        port                = $null
        baseUrl             = $null
        error               = $null
    }

    $hardware = Get-LocalVoiceHardwareProfile
    $diskFreeGb = Get-LocalVoiceDiskFreeGb -Path $AbudShared
    $result.hardware = $hardware
    $result.diskFreeGb = $diskFreeGb

    $resolution = Resolve-LocalVoiceMode -Requested $Mode -Hardware $hardware -DiskFreeGb $diskFreeGb
    $result.resolvedMode = $resolution.mode
    $result.resolutionReason = $resolution.reason

    if ($resolution.mode -eq "SKIP") {
        return $result
    }

    try {
        $modelId = if ($resolution.mode -eq "HIGH_QUALITY") { "voicetut" } else { "kemetone" }
        $result.modelId = $modelId
        $port = Resolve-LocalVoicePort -PreferredPort 8765
        $paths = Get-LocalVoicePaths -AbudShared $AbudShared -AbudDataDir $AbudDataDir -Port $port
        $result.port = $port
        $result.baseUrl = "http://host.docker.internal:$port"

        $runtimeResult = Install-LocalVoiceRuntime -Paths $paths -AppSourceDir $AppSourceDir -Force:$Repair
        $result.runtimeInstalled = $true
        $result.runtimeDetail = $runtimeResult.status

        $result.modelInstalled = Install-LocalVoiceModel -ModelId $modelId -Paths $paths -LibRoot $LibRoot

        $startResult = Start-LocalVoiceService -Paths $paths -AppSourceDir $AppSourceDir -InternalServiceToken $InternalServiceToken
        $result.serviceStarted = $startResult.ready

        $status = Get-LocalVoiceServiceStatus -Paths $paths
        $result.modelReady = ($status.modelsReady -contains $modelId)

        $autoStart = Register-LocalVoiceAutoStart -AbudShared $AbudShared
        $result.autoStartRegistered = $autoStart.registered
        $result.autoStartMechanism = $autoStart.mechanism
    } catch {
        $result.error = $_.Exception.Message
    }
    return $result
}
