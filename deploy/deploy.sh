#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GOALGO — one-command production deployment for Ubuntu 24.
#
#   sudo ./deploy/deploy.sh              # install or re-deploy (interactive setup on first run)
#   sudo ./deploy/deploy.sh --ssl        # also request/renew the TLS certificate
#   sudo ./deploy/deploy.sh --no-nginx   # skip web-server configuration
#   sudo ./deploy/deploy.sh --skip-dns   # deploy before DNS has propagated
#   ./deploy/deploy.sh --dry-run         # run all checks + env setup, change nothing else
#
# Architecture (single public domain, no extra DNS record):
#   https://goalgo.fairwoodit.com/  -> GOALGO   (127.0.0.1:3000, this script)
#   OpenAlgo                        -> 127.0.0.1:5000, private, not published
#   GOALGO talks to OpenAlgo over localhost only.
#
# Safety guarantees:
#   * Touches ONLY /opt/goalgo, /etc/goalgo, the goalgo systemd unit and the
#     goalgo.fairwoodit.com nginx site.
#   * Never reads, edits, reloads or restarts the OpenAlgo service, its .env,
#     its certificate or its database. If OpenAlgo's installer left an nginx
#     site claiming this domain, the symlink is disabled (the file is kept)
#     so one vhost owns the hostname — nothing is deleted.
#   * Refuses to continue if the chosen port is already in use by someone else.
#   * Idempotent: existing secrets, releases, services and certificates are
#     preserved; only missing pieces are created.
#   * Every release lands in its own directory; `current` is a symlink, so
#     rollback.sh is an instant swap.
# ---------------------------------------------------------------------------
set -euo pipefail

DOMAIN="${GOALGO_DOMAIN:-goalgo.fairwoodit.com}"
EXPECTED_IP="${GOALGO_EXPECTED_IP:-210.56.147.234}"
OPENALGO_URL_DEFAULT="${GOALGO_OPENALGO_URL:-http://127.0.0.1:5000}"
# Optional, space separated: public paths that must reach OpenAlgo directly
# (broker OAuth callbacks only). Empty by default — OpenAlgo stays private.
OPENALGO_PUBLIC_PATHS="${OPENALGO_PUBLIC_PATHS:-}"
APP_ROOT="${GOALGO_ROOT:-/opt/goalgo}"
ENV_FILE="${GOALGO_ENV_FILE:-/etc/goalgo/goalgo.env}"
SERVICE="goalgo"
APP_USER="goalgo"
PORT="${GOALGO_PORT:-3000}"

# Public Supabase project values for this GOALGO deployment. These are public
# by design (they are the same values shipped in the browser bundle).
SUPABASE_URL_DEFAULT="${GOALGO_SUPABASE_URL:-https://uzlvvmgfjzgosgaelnrh.supabase.co}"
SUPABASE_PUBLISHABLE_DEFAULT="${GOALGO_SUPABASE_PUBLISHABLE_KEY:-sb_publishable_EwOIaH0OjjA_pV8EkXIa-A_gTOoNoBp}"

DO_SSL=0
DO_NGINX=1
DO_DNS=1
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --ssl) DO_SSL=1 ;;
    --no-nginx) DO_NGINX=0 ;;
    --skip-dns) DO_DNS=0 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STEPS_OK=(); STEPS_SKIP=(); STEPS_FAIL=()
ok()   { STEPS_OK+=("$1");   echo "  [ ok ] $1"; }
skip() { STEPS_SKIP+=("$1"); echo "  [skip] $1"; }
die()  { STEPS_FAIL+=("$1"); echo "  [FAIL] $1" >&2; summary; exit 1; }
step() { echo; echo "==> $1"; }

summary() {
  echo
  echo "──────── DEPLOYMENT SUMMARY ────────"
  for s in "${STEPS_OK[@]:-}";   do [ -n "$s" ] && echo "  OK      $s"; done
  for s in "${STEPS_SKIP[@]:-}"; do [ -n "$s" ] && echo "  SKIPPED $s"; done
  for s in "${STEPS_FAIL[@]:-}"; do [ -n "$s" ] && echo "  FAILED  $s"; done
  echo "────────────────────────────────────"
}

# --- env-file helpers (never print values) ----------------------------------
env_get() { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | head -n1; }
env_has() { [ -n "$(env_get "$1")" ]; }

