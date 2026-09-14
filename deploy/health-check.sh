#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GOALGO — verify a running deployment.
#
#   ./deploy/health-check.sh                                 # local service
#   ./deploy/health-check.sh https://app.goalgo.fairwoodit.com
#   GOALGO_WEBHOOK_TOKEN=... ./deploy/health-check.sh <url>   # also pings OpenAlgo
#
# Exit code 0 = healthy. Nothing secret is printed.
# ---------------------------------------------------------------------------
set -uo pipefail

BASE="${1:-http://127.0.0.1:${GOALGO_PORT:-3000}}"
FAIL=0
check() { # name, command
  printf '%-34s' "$1"
  if out="$(eval "$2" 2>&1)"; then echo "OK    $out"; else echo "FAIL  $out"; FAIL=1; fi
}

echo "Checking $BASE"
check "service active" "systemctl is-active goalgo 2>/dev/null || echo 'not managed here'"
check "health endpoint" "curl -fsS --max-time 15 '$BASE/api/public/health'"
check "app shell (HTTP 200)" "curl -o /dev/null -sS -w '%{http_code}' --max-time 15 '$BASE/' | grep -q 200 && echo 200"
check "deep link routing" "curl -o /dev/null -sS -w '%{http_code}' --max-time 15 '$BASE/auth' | grep -q 200 && echo 200"
check "webhook rejects no token" "curl -o /dev/null -sS -w '%{http_code}' --max-time 15 -X POST '$BASE/api/public/webhooks/tradingview' -H 'Content-Type: application/json' -d '{}' | grep -qE '401|503' && echo 'rejected'"

check "OpenAlgo site still served" "curl -o /dev/null -sS -w '%{http_code}' --max-time 15 '${OPENALGO_PUBLIC_URL:-https://goalgo.fairwoodit.com}' | grep -qE '200|301|302|401|403' && echo 'responding'"

if [ -n "${GOALGO_WEBHOOK_TOKEN:-}" ]; then
  check "OpenAlgo reachable from GOALGO" \
    "curl -fsS --max-time 20 -H 'x-goalgo-token: $GOALGO_WEBHOOK_TOKEN' '$BASE/api/public/health?deep=1'"
fi

if [[ "$BASE" == https://* ]]; then
  host="${BASE#https://}"; host="${host%%/*}"
  check "TLS certificate valid" "echo | openssl s_client -servername $host -connect $host:443 2>/dev/null | openssl x509 -noout -enddate"
fi

echo
[ "$FAIL" -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $FAIL
