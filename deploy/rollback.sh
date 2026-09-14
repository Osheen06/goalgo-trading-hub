#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GOALGO — switch back to a previous release.
#
#   sudo ./deploy/rollback.sh            # previous release
#   sudo ./deploy/rollback.sh 20260914T  # a specific release directory name
#   ./deploy/rollback.sh --list          # show available releases
# ---------------------------------------------------------------------------
set -euo pipefail

APP_ROOT="${GOALGO_ROOT:-/opt/goalgo}"
PORT="${GOALGO_PORT:-3000}"
RELEASES="$APP_ROOT/releases"

mapfile -t ALL < <(ls -1 "$RELEASES" | sort)
CURRENT="$(basename "$(readlink -f "$APP_ROOT/current")")"

if [ "${1:-}" = "--list" ]; then
  for r in "${ALL[@]}"; do
    [ "$r" = "$CURRENT" ] && echo "* $r (current)" || echo "  $r"
  done
  exit 0
fi

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  for i in "${!ALL[@]}"; do
    if [ "${ALL[$i]}" = "$CURRENT" ] && [ "$i" -gt 0 ]; then TARGET="${ALL[$((i-1))]}"; fi
  done
fi
[ -n "$TARGET" ] || { echo "No earlier release to roll back to." >&2; exit 1; }
[ -d "$RELEASES/$TARGET" ] || { echo "No such release: $TARGET" >&2; exit 1; }

echo "Rolling back: $CURRENT -> $TARGET"
ln -sfn "$RELEASES/$TARGET" "$APP_ROOT/current"
systemctl restart goalgo
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/public/health"; then echo; echo "Rollback complete."; exit 0; fi
  sleep 1
done
echo "Service did not become healthy after rollback — journalctl -u goalgo -n 100 --no-pager" >&2
exit 1
