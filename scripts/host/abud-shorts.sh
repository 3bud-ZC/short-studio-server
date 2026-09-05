#!/usr/bin/env bash
# ==============================================================================
# Legacy compatibility alias for installations upgraded from ABUD Shorts
# Engine 2.4. Not advertised to new customers - short-studio.sh is canonical.
# ==============================================================================
# Forwards every argument unchanged and exits with the same exit code, so any
# script, cron job or documentation still calling `abud-shorts` keeps working
# exactly as before.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"

echo "Note: 'abud-shorts' has moved to 'short-studio'. This alias is kept for installations upgraded from ABUD Shorts Engine 2.4 and is not removed." >&2

exec "$SCRIPT_DIR/short-studio.sh" "$@"
