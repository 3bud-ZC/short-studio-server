# ==============================================================================
# Short Studio Server - Installer Execution Engine
# ==============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageArchive,

    [string]$ExpectedSha256 = "509296184b062bd2db5592f70f4eb55f1b7ea79b172e2f9568246f63bc2e2fcf",
    [string]$InstallRoot = "C:\ProgramData\ShortStudio",
    [int]$Port = 3130,
    [string]$ComposeProject = "short-studio",
    [string]$LocalVoice = "AUTO",
    [switch]$NoShortcuts,
    [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Logging & Secret Sanitization
# ---------------------------------------------------------------------------
if (-not $LogPath) {
    $logDir = Join-Path $InstallRoot "logs"
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $LogPath = Join-Path $logDir "installer.log"
}
else {
    $logDir = Split-Path -Parent $LogPath
    if ($logDir -and -not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
}

function Sanitize-LogMessage([string]$text) {
    if ([string]::IsNullOrEmpty($text)) { return $text }
    $s = $text
    $s = [regex]::Replace($s, "(INTERNAL_SERVICE_TOKEN=)[^\r\n]+", "$1[REDACTED]")
    $s = [regex]::Replace($s, "(POSTGRES_PASSWORD=)[^\r\n]+", "$1[REDACTED]")
    $s = [regex]::Replace($s, "(N8N_ENCRYPTION_KEY=)[^\r\n]+", "$1[REDACTED]")
    $s = [regex]::Replace($s, "(SESSION_SECRET=)[^\r\n]+", "$1[REDACTED]")
    $s = [regex]::Replace($s, "(PROVIDER_VAULT_MASTER_KEY=)[^\r\n]+", "$1[REDACTED]")
    $s = [regex]::Replace($s, "(WEBHOOK_SIGNING_SECRET=)[^\r\n]+", "$1[REDACTED]")
    $s = [regex]::Replace($s, "(ELEVENLABS_API_KEY=)[^\r\n]+", "$1[REDACTED]")
    $s = [regex]::Replace($s, "(PEXELS_API_KEY=)[^\r\n]+", "$1[REDACTED]")
    $s = [regex]::Replace($s, "short_studio_sec_[0-9a-fA-F]+", "short_studio_sec_[REDACTED]")
    $s = [regex]::Replace($s, "short_studio_pg_[0-9a-fA-F]+", "short_studio_pg_[REDACTED]")
    $s = [regex]::Replace($s, "whsec_[0-9a-fA-F]+", "whsec_[REDACTED]")
    return $s
}

function Write-InstallerLog([string]$msg, [string]$color = "Cyan") {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $sanitized = Sanitize-LogMessage $msg
    $logLine = "[$timestamp] $sanitized"
    try {
        [System.IO.File]::AppendAllText($LogPath, "$logLine`r`n", [System.Text.Encoding]::UTF8)
    }
    catch { }
    Write-Host $sanitized -ForegroundColor $color
}

Write-InstallerLog "================================================================="
Write-InstallerLog "  Short Studio Server Commercial Installer - Execution Engine"
Write-InstallerLog "  Target Install Root : $InstallRoot"
Write-InstallerLog "  Target Port         : $Port"
Write-InstallerLog "  Compose Project     : $ComposeProject"
Write-InstallerLog "  Local Voice Mode    : $LocalVoice"
Write-InstallerLog "  Package Archive     : $PackageArchive"
Write-InstallerLog "================================================================="

# ---------------------------------------------------------------------------
# 1. Check Package Archive Exists
# ---------------------------------------------------------------------------
if (-not (Test-Path $PackageArchive)) {
    Write-InstallerLog "FATAL: Client package archive not found at: $PackageArchive" "Red"
    exit 1
}

# ---------------------------------------------------------------------------
# 2. Cryptographic Checksum Verification (BEFORE Extraction)
# ---------------------------------------------------------------------------
Write-InstallerLog "Verifying cryptographic checksum of package archive..." "Yellow"
$computedHash = (Get-FileHash -Path $PackageArchive -Algorithm SHA256).Hash.ToLower()
Write-InstallerLog "  Calculated SHA256 : $computedHash"
Write-InstallerLog "  Expected SHA256   : $($ExpectedSha256.ToLower())"

if ($computedHash -ne $ExpectedSha256.ToLower()) {
    Write-InstallerLog "FATAL: Package checksum verification failed! Archive has been tampered with or is corrupted." "Red"
    exit 2
}
Write-InstallerLog "  Checksum verification: PASS (Cryptographically Authentic)" "Green"

# ---------------------------------------------------------------------------
# 3. Extract to Secure Temporary Directory
# ---------------------------------------------------------------------------
$extractParent = Join-Path $env:TEMP ("ShortStudio_Setup_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $extractParent -Force | Out-Null
Write-InstallerLog "Extracting package to secure temporary directory: $extractParent" "Yellow"

try {
    & tar.exe -xzf $PackageArchive -C $extractParent
    if ($LASTEXITCODE -ne 0) {
        throw "tar.exe failed with exit code $LASTEXITCODE"
    }
}
catch {
    Write-InstallerLog "FATAL: Extraction failed: $($_.Exception.Message)" "Red"
    Remove-Item -Path $extractParent -Recurse -Force -ErrorAction SilentlyContinue
    exit 3
}

$engineDir = Join-Path $extractParent "Short-Studio-Server-2.6.0"
$installScript = Join-Path $engineDir "install.ps1"
if (-not (Test-Path $installScript)) {
    Write-InstallerLog "FATAL: install.ps1 not found in extracted archive ($installScript)" "Red"
    Remove-Item -Path $extractParent -Recurse -Force -ErrorAction SilentlyContinue
    exit 4
}
Write-InstallerLog "  Package extraction complete. Installation engine verified." "Green"

# ---------------------------------------------------------------------------
# 4. Execute Existing Supported install.ps1 Engine
# ---------------------------------------------------------------------------
Write-InstallerLog "Executing installation engine through supported production path..." "Yellow"
$installArgs = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $installScript,
    "-InstallRoot", $InstallRoot,
    "-Port", "$Port",
    "-ComposeProject", $ComposeProject,
    "-LocalVoice", $LocalVoice,
    "-NoBrowser"
)
if ($NoShortcuts) {
    $installArgs += "-NoShortcuts"
}

$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = "powershell.exe"
$processInfo.Arguments = ($installArgs | ForEach-Object {
        if ($_ -match '[\s"]') { '"{0}"' -f ($_ -replace '"', '\"') } else { $_ }
    }) -join " "
$processInfo.UseShellExecute = $false
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$processInfo.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $processInfo

$stdoutHandler = {
    if (-not [string]::IsNullOrEmpty($EventArgs.Data)) {
        Write-InstallerLog "  [Engine] $($EventArgs.Data)" "Gray"
    }
}
$stderrHandler = {
    if (-not [string]::IsNullOrEmpty($EventArgs.Data)) {
        Write-InstallerLog "  [Engine:ERR] $($EventArgs.Data)" "Yellow"
    }
}

Register-ObjectEvent -InputObject $process -EventName OutputDataReceived -Action $stdoutHandler | Out-Null
Register-ObjectEvent -InputObject $process -EventName ErrorDataReceived -Action $stderrHandler | Out-Null

$process.Start() | Out-Null
$process.BeginOutputReadLine()
$process.BeginErrorReadLine()
$process.WaitForExit()
$engineExitCode = $process.ExitCode

# Clean up event subscribers
Get-EventSubscriber | Where-Object { $_.SourceIdentifier -like "*OutputDataReceived*" -or $_.SourceIdentifier -like "*ErrorDataReceived*" } | Unregister-Event

if ($engineExitCode -ne 0) {
    Write-InstallerLog "FATAL: Installation engine failed with exit code $engineExitCode" "Red"
    Remove-Item -Path $extractParent -Recurse -Force -ErrorAction SilentlyContinue
    exit $engineExitCode
}
Write-InstallerLog "Installation engine finished successfully." "Green"

# ---------------------------------------------------------------------------
# 5. Clean up temporary files
# ---------------------------------------------------------------------------
Remove-Item -Path $extractParent -Recurse -Force -ErrorAction SilentlyContinue
Write-InstallerLog "Temporary extraction directory cleaned up." "Green"

# ---------------------------------------------------------------------------
# 6. Require Canonical 4-Service Runtime Health
# ---------------------------------------------------------------------------
Write-InstallerLog "Verifying canonical 4-service runtime health..." "Yellow"
$services = @(
    "$ComposeProject-app",
    "$ComposeProject-render-worker",
    "$ComposeProject-postgres",
    "$ComposeProject-n8n"
)

$maxWait = 60
$allHealthy = $false
for ($attempt = 1; $attempt -le $maxWait; $attempt++) {
    $healthyCount = 0
    foreach ($svc in $services) {
        $status = & docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $svc 2>&1
        $status = "$status".Trim()
        if ($status -eq "healthy") {
            $healthyCount++
        }
    }
    if ($healthyCount -eq $services.Count) {
        $allHealthy = $true
        break
    }
    Start-Sleep -Seconds 2
}

foreach ($svc in $services) {
    $status = & docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $svc 2>&1
    Write-InstallerLog "  Service $svc : $($status.Trim())" $(if ($status.Trim() -eq "healthy") { "Green" } else { "Red" })
}

if (-not $allHealthy) {
    Write-InstallerLog "FATAL: One or more canonical services failed to reach healthy state within timeout." "Red"
    exit 5
}
Write-InstallerLog "All 4 canonical services are verified HEALTHY." "Green"

# ---------------------------------------------------------------------------
# 7. Verify Dashboard Endpoint (HTTP 200)
# ---------------------------------------------------------------------------
Write-InstallerLog "Verifying Dashboard HTTP endpoint (http://127.0.0.1:$Port)..." "Yellow"
$dashboardVerified = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            $dashboardVerified = $true
            break
        }
    }
    catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $dashboardVerified) {
    Write-InstallerLog "FATAL: Dashboard at http://127.0.0.1:$Port did not respond HTTP 200." "Red"
    exit 6
}
Write-InstallerLog "Dashboard at http://127.0.0.1:$Port is verified accessible (HTTP 200)." "Green"

