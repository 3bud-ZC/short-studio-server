param(
    [string]$InstallRoot = "C:\ProgramData\ShortStudio",
    [string]$ComposeProject = "short-studio",
    [switch]$RemoveData
)

$currentTxt = Join-Path $InstallRoot "current.txt"
$releaseDir = if (Test-Path $currentTxt) { (Get-Content $currentTxt -Raw).Trim() } else { Join-Path $InstallRoot "releases\2.6.0" }
$uninstallScript = Join-Path $releaseDir "uninstall.ps1"

if (Test-Path $uninstallScript) {
    $uninstArgs = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $uninstallScript,
        "-InstallRoot", $InstallRoot,
        "-ComposeProject", $ComposeProject
    )
    if ($RemoveData) { $uninstArgs += "-RemoveData" }
    & powershell.exe @uninstArgs
}
else {
    & docker compose --project-name $ComposeProject down
}

# Remove desktop and start menu shortcuts
$desktopPath = [Environment]::GetFolderPath("Desktop")
$commonDesktopPath = [Environment]::GetFolderPath("CommonDesktopDirectory")
foreach ($p in @($desktopPath, $commonDesktopPath)) {
    if ($p) {
        $f = Join-Path $p "Short Studio.url"
        if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
    }
}
$startMenuPath = [Environment]::GetFolderPath("Programs")
$commonStartMenuPath = [Environment]::GetFolderPath("CommonPrograms")
foreach ($p in @($startMenuPath, $commonStartMenuPath)) {
    if ($p) {
        $f = Join-Path $p "Short Studio.url"
        if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
        $g = Join-Path $p "Short Studio"
        if (Test-Path $g) { Remove-Item $g -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
