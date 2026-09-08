# ==============================================================================
# Legacy compatibility alias for installations upgraded from ABUD Shorts
# Engine 2.4. Not advertised to new customers - short-studio.ps1 is canonical.
# ==============================================================================
# Forwards every argument unchanged and exits with the same exit code, so any
# shortcut, script or documentation still calling `abud-shorts` keeps working
# exactly as before.
# ==============================================================================

Write-Host "Note: 'abud-shorts' has moved to 'short-studio'. This alias is kept for installations upgraded from ABUD Shorts Engine 2.4 and is not removed." -ForegroundColor DarkGray

& (Join-Path $PSScriptRoot "short-studio.ps1") @args
exit $LASTEXITCODE