# ---------------------------------------------------------------------------
# 8. Create Required Shortcuts
# ---------------------------------------------------------------------------
if (-not $NoShortcuts) {
    Write-InstallerLog "Creating Desktop and Start Menu shortcuts..." "Yellow"
    try {
        $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        $targetDesktop = $null
        $targetStartMenu = $null
        if ($isAdmin) {
            $commonDesktop = [Environment]::GetFolderPath("CommonDesktopDirectory")
            $commonStart = [Environment]::GetFolderPath("CommonPrograms")
            if ($commonDesktop -and (Test-Path $commonDesktop)) { $targetDesktop = $commonDesktop }
            if ($commonStart -and (Test-Path $commonStart)) { $targetStartMenu = $commonStart }
        }
        if (-not $targetDesktop) { $targetDesktop = [Environment]::GetFolderPath("Desktop") }
        if (-not $targetStartMenu) { $targetStartMenu = [Environment]::GetFolderPath("Programs") }
        $shortStudioGroup = Join-Path $targetStartMenu "Short Studio"
        New-Item -ItemType Directory -Path $shortStudioGroup -Force | Out-Null

        $dashboardUrl = "http://127.0.0.1:$Port"
        $currentTxt = Join-Path $InstallRoot "current.txt"
        $releaseDir = if (Test-Path $currentTxt) { (Get-Content $currentTxt -Raw).Trim() } else { Join-Path $InstallRoot "releases\2.6.0" }
        $cliScript = Join-Path $releaseDir "scripts\host\short-studio.ps1"

        # Function to write .url file
        function Create-UrlShortcut([string]$path, [string]$url) {
            $content = @"
[InternetShortcut]
URL=$url
IconIndex=0
"@
            [System.IO.File]::WriteAllText($path, $content, [System.Text.Encoding]::ASCII)
        }

        # 1. Desktop shortcut: Short Studio -> http://127.0.0.1:Port
        $desktopUrlFile = Join-Path $targetDesktop "Short Studio.url"
        Create-UrlShortcut -path $desktopUrlFile -url $dashboardUrl
        Write-InstallerLog "  Desktop shortcut created: $desktopUrlFile -> $dashboardUrl" "Green"

        # 2. Start Menu root shortcut: Short Studio -> http://127.0.0.1:Port
        $startMenuUrlFile = Join-Path $targetStartMenu "Short Studio.url"
        Create-UrlShortcut -path $startMenuUrlFile -url $dashboardUrl

        # 3. Start Menu folder: Short Studio -> http://127.0.0.1:Port
        $groupUrlFile = Join-Path $shortStudioGroup "Short Studio.url"
        Create-UrlShortcut -path $groupUrlFile -url $dashboardUrl

        # 4. Start Menu maintenance shortcuts
        $shell = New-Object -ComObject WScript.Shell
        $maintShortcuts = @(
            @{ Name = "Start Short Studio"; Cmd = "start"; Desc = "Start Short Studio stack and local services" },
            @{ Name = "Stop Short Studio"; Cmd = "stop"; Desc = "Stop Short Studio stack safely (data preserved)" },
            @{ Name = "Restart Short Studio"; Cmd = "restart"; Desc = "Restart Short Studio stack" },
            @{ Name = "Short Studio Status"; Cmd = "status"; Desc = "Show system health, containers, and version" }
        )

        foreach ($entry in $maintShortcuts) {
            $lnkFile = Join-Path $shortStudioGroup "$($entry.Name).lnk"
            $lnk = $shell.CreateShortcut($lnkFile)
            $lnk.TargetPath = "powershell.exe"
            $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$cliScript`" $($entry.Cmd) -Pause"
            $lnk.WorkingDirectory = $releaseDir
            $lnk.Description = $entry.Desc
            $lnk.Save()
            Write-InstallerLog "  Start Menu maintenance shortcut: $($entry.Name)" "Green"
        }

        # 5. Uninstall shortcut in Start Menu folder
        $uninstallerExe = Join-Path $InstallRoot "unins000.exe"
        if (Test-Path $uninstallerExe) {
            $uninstLnk = $shell.CreateShortcut((Join-Path $shortStudioGroup "Uninstall Short Studio.lnk"))
            $uninstLnk.TargetPath = $uninstallerExe
            $uninstLnk.WorkingDirectory = $InstallRoot
            $uninstLnk.Description = "Uninstall Short Studio Server (preserves data by default)"
            $uninstLnk.Save()
            Write-InstallerLog "  Start Menu maintenance shortcut: Uninstall Short Studio" "Green"
        }
    }
    catch {
        Write-InstallerLog "WARNING: Shortcut creation encountered an issue: $($_.Exception.Message)" "Yellow"
    }
}

Write-InstallerLog "================================================================="
Write-InstallerLog "  SHORT STUDIO SERVER 2.6.0 INSTALLATION COMPLETE"
Write-InstallerLog "  Access Dashboard: http://127.0.0.1:$Port"
Write-InstallerLog "================================================================="
exit 0
