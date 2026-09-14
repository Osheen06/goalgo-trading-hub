#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GOALGO — deploy the latest code from git as a new release.
#
#   cd /opt/goalgo/src && sudo ./deploy/update.sh
#
# Pulls the repository, re-runs deploy.sh (which builds a fresh timestamped
# release and restarts only the goalgo service), and rolls back automatically
# if the new release fails its health check. OpenAlgo is never touched.
# ---------------------------------------------------------------------------
set -euo pipefail

APP_ROOT="${GOALGO_ROOT:-/opt/goalgo}"
PORT="${GOALGO_PORT:-3000}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PREVIOUS="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
echo "Current release: ${PREVIOUS:-none}"

echo "==> Pulling latest code"
git -C "$SRC_DIR" pull --ff-only

echo "==> Re-deploying"
if "$SRC_DIR/deploy/deploy.sh" "$@"; then
  if curl -fsS "http://127.0.0.1:${PORT}/api/public/health" >/dev/null; then
    echo "Update successful."
    exit 0
  fi
fi

echo "Update FAILED." >&2
if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
  echo "Rolling back to $PREVIOUS" >&2
  ln -sfn "$PREVIOUS" "$APP_ROOT/current"
  systemctl restart goalgo
  sleep 3
  curl -fsS "http://127.0.0.1:${PORT}/api/public/health" && echo "Rollback OK."
fi
exit 1
