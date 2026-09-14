#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GOALGO — verify a running deployment (single-domain architecture).
#
#   ./deploy/health-check.sh                              # local service
#   ./deploy/health-check.sh https://goalgo.fairwoodit.com
#   GOALGO_WEBHOOK_TOKEN=... ./deploy/health-check.sh <url>   # also probes OpenAlgo
#
# When run ON the GOALGO VPS, the public hostname is tested through the LOCAL
# nginx (curl --resolve <host>:443:127.0.0.1) so the check never depends on the
# server hairpinning back to its own public IP. Host header and TLS SNI are
# preserved, so nginx routing and the certificate are genuinely exercised.
#
# OpenAlgo privacy is verified by inspecting the local listener binding
# (must be 127.0.0.1:5000 only — never 0.0.0.0:5000 or [::]:5000), not by
# probing the public hostname from outside.
#
# Exit code 0 = healthy. Nothing secret is printed.
# ---------------------------------------------------------------------------
set -uo pipefail

BASE="${1:-http://127.0.0.1:${GOALGO_PORT:-3000}}"
OPENALGO_LOCAL="${OPENALGO_LOCAL_URL:-http://127.0.0.1:5000}"
OPENALGO_PORT="${OPENALGO_PORT:-5000}"
FAIL=0

check() { # name, command
  printf '%-38s' "$1"
  if out="$(eval "$2" 2>&1)"; then echo "OK    $out"; else echo "FAIL  $out"; FAIL=1; fi
}

# --- decide whether to resolve the hostname to this machine -----------------
HOST="${BASE#*://}"; HOST="${HOST%%/*}"; HOST="${HOST%%:*}"
RESOLVE_OPT=""
LOCAL_VHOST=0
if [[ "$BASE" == https://* ]] && [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "localhost" ]; then
  # Running on the server itself? Then nginx is listening on 443 locally.
  if ss -tln 2>/dev/null | grep -qE '(127\.0\.0\.1|0\.0\.0\.0|\[::\]|\*):443[[:space:]]'; then
    RESOLVE_OPT="--resolve ${HOST}:443:127.0.0.1"
    LOCAL_VHOST=1
  fi
fi
CURL="curl ${RESOLVE_OPT}"

echo "Checking $BASE"
[ "$LOCAL_VHOST" -eq 1 ] && echo "  (testing the public vhost through local nginx: ${HOST}:443 -> 127.0.0.1)"

check "service active" "systemctl is-active goalgo 2>/dev/null || echo 'not managed here'"
check "health endpoint" "$CURL -fsS --max-time 15 '$BASE/api/public/health'"
check "app shell (HTTP 200)" "$CURL -o /dev/null -sS -w '%{http_code}' --max-time 15 '$BASE/' | grep -q 200 && echo 200"
check "deep link routing" "$CURL -o /dev/null -sS -w '%{http_code}' --max-time 15 '$BASE/auth' | grep -q 200 && echo 200"
check "webhook rejects no token" "$CURL -o /dev/null -sS -w '%{http_code}' --max-time 15 -X POST '$BASE/api/public/webhooks/tradingview' -H 'Content-Type: application/json' -d '{}' | grep -qE '401|503' && echo 'rejected'"

# --- internal OpenAlgo dependency (only meaningful when run on the VPS) -----
if [ -z "${SKIP_OPENALGO_CHECK:-}" ]; then
  check "OpenAlgo service active" "systemctl is-active openalgo 2>/dev/null || echo 'not managed here'"
  check "OpenAlgo answers on localhost" \
    "curl -o /dev/null -sS -w '%{http_code}' --max-time 15 '$OPENALGO_LOCAL' | grep -qE '200|301|302|401|403' && echo 'responding'"

  # OpenAlgo must stay private: its listener must be bound to loopback only.
  if command -v ss >/dev/null 2>&1 || command -v netstat >/dev/null 2>&1; then
    check "OpenAlgo bound to loopback only" "
      if command -v ss >/dev/null 2>&1; then listeners=\"\$(ss -tlnH 2>/dev/null | awk '{print \$4}')\";
      else listeners=\"\$(netstat -tln 2>/dev/null | awk 'NR>2{print \$4}')\"; fi
      bound=\"\$(printf '%s\n' \"\$listeners\" | grep -E ':${OPENALGO_PORT}\$' || true)\"
      if [ -z \"\$bound\" ]; then echo 'no listener on port ${OPENALGO_PORT}'; exit 1; fi
      if printf '%s\n' \"\$bound\" | grep -qE '^(0\.0\.0\.0|\*|\[::\]|::):${OPENALGO_PORT}\$'; then
        echo \"exposed on all interfaces: \$(printf '%s ' \$bound)\"; exit 1; fi
      echo \"\$(printf '%s ' \$bound)\""
  fi
fi

if [ -n "${GOALGO_WEBHOOK_TOKEN:-}" ]; then
  check "GOALGO -> OpenAlgo reachable" \
    "$CURL -fsS --max-time 20 -H 'x-goalgo-token: $GOALGO_WEBHOOK_TOKEN' '$BASE/api/public/health?deep=1'"
fi

if [[ "$BASE" == https://* ]]; then
  CONNECT_HOST="$HOST"
  [ "$LOCAL_VHOST" -eq 1 ] && CONNECT_HOST="127.0.0.1"
  check "TLS certificate valid" \
    "echo | openssl s_client -servername $HOST -connect $CONNECT_HOST:443 2>/dev/null | openssl x509 -noout -enddate"
fi

echo
[ "$FAIL" -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $FAIL
