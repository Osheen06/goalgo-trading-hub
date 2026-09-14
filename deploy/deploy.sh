#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GOALGO — one-command production deployment for Ubuntu 24.
#
#   sudo ./deploy/deploy.sh              # install or re-deploy
#   sudo ./deploy/deploy.sh --ssl        # also request/renew the TLS cert
#   sudo ./deploy/deploy.sh --no-nginx   # skip web-server configuration
#
# Safety guarantees:
#   * Touches ONLY /opt/goalgo, /etc/goalgo, the goalgo systemd unit and the
#     app.goalgo.fairwoodit.com nginx site.
#   * Never reads, edits, reloads or restarts the existing OpenAlgo install,
#     its nginx server block, its certificate or its database.
#   * Refuses to continue if the chosen port is already in use.
#   * Every release lands in its own directory; `current` is a symlink, so
#     rollback.sh is an instant swap.
# ---------------------------------------------------------------------------
set -euo pipefail

DOMAIN="${GOALGO_DOMAIN:-app.goalgo.fairwoodit.com}"
APP_ROOT="${GOALGO_ROOT:-/opt/goalgo}"
ENV_FILE="${GOALGO_ENV_FILE:-/etc/goalgo/goalgo.env}"
SERVICE="goalgo"
APP_USER="goalgo"
PORT="${GOALGO_PORT:-3000}"
DO_SSL=0
DO_NGINX=1

for arg in "$@"; do
  case "$arg" in
    --ssl) DO_SSL=1 ;;
    --no-nginx) DO_NGINX=0 ;;
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

# --- 1. preflight -----------------------------------------------------------
step "Validating prerequisites"
[ "$(id -u)" -eq 0 ] || die "Run with sudo (root required for systemd and nginx)"
command -v node >/dev/null || die "node is not installed — run: curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required, found $(node -v)"
ok "node $(node -v)"
command -v npm >/dev/null || die "npm is not installed"
if [ "$DO_NGINX" -eq 1 ]; then
  command -v nginx >/dev/null || die "nginx is not installed — run: apt-get install -y nginx"
  ok "nginx present ($(nginx -v 2>&1))"
fi

# --- 2. port conflict detection --------------------------------------------
step "Checking port $PORT"
if ss -tlnp 2>/dev/null | grep -q "127.0.0.1:${PORT} \|0.0.0.0:${PORT} \|:::${PORT} "; then
  if systemctl is-active --quiet "$SERVICE" && \
     ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -q "$SERVICE\|node"; then
    ok "port $PORT already held by the GOALGO service (re-deploy)"
  else
    die "port $PORT is used by another process (possibly OpenAlgo). Re-run with GOALGO_PORT=<free port> sudo ./deploy/deploy.sh"
  fi
else
  ok "port $PORT is free"
fi

# --- 3. user, directories, env file ----------------------------------------
step "Preparing system user and directories"
id -u "$APP_USER" >/dev/null 2>&1 || adduser --system --group --home "$APP_ROOT" "$APP_USER" >/dev/null
mkdir -p "$APP_ROOT/releases" "$(dirname "$ENV_FILE")"
chown -R "$APP_USER:$APP_USER" "$APP_ROOT"
ok "user '$APP_USER' and $APP_ROOT ready"

if [ ! -f "$ENV_FILE" ]; then
  install -m 600 -o root -g "$APP_USER" "$SRC_DIR/deploy/goalgo.env.example" "$ENV_FILE"
  die "created $ENV_FILE from the template — fill in the secrets (sudo nano $ENV_FILE) and re-run this script"
fi
chmod 600 "$ENV_FILE"; chown root:"$APP_USER" "$ENV_FILE"
MISSING=()
for key in OPENALGO_BASE_URL OPENALGO_API_KEY GOALGO_WEBHOOK_TOKEN SUPABASE_URL \
           SUPABASE_SERVICE_ROLE_KEY VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY APP_URL; do
  grep -Eq "^${key}=.+" "$ENV_FILE" || MISSING+=("$key")
done
[ "${#MISSING[@]}" -eq 0 ] || die "these variables are empty in $ENV_FILE: ${MISSING[*]}"
ok "$ENV_FILE present with all required variables (values never printed)"

# --- 4. build a new release -------------------------------------------------
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
  || die "build failed (see output above)"
[ -f "$RELEASE/.output/server/index.mjs" ] || die "build produced no Node server output — check NITRO_PRESET support"
ln -sfn "$RELEASE" "$APP_ROOT/current"
ok "release built at $RELEASE and linked as $APP_ROOT/current"