env_set() { # env_set KEY VALUE  — replaces or appends, never echoes the value
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"; chmod 600 "$tmp"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp" 2>/dev/null || true
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

env_default() { # env_default KEY VALUE LABEL — only fills when missing/empty
  if env_has "$1"; then skip "$3 already configured (kept)"; else env_set "$1" "$2"; ok "$3 set automatically"; fi
}

prompt_secret() { # prompt_secret KEY "Prompt text" required|optional "where to find it"
  local key="$1" text="$2" mode="$3" hint="${4:-}" value=""
  if env_has "$key"; then skip "$key already configured (kept, never printed)"; return; fi
  # Unattended installs may pass the value through the environment.
  if [ -n "${!key:-}" ]; then env_set "$key" "${!key}"; ok "$key taken from the environment (never printed)"; return; fi
  if [ ! -t 0 ]; then

    if [ "$mode" = required ]; then
      die "$key is missing and this shell is not interactive — run the script from an SSH terminal, or set it with: sudo install -m 600 -o root -g $APP_USER /dev/stdin $ENV_FILE"
    fi
    skip "$key not set (non-interactive run) — ${hint}"
    return
  fi
  echo
  echo "  $text"
  [ -n "$hint" ] && echo "  ($hint)"
  [ "$mode" = optional ] && echo "  Press Enter to skip — GOALGO will show this feature as 'not configured'."
  while true; do
    read -rs -p "  > " value; echo
    if [ -n "$value" ]; then break; fi
    if [ "$mode" = optional ]; then skip "$key left empty — ${hint}"; return; fi
    echo "  A value is required."
  done
  env_set "$key" "$value"
  unset value
  ok "$key stored in $ENV_FILE (never printed, file mode 600)"
}

# --- 1. preflight -----------------------------------------------------------
step "Validating prerequisites"
if [ "$DRY_RUN" -eq 0 ]; then
  [ "$(id -u)" -eq 0 ] || die "Run with sudo (root required for systemd and nginx)"
fi
if [ -r /etc/os-release ]; then
  . /etc/os-release
  case "${VERSION_ID:-}" in
    24.*) ok "Ubuntu ${VERSION_ID}" ;;
    *) echo "  [warn] expected Ubuntu 24.x, found ${PRETTY_NAME:-unknown} — continuing" ;;
  esac
fi
command -v node >/dev/null || die "node is not installed — run: curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required, found $(node -v)"
ok "node $(node -v)"
command -v npm >/dev/null || die "npm is not installed"
command -v openssl >/dev/null || die "openssl is not installed — run: apt-get install -y openssl"
command -v curl >/dev/null || die "curl is not installed — run: apt-get install -y curl"
if [ "$DO_NGINX" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
  command -v nginx >/dev/null || die "nginx is not installed — run: apt-get install -y nginx"
  ok "nginx present ($(nginx -v 2>&1))"
fi

# --- 2. DNS check -----------------------------------------------------------
step "Checking DNS for $DOMAIN"
if [ "$DO_DNS" -eq 0 ]; then
  skip "DNS check disabled (--skip-dns)"
else
  RESOLVED="$( { getent ahostsv4 "$DOMAIN" 2>/dev/null || true; } | awk '{print $1}' | sort -u | tr '\n' ' ' | sed 's/ $//')"
  if [ -z "$RESOLVED" ]; then
    die "$DOMAIN does not resolve yet. MANUAL ACTION: confirm this existing DNS record at your domain provider, wait a few minutes, then re-run:
           Type: A    Name: goalgo (or @, as your zone requires)    Value: $EXPECTED_IP    TTL: 300
         (Deploy anyway without HTTPS using: sudo ./deploy/deploy.sh --skip-dns)"
  elif ! grep -qw "$EXPECTED_IP" <<<"$RESOLVED"; then
    die "$DOMAIN resolves to '$RESOLVED' but this deployment expects $EXPECTED_IP.
         MANUAL ACTION: fix the A record (Type: A, Name: goalgo, Value: $EXPECTED_IP) or re-run with GOALGO_EXPECTED_IP=<correct ip>."
  else
    ok "$DOMAIN -> $EXPECTED_IP"
  fi
fi

# --- 3. OpenAlgo safety check (private, localhost only) ---------------------
step "Checking the local OpenAlgo service (never modified by this script)"
OA_HOST="$(sed -E 's#^https?://##; s#/.*$##' <<<"$OPENALGO_URL_DEFAULT")"
case "$OA_HOST" in
  127.0.0.1|localhost|"[::1]") ok "OPENALGO_BASE_URL is local ($OPENALGO_URL_DEFAULT) — OpenAlgo is not published" ;;
  *) echo "  [warn] OPENALGO_BASE_URL points at $OA_HOST, not localhost. The single-domain design expects http://127.0.0.1:5000." ;;
