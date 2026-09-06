#!/usr/bin/env bash
# ==============================================================================
# Short Studio Server - operator command
# ==============================================================================
# Installed as /usr/local/bin/short-studio. Everything an administrator needs to
# run the product day to day, without knowing any Docker syntax. abud-shorts is
# kept as a thin legacy alias that forwards here, for installations upgraded
# from ABUD Shorts Engine 2.4 - it is not advertised to new customers.
#
#   short-studio status          is it healthy, and which version
#   short-studio update          fetch, verify, back up, install, verify, or roll back
#   short-studio update --check  report only, change nothing
#   short-studio backup          make a database and configuration snapshot now
#   short-studio diagnostics     write a support bundle
#   short-studio start|stop|restart
#   short-studio rollback        return to the previous working version
#
# This is a thin wrapper. The real work lives in abud-update.sh and in the
# services the application already provides.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=./abud-lib.sh
. "$SCRIPT_DIR/abud-lib.sh"

usage() {
  cat <<'USAGE'
Short Studio Server

  short-studio status                 Show system health and the installed version
  short-studio update                 Install the latest stable version, safely
  short-studio update --check         Report whether an update is available
  short-studio update --version X.Y.Z Install a specific published version
  short-studio backup                 Create a database and configuration backup
  short-studio diagnostics            Write a support bundle
  short-studio start                  Start the system
  short-studio stop                   Stop the system (no data is removed)
  short-studio restart                Restart the system
  short-studio rollback               Return to the previous working version

Backups, videos, media and settings are never removed by any of these commands.
USAGE
}

cmd_status() {
  require_docker
  local version schema channel
  version="$(installed_version)"
  [ -n "$version" ] || version="$(command -v jq >/dev/null 2>&1 && running_version || echo "")"
  channel="$(installation_field channel)"

  echo ""
  echo "  Short Studio Server"
  echo "  Version:       ${version:-unknown}"
  echo "  Channel:       ${channel:-stable}"
  if command -v jq >/dev/null 2>&1; then
    schema="$(running_schema_version)"
    [ -n "$schema" ] && echo "  Database:      schema $schema"
    local txn_state
    txn_state="$(current_transaction_state)"
    if [ -n "$txn_state" ]; then
      warn "An update is in progress or was interrupted (state: $txn_state)."
      echo "    Run 'sudo short-studio update' to finish it safely."
    fi
  fi
  print_health_summary
}

cmd_update() {
  exec "$SCRIPT_DIR/abud-update.sh" "$@"
}

cmd_backup() {
  require_docker
  require_jq
  require_root_for_write
  local id path
  id="manual-$(date -u +%Y%m%d%H%M%S)"
  step "Creating a backup..."
  if path="$(create_pre_upgrade_backup "$id")"; then
    ok "Backup created: $path"
    echo "  It contains the database and this installation's configuration."
    echo "  Videos and media are not copied; they already live in $ABUD_DATA_DIR."
  else
    die "The backup could not be created. Check that the database is running: short-studio status"
  fi
}

cmd_diagnostics() {
  require_docker
  local out url
  url="$(app_base_url)"
  out="$ABUD_SHARED/logs/short-studio-support-bundle-$(date -u +%Y%m%d%H%M%S).json"
  mkdir -p "$(dirname "$out")"

  step "Running diagnostics..."
  # The application already builds the support bundle, with secrets redacted, so
  # the terminal and the browser produce the same file. It is fetched over the
  # internal route with this installation's own service token: the browser route
  # needs an administrator session, and a freshly installed system has none yet.
  local token status reason
  token="$(grep -E '^INTERNAL_SERVICE_TOKEN=' "$ABUD_ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  reason="The application could not be reached"

  if [ -z "$token" ]; then
    reason="This installation's configuration has no service token"
    status=""
  else
    status="$(curl -sS --max-time 60 -o "$out" -w '%{http_code}' \
      -H "x-internal-token: $token" \
      "$url/internal/v1/system/diagnostics/bundle" 2>/dev/null || true)"
  fi

  if [ "$status" = "200" ]; then
    ok "Support bundle written to: $out"
    print_health_summary || true
    return 0
  fi

  # Say what actually happened rather than blaming the network for what may be
  # a rejected token.
  case "$status" in
    401|403) reason="The application rejected this installation's service token" ;;
    "" ) : ;;
    *) reason="The application answered with HTTP $status" ;;
  esac

  warn "$reason, so a reduced bundle was written instead."
  {
      echo "{"
      echo "  \"generatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
      echo "  \"installedVersion\": \"$(installed_version)\","
      echo "  \"note\": \"$reason; container status only.\","
      echo "  \"containers\": {"
      echo "    \"app\": \"$(container_health "$(container_name app)")\","
      echo "    \"renderWorker\": \"$(container_health "$(container_name render-worker)")\","
      echo "    \"database\": \"$(container_health "$(container_name postgres)")\","
      echo "    \"automation\": \"$(container_health "$(container_name n8n)")\""
      echo "  }"
      echo "}"
  } > "$out"
  ok "Reduced bundle written to: $out"
  print_health_summary || true
}

