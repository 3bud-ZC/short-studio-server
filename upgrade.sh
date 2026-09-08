#!/usr/bin/env bash
# ==============================================================================
# Short Studio Server - Upgrade entry point (Linux / macOS)
# ==============================================================================
# Kept so existing documentation and habits keep working. The real updater is
# scripts/host/abud-update.sh, which is also what `short-studio update` runs:
# one code path, one set of safety checks, one rollback.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "${ABUD_HOME:-}" ]; then
  # An installation upgraded from ABUD Shorts Engine 2.4 stays at its
  # existing data root - see the identical detection in install.sh.
  if [ -f "/opt/abud-shorts/shared/config/.env" ]; then
    ABUD_HOME="/opt/abud-shorts"
  else
    ABUD_HOME="/opt/short-studio"
  fi
fi

for candidate in \
  "$SCRIPT_DIR/scripts/host/abud-update.sh" \
  "$ABUD_HOME/current/scripts/host/abud-update.sh"
do
  if [ -x "$candidate" ] || [ -f "$candidate" ]; then
    exec bash "$candidate" "$@"
  fi
done

echo "Error: the Short Studio updater was not found." >&2
echo "On an installed system, run: sudo short-studio update" >&2
exit 1