esac
OA_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$OPENALGO_URL_DEFAULT" || true)"
if [ "$OA_CODE" = "000" ]; then
  echo "  [warn] $OPENALGO_URL_DEFAULT did not answer. GOALGO will still deploy and will honestly report OpenAlgo as unreachable."
  echo "         Check it with: systemctl status openalgo ; journalctl -u openalgo -n 100 --no-pager"
else
  ok "OpenAlgo answers on $OPENALGO_URL_DEFAULT (HTTP $OA_CODE) — service left untouched"
fi
if [ "$DO_NGINX" -eq 1 ] && [ -d /etc/nginx/sites-enabled ]; then
  # OpenAlgo's official installer may have created its own vhost for this same
  # hostname. Only one vhost can own it. Disable the symlink, keep the file.
  while IFS= read -r site; do
    [ -n "$site" ] || continue
    [ "$(basename "$site")" = "$DOMAIN" ] && continue
    # Removing the symlink only. The configuration file in sites-available and
    # any certificate it references stay exactly where they are.
    rm -f "$site"
    ok "another vhost claimed $DOMAIN ($site) — symlink disabled; the file in sites-available is untouched"
  done < <(grep -rl "server_name[^;]*\b${DOMAIN}\b" /etc/nginx/sites-enabled/ 2>/dev/null || true)
fi

# --- 4. port conflict detection --------------------------------------------
step "Checking port $PORT"
if ss -tlnp 2>/dev/null | grep -qE "(127\.0\.0\.1|0\.0\.0\.0|\[::\]|\*):${PORT}[[:space:]]"; then
  if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
    ok "port $PORT already held by the GOALGO service (re-deploy)"
  else
    die "port $PORT is used by another process (possibly OpenAlgo). Re-run as: sudo GOALGO_PORT=<free port> ./deploy/deploy.sh"
  fi
else
  ok "port $PORT is free"
fi

# --- 5. user, directories ---------------------------------------------------
step "Preparing system user and directories"
if [ "$DRY_RUN" -eq 0 ]; then
  id -u "$APP_USER" >/dev/null 2>&1 || adduser --system --group --home "$APP_ROOT" "$APP_USER" >/dev/null
  mkdir -p "$APP_ROOT/releases" "$(dirname "$ENV_FILE")"
  chown -R "$APP_USER:$APP_USER" "$APP_ROOT"
  ok "user '$APP_USER' and $APP_ROOT ready"
else
  mkdir -p "$(dirname "$ENV_FILE")"
  skip "system user/directories (dry run)"
fi

# --- 6. environment configuration (idempotent, interactive for secrets) -----
step "Configuring $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  : > "$ENV_FILE"
  printf '# GOALGO production environment — generated by deploy.sh. Never commit this file.\n' >> "$ENV_FILE"
  ok "created $ENV_FILE"
else
  ok "existing $ENV_FILE found — existing values are preserved"
fi
chmod 600 "$ENV_FILE"
[ "$DRY_RUN" -eq 0 ] && chown root:"$APP_USER" "$ENV_FILE"

env_default NODE_ENV production                        "NODE_ENV"
env_default PORT "$PORT"                               "PORT"
env_default HOST 127.0.0.1                             "HOST"
env_default APP_URL "https://${DOMAIN}"                "APP_URL (https://${DOMAIN})"
env_default OPENALGO_BASE_URL "$OPENALGO_URL_DEFAULT"  "OPENALGO_BASE_URL ($OPENALGO_URL_DEFAULT)"
env_default SUPABASE_URL "$SUPABASE_URL_DEFAULT"       "SUPABASE_URL (public)"
env_default VITE_SUPABASE_URL "$SUPABASE_URL_DEFAULT"  "VITE_SUPABASE_URL (public)"
env_default SUPABASE_PUBLISHABLE_KEY "$SUPABASE_PUBLISHABLE_DEFAULT"      "SUPABASE_PUBLISHABLE_KEY (public)"
env_default VITE_SUPABASE_PUBLISHABLE_KEY "$SUPABASE_PUBLISHABLE_DEFAULT" "VITE_SUPABASE_PUBLISHABLE_KEY (public)"

