#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GOALGO — master deployment for a server that hosts BOTH OpenAlgo and GOALGO.
#
#   sudo ./deploy/deploy-all.sh            # full run: OpenAlgo (if absent) then GOALGO
#   sudo ./deploy/deploy-all.sh --check    # inspect only, change nothing
#   sudo ./deploy/deploy-all.sh --goalgo-only
#   sudo ./deploy/deploy-all.sh --openalgo-only
#
# Layout it produces / expects:
#   goalgo.fairwoodit.com      -> OpenAlgo   (official installer, port 5000, own service)
#   app.goalgo.fairwoodit.com  -> GOALGO     (this repo, port 3000, own service)
#
# It never overwrites an existing OpenAlgo install, its .env, its database, its
# certificate or its nginx vhost. It never deletes any nginx configuration.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OA_DOMAIN="${OPENALGO_DOMAIN:-goalgo.fairwoodit.com}"
GG_DOMAIN="${GOALGO_DOMAIN:-app.goalgo.fairwoodit.com}"
MODE=all

for a in "$@"; do
  case "$a" in
    --check) MODE=check ;;
    --goalgo-only) MODE=goalgo ;;
    --openalgo-only) MODE=openalgo ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

step() { echo; echo "############ $1"; }

step "PHASE 0 — inspection"
echo "  OS:        $( . /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-unknown}")"
echo "  OpenAlgo:  $( [ -d /var/python/openalgo ] && echo present || echo 'not installed' )"
echo "  GOALGO:    $( [ -L /opt/goalgo/current ] && echo present || echo 'not installed' )"
echo "  nginx sites:"; ls -1 /etc/nginx/sites-enabled 2>/dev/null | sed 's/^/    /' || echo "    (none)"
echo "  listening:"; ss -tln 2>/dev/null | awk 'NR>1{print "    "$4}' | sort -u

if [ "$MODE" = check ]; then
  "$HERE/install-openalgo.sh" --check || true
  bash "$HERE/deploy.sh" --dry-run || true
  echo; echo "Check only — nothing was changed."; exit 0
fi

if [ "$MODE" = all ] || [ "$MODE" = openalgo ]; then
  step "PHASE 1/2 — OpenAlgo on $OA_DOMAIN (official installer, skipped if present)"
  "$HERE/install-openalgo.sh"

  step "PHASE 3 — verifying OpenAlgo answers on https://$OA_DOMAIN"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$OA_DOMAIN" || true)"
  echo "  HTTP $CODE"
  if [ "$CODE" = "000" ]; then
    echo "  [STOP] OpenAlgo is not reachable. Fix it before deploying GOALGO:"
    echo "         systemctl status openalgo ; journalctl -u openalgo -n 100 --no-pager ; nginx -t"
    exit 1
  fi
fi

if [ "$MODE" = all ] || [ "$MODE" = goalgo ]; then
  step "PHASE 4 — GOALGO on $GG_DOMAIN"
  echo "  (deploy.sh asks for the OpenAlgo API key; get it from the OpenAlgo UI -> API Key)"
  bash "$HERE/deploy.sh" --ssl

  step "PHASE 5 — health checks"
  "$HERE/health-check.sh" "https://$GG_DOMAIN" || true
  echo "  OpenAlgo still answers: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$OA_DOMAIN" || echo 000)"
fi

echo
echo "Done. Open https://$GG_DOMAIN and create the first account (it becomes the owner)."
echo "OpenAlgo dashboard: https://$OA_DOMAIN"
