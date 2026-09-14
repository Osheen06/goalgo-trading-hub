#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GOALGO — verify a running deployment (single-domain architecture).
#
#   ./deploy/health-check.sh                              # local service
#   ./deploy/health-check.sh https://goalgo.fairwoodit.com
#   GOALGO_WEBHOOK_TOKEN=... ./deploy/health-check.sh <url>   # also probes OpenAlgo
#
# Checks the PUBLIC GOALGO URL and the INTERNAL OpenAlgo dependency
# (127.0.0.1:5000, which must never be reachable from the internet).
# Exit code 0 = healthy. Nothing secret is printed.
# ---------------------------------------------------------------------------
set -uo pipefail

BASE="${1:-http://127.0.0.1:${GOALGO_PORT:-3000}}"
OPENALGO_LOCAL="${OPENALGO_LOCAL_URL:-http://127.0.0.1:5000}"
FAIL=0
check() { # name, command
  printf '%-38s' "$1"
  if out="$(eval "$2" 2>&1)"; then echo "OK    $out"; else echo "FAIL  $out"; FAIL=1; fi
}

echo "Checking $BASE"
check "service active" "systemctl is-active goalgo 2>/dev/null || echo 'not managed here'"
check "health endpoint" "curl -fsS --max-time 15 '$BASE/api/public/health'"
check "app shell (HTTP 200)" "curl -o /dev/null -sS -w '%{http_code}' --max-time 15 '$BASE/' | grep -q 200 && echo 200"
check "deep link routing" "curl -o /dev/null -sS -w '%{http_code}' --max-time 15 '$BASE/auth' | grep -q 200 && echo 200"
check "webhook rejects no token" "curl -o /dev/null -sS -w '%{http_code}' --max-time 15 -X POST '$BASE/api/public/webhooks/tradingview' -H 'Content-Type: application/json' -d '{}' | grep -qE '401|503' && echo 'rejected'"

# --- internal OpenAlgo dependency (only meaningful when run on the VPS) -----
if [ -z "${SKIP_OPENALGO_CHECK:-}" ]; then
  check "OpenAlgo service active" "systemctl is-active openalgo 2>/dev/null || echo 'not managed here'"
  check "OpenAlgo answers on localhost" \
    "curl -o /dev/null -sS -w '%{http_code}' --max-time 15 '$OPENALGO_LOCAL' | grep -qE '200|301|302|401|403' && echo 'responding'"
  # OpenAlgo must stay private: its port must not be published on the domain.
  host="${BASE#*://}"; host="${host%%/*}"; host="${host%%:*}"
  if [ -n "$host" ] && [ "$host" != "127.0.0.1" ] && [ "$host" != "localhost" ]; then
    check "OpenAlgo port 5000 not public" \
      "[ \"\$(curl -o /dev/null -s -w '%{http_code}' --max-time 8 'http://$host:5000' || echo 000)\" = 000 ] && echo 'closed to the internet'"
  fi
fi

if [ -n "${GOALGO_WEBHOOK_TOKEN:-}" ]; then
  check "GOALGO -> OpenAlgo reachable" \
    "curl -fsS --max-time 20 -H 'x-goalgo-token: $GOALGO_WEBHOOK_TOKEN' '$BASE/api/public/health?deep=1'"
fi

if [[ "$BASE" == https://* ]]; then
  host="${BASE#https://}"; host="${host%%/*}"
  check "TLS certificate valid" "echo | openssl s_client -servername $host -connect $host:443 2>/dev/null | openssl x509 -noout -enddate"
fi

echo
[ "$FAIL" -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $FAIL