# Webhook token: generated once, reused forever.
if env_has GOALGO_WEBHOOK_TOKEN; then
  skip "GOALGO_WEBHOOK_TOKEN already present (kept — regenerating would break TradingView)"
else
  env_set GOALGO_WEBHOOK_TOKEN "$(openssl rand -hex 32)"
  ok "GOALGO_WEBHOOK_TOKEN generated with openssl rand -hex 32 (value never printed; read it later on the TradingView page inside GOALGO)"
fi

prompt_secret OPENALGO_API_KEY \
  "OpenAlgo API key (input hidden):" required \
  "OpenAlgo web UI -> API Key. Server-side only; never sent to the browser."

prompt_secret SUPABASE_SERVICE_ROLE_KEY \
  "Supabase service-role key (input hidden):" optional \
  "Only needed so inbound TradingView webhooks can be recorded. Without it every signed-in page still works and the webhook endpoint replies 'not configured'."

prompt_secret OPENALGO_STRATEGY_WEBHOOK_URL \
  "OpenAlgo strategy webhook URL (input hidden):" optional \
  "OpenAlgo web UI -> Strategy -> your strategy -> Webhook URL. OpenAlgo exposes no API that lists it, so it must be pasted once. Until then GOALGO shows 'TradingView not configured' and everything else runs."

# GOALGO_OWNER_USER_ID is intentionally NOT requested: the first account that
# registers in GOALGO claims ownership in the database automatically.

MISSING=()
for key in OPENALGO_BASE_URL OPENALGO_API_KEY GOALGO_WEBHOOK_TOKEN SUPABASE_URL \
           VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY APP_URL; do
  env_has "$key" || MISSING+=("$key")
done
[ "${#MISSING[@]}" -eq 0 ] || die "these variables are still empty in $ENV_FILE: ${MISSING[*]}"
ok "$ENV_FILE complete (values never printed)"

if [ "$DRY_RUN" -eq 1 ]; then
  summary
  echo
  echo "Dry run finished — no build, service or nginx changes were made."
  exit 0
fi

# --- 7. build a new release -------------------------------------------------
step "Building release"
RELEASE="$APP_ROOT/releases/$(date +%Y%m%d%H%M%S)"
mkdir -p "$RELEASE"
tar -C "$SRC_DIR" \
    --exclude=.git --exclude=node_modules --exclude=.output --exclude=dist \
    -cf - . | tar -C "$RELEASE" -xf -
chown -R "$APP_USER:$APP_USER" "$RELEASE"
# Build-time public variables come from the env file.
set -a; # shellcheck disable=SC1090
source <(grep -E '^(VITE_[A-Z0-9_]+|APP_URL)=' "$ENV_FILE"); set +a
sudo -u "$APP_USER" --preserve-env=VITE_SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY,APP_URL \
  bash -lc "cd '$RELEASE' && npm ci --no-audit --no-fund && NITRO_PRESET=node_server npm run build" \
  || die "build failed (see output above) — the previous release is still live"
[ -f "$RELEASE/.output/server/index.mjs" ] || die "build produced no Node server output — check NITRO_PRESET support"
ln -sfn "$RELEASE" "$APP_ROOT/current"
ok "release built at $RELEASE and linked as $APP_ROOT/current"
# Keep the five most recent releases so rollback.sh always has targets.
ls -1dt "$APP_ROOT"/releases/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf

# --- 8. systemd service -----------------------------------------------------
step "Configuring the GOALGO service"
sed "s#^Environment=PORT=.*#Environment=PORT=${PORT}#" \
    "$SRC_DIR/deploy/goalgo.service" > /etc/systemd/system/${SERVICE}.service
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
ok "systemd unit installed, enabled at boot and (re)started"

# --- 9. local health check --------------------------------------------------
step "Waiting for GOALGO to answer locally"
HEALTH=""
for _ in $(seq 1 30); do
  HEALTH="$(curl -fsS "http://127.0.0.1:${PORT}/api/public/health" 2>/dev/null || true)"
  [ -n "$HEALTH" ] && break
  sleep 1