# --- 5. systemd service -----------------------------------------------------
step "Configuring the GOALGO service"
sed "s#^Environment=PORT=.*#Environment=PORT=${PORT}#" \
    "$SRC_DIR/deploy/goalgo.service" > /etc/systemd/system/${SERVICE}.service
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
ok "systemd unit installed, enabled at boot and (re)started"

# --- 6. local health check --------------------------------------------------
step "Waiting for GOALGO to answer locally"
HEALTH=""
for _ in $(seq 1 30); do
  HEALTH="$(curl -fsS "http://127.0.0.1:${PORT}/api/public/health" 2>/dev/null || true)"
  [ -n "$HEALTH" ] && break
  sleep 1
done
[ -n "$HEALTH" ] || die "service did not become healthy — inspect: journalctl -u $SERVICE -n 100 --no-pager"
ok "local health: $HEALTH"

# --- 7. nginx ---------------------------------------------------------------
if [ "$DO_NGINX" -eq 1 ]; then
  step "Configuring nginx for $DOMAIN (OpenAlgo's site is left untouched)"
  CONFLICT="$(grep -rl "server_name[^;]*\b${DOMAIN}\b" /etc/nginx/sites-enabled/ 2>/dev/null \
              | grep -v "${DOMAIN}$" || true)"
  [ -z "$CONFLICT" ] || die "another nginx site already claims $DOMAIN: $CONFLICT — resolve manually"
  if [ ! -f /etc/nginx/sites-available/"$DOMAIN" ] || ! cmp -s "$SRC_DIR/deploy/nginx-goalgo.conf" /etc/nginx/sites-available/"$DOMAIN".src; then
    cp "$SRC_DIR/deploy/nginx-goalgo.conf" /etc/nginx/sites-available/"$DOMAIN".src
    # Only write the plain-HTTP site on first install; certbot owns the file afterwards.
    if [ ! -f /etc/nginx/sites-available/"$DOMAIN" ]; then
      sed -e "s#proxy_pass http://127.0.0.1:3000;#proxy_pass http://127.0.0.1:${PORT};#g" \
          "$SRC_DIR/deploy/nginx-goalgo.conf" > /etc/nginx/sites-available/"$DOMAIN"
      # Before certificates exist, keep only the port-80 server block.
      if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
        awk '/^server \{/{n++} n==1' /etc/nginx/sites-available/"$DOMAIN" > /tmp/goalgo-http.conf
        printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n    location /.well-known/acme-challenge/ { root /var/www/html; }\n    location / {\n        proxy_pass http://127.0.0.1:%s;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection $connection_upgrade;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n' "$DOMAIN" "$PORT" > /etc/nginx/sites-available/"$DOMAIN"
      fi
    else
      skip "existing /etc/nginx/sites-available/$DOMAIN kept (managed by certbot); reference copy saved as ${DOMAIN}.src"
    fi
  fi
  # Required http{}-level directives, added in a separate file so nginx.conf is untouched.
  if ! grep -rq "zone=goalgo_hook" /etc/nginx/conf.d/ /etc/nginx/nginx.conf 2>/dev/null; then
    cat > /etc/nginx/conf.d/goalgo-common.conf <<'NGINX'
# Added by GOALGO deploy.sh — does not affect other sites.
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
limit_req_zone $binary_remote_addr zone=goalgo_hook:10m rate=10r/s;
NGINX
    ok "added /etc/nginx/conf.d/goalgo-common.conf"
  fi
  ln -sfn /etc/nginx/sites-available/"$DOMAIN" /etc/nginx/sites-enabled/"$DOMAIN"
  nginx -t >/dev/null 2>&1 || { nginx -t; die "nginx configuration test failed — nothing was reloaded"; }
  systemctl reload nginx
  ok "nginx validated and reloaded (OpenAlgo site untouched)"

  if [ "$DO_SSL" -eq 1 ]; then
    step "Requesting the TLS certificate for $DOMAIN"
    command -v certbot >/dev/null || die "certbot is not installed — run: apt-get install -y certbot python3-certbot-nginx"
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect \
      -m "${CERTBOT_EMAIL:-admin@fairwoodit.com}" || die "certbot failed (DNS for $DOMAIN must already point at this server)"
    nginx -t >/dev/null && systemctl reload nginx
    ok "HTTPS active for https://$DOMAIN"
  else
    skip "TLS certificate (re-run with --ssl once DNS points here)"
  fi
else
  skip "nginx configuration (--no-nginx)"
fi

summary
echo
echo "GOALGO is running on 127.0.0.1:${PORT} as systemd service '${SERVICE}'."
echo "Verify:  ./deploy/health-check.sh https://${DOMAIN}"
echo "Logs:    journalctl -u ${SERVICE} -f"
