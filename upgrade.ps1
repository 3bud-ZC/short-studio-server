# ==============================================================================
# Short Studio Server - Upgrade entry point (Windows)
# ==============================================================================
# Kept so existing documentation and habits keep working. The real updater is
# scripts\host\short-studio.ps1, which is also what the "Short Studio - Update"
# Start Menu shortcut runs: one code path, one set of safety checks, one
# rollback.
# ==============================================================================

[CmdletBinding()]
param(
    [switch]$Check,
    [string]$TargetVersion = "",
    [switch]$Yes,
    [string]$InstallRoot = ""
)

$ErrorActionPreference = "Stop"

if ($InstallRoot) { $env:ABUD_HOME = $InstallRoot }
if (-not $env:ABUD_HOME) {
    $legacyRoot = Join-Path $env:ProgramData "AbudShorts"
    # An installation upgraded from ABUD Shorts Engine 2.4 stays at its
    # existing data root - see the identical detection in install.ps1.
    $env:ABUD_HOME = if (Test-Path (Join-Path $legacyRoot "shared\config\.env")) { $legacyRoot } else { Join-Path $env:ProgramData "ShortStudio" }
}

$candidates = @(
    (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "scripts\host\short-studio.ps1")
)
$currentFile = Join-Path $env:ABUD_HOME "current.txt"
if (Test-Path $currentFile) {
    $candidates += (Join-Path (Get-Content $currentFile -Raw).Trim() "scripts\host\short-studio.ps1")
}

foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
        & $candidate update -Check:$Check -TargetVersion $TargetVersion -Yes:$Yes
        exit $LASTEXITCODE
    }
}

Write-Host "Error: the Short Studio updater was not found." -ForegroundColor Red
Write-Host 'On an installed system, use the Start Menu shortcut "Short Studio - Update".'
exit 1