done
[ -n "$HEALTH" ] || die "service did not become healthy — inspect: journalctl -u $SERVICE -n 100 --no-pager"
ok "local health: $HEALTH"

# --- 10. nginx --------------------------------------------------------------
if [ "$DO_NGINX" -eq 1 ]; then
  step "Configuring nginx for $DOMAIN (OpenAlgo's site is left untouched)"
  CONFLICT="$(grep -rl "server_name[^;]*\b${DOMAIN}\b" /etc/nginx/sites-enabled/ 2>/dev/null \
              | grep -v "${DOMAIN}$" || true)"
  [ -z "$CONFLICT" ] || die "another nginx site already claims $DOMAIN: $CONFLICT — resolve manually"
  cp "$SRC_DIR/deploy/nginx-goalgo.conf" /etc/nginx/sites-available/"$DOMAIN".src
  if [ -f /etc/nginx/sites-available/"$DOMAIN" ]; then
    skip "existing /etc/nginx/sites-available/$DOMAIN kept (certbot may manage it); reference copy saved as ${DOMAIN}.src"
  else
    if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
      sed -e "s#proxy_pass http://127.0.0.1:3000;#proxy_pass http://127.0.0.1:${PORT};#g" \
          "$SRC_DIR/deploy/nginx-goalgo.conf" > /etc/nginx/sites-available/"$DOMAIN"
    else
      # Before certificates exist, serve plain HTTP only; certbot adds TLS later.
      printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n    location /.well-known/acme-challenge/ { root /var/www/html; }\n    location / {\n        proxy_pass http://127.0.0.1:%s;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection $connection_upgrade;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n' "$DOMAIN" "$PORT" > /etc/nginx/sites-available/"$DOMAIN"
    fi
    ok "created /etc/nginx/sites-available/$DOMAIN"
  fi
  # Required http{}-level directives, added in a separate file so nginx.conf is untouched.
  if ! grep -rq "zone=goalgo_hook" /etc/nginx/conf.d/ /etc/nginx/nginx.conf 2>/dev/null; then
    cat > /etc/nginx/conf.d/goalgo-common.conf <<'NGINX'
# Added by GOALGO deploy.sh — does not affect other sites.
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
limit_req_zone $binary_remote_addr zone=goalgo_hook:10m rate=10r/s;
NGINX
    ok "added /etc/nginx/conf.d/goalgo-common.conf"
  else
    skip "nginx shared directives already present"
  fi
  ln -sfn /etc/nginx/sites-available/"$DOMAIN" /etc/nginx/sites-enabled/"$DOMAIN"
  nginx -t >/dev/null 2>&1 || { nginx -t; die "nginx configuration test failed — nothing was reloaded"; }
  systemctl reload nginx
  ok "nginx validated and reloaded (OpenAlgo site untouched)"

  # --- 11. SSL --------------------------------------------------------------
  if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    skip "TLS certificate for $DOMAIN already exists (renewal is handled by certbot's timer)"
  elif [ "$DO_SSL" -eq 1 ] || [ "$DO_DNS" -eq 1 ]; then
    step "Requesting the TLS certificate for $DOMAIN"
    if ! command -v certbot >/dev/null; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1 || true
    fi
    if ! command -v certbot >/dev/null; then
      skip "certbot unavailable — install it and re-run: apt-get install -y certbot python3-certbot-nginx"
    elif certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect \
           -m "${CERTBOT_EMAIL:-admin@fairwoodit.com}" >/dev/null 2>&1; then
      nginx -t >/dev/null && systemctl reload nginx
      ok "HTTPS active for https://$DOMAIN (OpenAlgo's certificate untouched)"
    else
      skip "certbot could not issue a certificate — DNS must point at this server and ports 80/443 must be open. Retry: certbot --nginx -d $DOMAIN"
    fi
  else
    skip "TLS certificate (DNS check was skipped; re-run with --ssl once DNS points here)"
  fi
else
  skip "nginx configuration (--no-nginx)"
fi

summary
echo
echo "GOALGO is running on 127.0.0.1:${PORT} as systemd service '${SERVICE}'."
echo "Open:    https://${DOMAIN}   → create the first account; it becomes the owner automatically."
echo "Verify:  ./deploy/health-check.sh https://${DOMAIN}"
echo "Logs:    journalctl -u ${SERVICE} -f"