cmd_start() {
  require_docker
  require_root_for_write
  step "Starting Short Studio..."
  compose up -d
  wait_for_endpoint "$(app_base_url)/health/ready" 90 "Short Studio" || true
  wait_for_container_settle
  print_health_summary
}

cmd_stop() {
  require_docker
  require_root_for_write
  step "Stopping Short Studio..."
  # `stop`, never `down -v`: containers halt, every volume and every file in the
  # data directory stays exactly where it is.
  compose stop
  ok "Stopped. Your videos, settings and backups are untouched."
}

cmd_restart() {
  require_docker
  require_root_for_write
  step "Restarting Short Studio..."
  compose restart
  wait_for_endpoint "$(app_base_url)/health/ready" 90 "Short Studio" || true
  wait_for_container_settle
  print_health_summary
}

cmd_rollback() {
  require_docker
  require_jq
  require_root_for_write

  local previous previous_dir
  previous="$(previous_version)"
  [ -n "$previous" ] && [ "$previous" != "null" ] ||
    die "There is no previous version to return to. This installation has not been updated yet."

  previous_dir="$ABUD_RELEASES/$previous"
  [ -d "$previous_dir" ] ||
    die "Version $previous is recorded but its files are no longer on this machine. Restore from a backup instead."

  local current
  current="$(installed_version)"
  echo ""
  echo "  This returns Short Studio from version $current to version $previous."
  echo "  Videos, media, brands, settings and publication history are not removed."
  echo ""
  if [ -t 0 ]; then
    read -r -p "  Continue? [y/N] " reply
    case "$reply" in y|Y|yes|YES) ;; *) die "Cancelled. Nothing has been changed." ;; esac
  fi

  acquire_update_lock

  ABUD_TXN_ID="rbk_$(date -u +%Y%m%d%H%M%S)_$"
  ABUD_TXN_KIND="rollback"
  ABUD_TXN_CHANNEL="$(installation_field channel)"
  ABUD_TXN_CHANNEL="${ABUD_TXN_CHANNEL:-stable}"
  ABUD_TXN_FROM="$current"
  ABUD_TXN_TO="$previous"
  ABUD_TXN_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  write_transaction ROLLING_BACK

  local previous_image
  previous_image="$(jq -r '.image // empty' "$previous_dir/release.json" 2>/dev/null || true)"

  compose stop abud-shorts-app abud-shorts-render-worker >/dev/null 2>&1 || true
  if [ -n "$previous_image" ]; then
    if grep -qE '^SHORT_STUDIO_IMAGE=' "$ABUD_ENV_FILE"; then
      sed -i "s|^SHORT_STUDIO_IMAGE=.*|SHORT_STUDIO_IMAGE=${previous_image}|" "$ABUD_ENV_FILE"
    else
      printf 'SHORT_STUDIO_IMAGE=%s\n' "$previous_image" >> "$ABUD_ENV_FILE"
    fi
    if grep -qE '^ABUD_IMAGE=' "$ABUD_ENV_FILE"; then
      sed -i "s|^ABUD_IMAGE=.*|ABUD_IMAGE=${previous_image}|" "$ABUD_ENV_FILE"
    else
      printf 'ABUD_IMAGE=%s\n' "$previous_image" >> "$ABUD_ENV_FILE"
    fi
  fi
  ln -sfn "$previous_dir" "$ABUD_CURRENT"
  write_installation_record "$previous" "" "${previous_image:-}" "$ABUD_TXN_CHANNEL"

  compose up -d >/dev/null 2>&1 || true

  if wait_for_endpoint "$(app_base_url)/health/ready" 90 "Short Studio"; then
    txn_set_json rollback "$(jq -c -n --arg v "$previous" \
      '{attempted: true, result: "succeeded", restoredVersion: $v, databaseRestored: false,
        message: "Manual rollback requested by the administrator."}')"
    write_transaction ROLLED_BACK
    wait_for_container_settle
    ok "Returned to version $previous."
  else
    txn_set_json rollback "$(jq -c -n --arg v "$previous" \
      '{attempted: true, result: "failed", restoredVersion: $v, databaseRestored: false,
        message: "Manual rollback did not reach a healthy state."}')"
    write_transaction FAILED
    fail "Version $previous was restored but the system is not healthy."
    echo "  Restore a backup from Settings -> Backup & Restore, or contact support."
  fi

  release_update_lock
  print_health_summary || true
}

COMMAND="${1:-status}"
shift || true

case "$COMMAND" in
  status)       cmd_status "$@" ;;
  update)       cmd_update "$@" ;;
  backup)       cmd_backup "$@" ;;
  diagnostics)  cmd_diagnostics "$@" ;;
  start)        cmd_start "$@" ;;
  stop)         cmd_stop "$@" ;;
  restart)      cmd_restart "$@" ;;
  rollback)     cmd_rollback "$@" ;;
  -h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
