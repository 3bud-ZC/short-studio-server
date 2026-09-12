param(
    [string]$OutputFile = "",
    [string]$ReportFile = "",
    [string]$InstallRoot = "C:\ProgramData\ShortStudio",
    [int]$Port = 3130
)

$isWin64 = [Environment]::Is64BitOperatingSystem
$osVer = [Environment]::OSVersion.Version
$isWin10Or11 = ($osVer.Major -gt 10) -or ($osVer.Major -eq 10 -and $osVer.Build -ge 10240)
$osText = "Windows $($osVer.Major).$($osVer.Minor) (Build $($osVer.Build)) 64-bit"

$isAdmin = $false
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch { $isAdmin = $false }

# Docker Desktop installed
$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
$dockerDesktopExe = Test-Path "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe"
$dockerInstalled = [bool]($dockerCmd -or $dockerDesktopExe)

# Docker Engine running
$dockerRunning = $false
if ($dockerInstalled) {
    try {
        & docker info 2>&1 | Out-Null
        $dockerRunning = ($LASTEXITCODE -eq 0)
    } catch { $dockerRunning = $false }
}

# WSL2 available
$wslCmd = Get-Command wsl -ErrorAction SilentlyContinue
$wslAvailable = $false
if ($wslCmd) {
    try {
        $wslOut = & wsl --status 2>&1
        $wslAvailable = ($LASTEXITCODE -eq 0)
    } catch { $wslAvailable = $false }
}

# Free disk space
$driveLetter = "C"
if ($InstallRoot -and $InstallRoot.Length -ge 2 -and $InstallRoot[1] -eq ':') {
    $driveLetter = $InstallRoot.Substring(0, 1)
}
$freeGb = 0
try {
    $drive = Get-PSDrive -Name $driveLetter -ErrorAction Stop
    $freeGb = [math]::Round($drive.Free / 1GB, 1)
} catch {
    $freeGb = 20
}
$diskSpaceOk = ($freeGb -ge 15.0)

# Port availability
$portBusy = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $Port)
    $tcp.Close()
    $portBusy = $true
} catch {
    $portBusy = $false
}

$portOk = $false
$portOwnedByShortStudio = $false
if ($portBusy) {
    try {
        $probe = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v2/system/info" -TimeoutSec 3 -ErrorAction Stop
        if (($probe.name -like "Short Studio*") -or ($probe.name -like "ABUD Shorts Engine*")) {
            $portOwnedByShortStudio = $true
            $portOk = $true
        } else {
            $portOk = $false
        }
    } catch {
        $portOk = $false
    }
} else {
    $portOk = $true
}

$allCriticalPassed = ($isWin64 -and $isWin10Or11 -and $dockerInstalled -and $dockerRunning -and $diskSpaceOk -and $portOk)

$reportLines = @()
$reportLines += "System Prerequisite Verification"
$reportLines += "=================================================="
$reportLines += "[ $(if ($isWin64 -and $isWin10Or11) { 'PASS' } else { 'FAIL' }) ] Operating System    : $osText"
$reportLines += "[ $(if ($isAdmin) { 'PASS' } else { 'INFO' }) ] Administrator Access: $(if ($isAdmin) { 'Available' } else { 'Standard / UAC Elevation' })"
$reportLines += "[ $(if ($dockerInstalled) { 'PASS' } else { 'FAIL' }) ] Docker Desktop      : $(if ($dockerInstalled) { 'Installed' } else { 'NOT INSTALLED' })"
$reportLines += "[ $(if ($dockerRunning) { 'PASS' } else { 'FAIL' }) ] Docker Engine       : $(if ($dockerRunning) { 'Running' } else { 'NOT RUNNING' })"
$reportLines += "[ $(if ($wslAvailable) { 'PASS' } else { 'WARN' }) ] WSL2 Engine         : $(if ($wslAvailable) { 'Available' } else { 'Check WSL2 configuration' })"
$reportLines += "[ $(if ($diskSpaceOk) { 'PASS' } else { 'FAIL' }) ] Disk Space (${driveLetter}:)     : $freeGb GB free (min. 15 GB required)"
$reportLines += "[ $(if ($portOk) { 'PASS' } else { 'FAIL' }) ] Port $Port             : $(if (-not $portBusy) { 'Available' } elseif ($portOwnedByShortStudio) { 'Serving Short Studio (re-install / update)' } else { 'IN USE by another process' })"
$reportLines += "=================================================="

if (-not $dockerInstalled) {
    $reportLines += ""
    $reportLines += "ACTION REQUIRED:"
    $reportLines += "Docker Desktop is required to run Short Studio Server."
    $reportLines += "Please download and install Docker Desktop from the official website:"
    $reportLines += "  https://www.docker.com/products/docker-desktop/"
    $reportLines += ""
    $reportLines += "Enable WSL2 backend during Docker installation."
    $reportLines += "After installing, start Docker Desktop and click 'Re-check'."
} elseif (-not $dockerRunning) {
    $reportLines += ""
    $reportLines += "ACTION REQUIRED:"
    $reportLines += "Docker Desktop is installed, but Docker Engine is not running."
    $reportLines += "Please launch Docker Desktop from the Start Menu."
    $reportLines += "Wait until the whale icon shows 'Engine running', then click 'Re-check'."
} elseif (-not $portOk) {
    $reportLines += ""
    $reportLines += "ACTION REQUIRED:"
    $reportLines += "Port $Port is already in use by another application on this computer."
    $reportLines += "Please close the conflicting application, or choose another port."
} elseif (-not $diskSpaceOk) {
    $reportLines += ""
    $reportLines += "ACTION REQUIRED:"
    $reportLines += "Drive ${driveLetter}: has only $freeGb GB free. At least 15 GB is required."
    $reportLines += "Please free up disk space or choose another installation drive."
} else {
    $reportLines += ""
    $reportLines += "All prerequisites verified successfully."
    $reportLines += "Click 'Next' to continue installation."
}

$reportText = $reportLines -join "`r`n"

if ($ReportFile) {
    [System.IO.File]::WriteAllText($ReportFile, $reportText, [System.Text.Encoding]::UTF8)
}

$result = [ordered]@{
    allPassed              = $allCriticalPassed
    isWin64                = $isWin64
    isWin10Or11            = $isWin10Or11
    osText                 = $osText
    isAdmin                = $isAdmin
    dockerInstalled        = $dockerInstalled
    dockerRunning          = $dockerRunning
    wslAvailable           = $wslAvailable
    freeGb                 = $freeGb
    diskSpaceOk            = $diskSpaceOk
    portBusy               = $portBusy
    portOwnedByShortStudio = $portOwnedByShortStudio
    portOk                 = $portOk
    port                   = $Port
}

$json = $result | ConvertTo-Json -Depth 3
if ($OutputFile) {
    [System.IO.File]::WriteAllText($OutputFile, $json, [System.Text.Encoding]::UTF8)
}

if ($allCriticalPassed) {
    exit 0
} elseif (-not $dockerInstalled) {
    exit 11
} elseif (-not $dockerRunning) {
    exit 12
} elseif (-not $diskSpaceOk) {
    exit 13
} elseif (-not $portOk) {
    exit 14
} else {
    exit 10
}
