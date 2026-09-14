#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GOALGO — master deployment for a server that hosts BOTH OpenAlgo and GOALGO
# behind ONE public domain.
#
#   sudo ./deploy/deploy-all.sh            # full run: OpenAlgo (if absent) then GOALGO
#   sudo ./deploy/deploy-all.sh --check    # inspect only, change nothing
#   sudo ./deploy/deploy-all.sh --goalgo-only
#   sudo ./deploy/deploy-all.sh --openalgo-only
#
# Architecture it produces (NO second DNS record required):
#   https://goalgo.fairwoodit.com  -> nginx -> GOALGO   127.0.0.1:3000
#   OpenAlgo                                  127.0.0.1:5000  (private)
#   GOALGO -> OpenAlgo over localhost only.
#
# It never overwrites an existing OpenAlgo install, its .env, its database, its
# certificate or its vhost FILE. It never deletes any nginx configuration file;
# at most it disables a conflicting sites-enabled symlink so exactly one vhost
# owns the public hostname.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${GOALGO_DOMAIN:-goalgo.fairwoodit.com}"
OPENALGO_LOCAL="${GOALGO_OPENALGO_URL:-http://127.0.0.1:5000}"
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
echo "  domain:    $DOMAIN (single public hostname, serves GOALGO)"
echo "  OpenAlgo:  $( [ -d /var/python/openalgo ] && echo present || echo 'not installed' ) — private on $OPENALGO_LOCAL"
echo "  GOALGO:    $( [ -L /opt/goalgo/current ] && echo present || echo 'not installed' )"
echo "  DNS:       $DOMAIN -> $( { getent ahostsv4 "$DOMAIN" 2>/dev/null || true; } | awk '{print $1}' | sort -u | tr '\n' ' ' )"
echo "  nginx sites:"; ls -1 /etc/nginx/sites-enabled 2>/dev/null | sed 's/^/    /' || echo "    (none)"
echo "  listening:"; ss -tln 2>/dev/null | awk 'NR>1{print "    "$4}' | sort -u

if [ "$MODE" = check ]; then
  "$HERE/install-openalgo.sh" --check || true
  bash "$HERE/deploy.sh" --dry-run || true
  echo; echo "Check only — nothing was changed."; exit 0
fi

if [ "$MODE" = all ] || [ "$MODE" = openalgo ]; then
  step "PHASE 1/2 — OpenAlgo (official installer, skipped if already present)"
  "$HERE/install-openalgo.sh"

  step "PHASE 3 — verifying OpenAlgo answers privately on $OPENALGO_LOCAL"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$OPENALGO_LOCAL" || true)"
  echo "  HTTP $CODE"
  if [ "$CODE" = "000" ]; then
    echo "  [STOP] OpenAlgo is not answering on $OPENALGO_LOCAL. Fix it before deploying GOALGO:"
    echo "         systemctl status openalgo ; journalctl -u openalgo -n 100 --no-pager"
    exit 1
  fi
fi

if [ "$MODE" = all ] || [ "$MODE" = goalgo ]; then
  step "PHASE 4 — GOALGO on https://$DOMAIN"
  echo "  (deploy.sh asks for the OpenAlgo API key; get it from the OpenAlgo UI -> API Key,"
  echo "   reachable via: ssh -N -L 5000:127.0.0.1:5000 root@210.56.147.234 then http://localhost:5000)"
  bash "$HERE/deploy.sh" --ssl

  step "PHASE 5 — health checks"
  "$HERE/health-check.sh" "https://$DOMAIN" || true
fi

echo
echo "Done. Open https://$DOMAIN and create the first account (it is linked to the broker connection)."
echo "OpenAlgo admin UI (private): ssh -N -L 5000:127.0.0.1:5000 root@<vps> then http://localhost:5000"
