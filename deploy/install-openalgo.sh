#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OpenAlgo installation helper (Ubuntu 24.04) — SAFE WRAPPER.
#
#   sudo ./deploy/install-openalgo.sh                 # install if absent, else do nothing
#   sudo ./deploy/install-openalgo.sh --check         # report state only, change nothing
#
# Single-domain architecture: after this installer finishes, OpenAlgo keeps its
# own systemd service and its own configuration on 127.0.0.1:5000, but it does
# NOT keep the public hostname. deploy.sh then makes goalgo.fairwoodit.com serve
# GOALGO and reuses the Let's Encrypt certificate this installer obtained. The
# OpenAlgo vhost file is preserved (only its sites-enabled symlink is removed).
#
# This script does NOT reimplement OpenAlgo's installer. It downloads and runs
# the OFFICIAL installer from the OpenAlgo repository:
#   https://raw.githubusercontent.com/marketcalls/openalgo/main/install/install.sh
# (documented at docs.openalgo.in -> Installation -> Ubuntu Server Installation)
#
# Guarantees:
#   * If /var/python/openalgo, openalgo.service or /etc/nginx/sites-available/
#     openalgo.conf already exist, it STOPS and changes nothing.
#   * It never edits an existing OpenAlgo .env, database or certificate.
#   * It never touches anything belonging to GOALGO.
#   * Broker credentials are typed into the official installer's own hidden
#     prompts; this wrapper never reads, stores or prints them.
# ---------------------------------------------------------------------------
set -euo pipefail

OA_DOMAIN="${OPENALGO_DOMAIN:-goalgo.fairwoodit.com}"
OA_DIR="/var/python/openalgo"
OA_SERVICE="openalgo"
OA_NGINX="/etc/nginx/sites-available/openalgo.conf"
INSTALLER_URL="https://raw.githubusercontent.com/marketcalls/openalgo/main/install/install.sh"
WORKDIR="${HOME:-/root}/openalgo-install"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

say()  { echo "  $*"; }
step() { echo; echo "==> $1"; }
die()  { echo "  [FAIL] $1" >&2; exit 1; }

step "Inspecting the server for an existing OpenAlgo installation"
FOUND=0
[ -d "$OA_DIR" ]  && { say "[found] $OA_DIR"; FOUND=1; }
systemctl list-unit-files 2>/dev/null | grep -q "^${OA_SERVICE}.service" && { say "[found] ${OA_SERVICE}.service"; FOUND=1; }
[ -f "$OA_NGINX" ] && { say "[found] $OA_NGINX"; FOUND=1; }
ls -d /var/python/openalgo-flask/* >/dev/null 2>&1 && { say "[found] multi-instance layout under /var/python/openalgo-flask"; FOUND=1; }

if [ "$FOUND" -eq 1 ]; then
  say "OpenAlgo is already present on this server."
  say "This wrapper will NOT modify, reinstall or reconfigure it."
  say "Update it with the official updater instead: cd $OA_DIR && sudo ./install/update.sh"
  exit 0
fi
say "No existing OpenAlgo installation detected."

step "Checking DNS for $OA_DOMAIN"
RESOLVED="$( { getent ahostsv4 "$OA_DOMAIN" 2>/dev/null || true; } | awk '{print $1}' | sort -u | tr '\n' ' ')"
if [ -z "$RESOLVED" ]; then
  die "$OA_DOMAIN does not resolve. MANUAL ACTION: create an A record for it pointing at this server, wait for propagation, then re-run. (Let's Encrypt cannot issue a certificate until then.)"
fi
say "$OA_DOMAIN -> $RESOLVED"
say "NOTE: this is the ONLY domain. It ends up serving GOALGO; OpenAlgo stays on 127.0.0.1:5000."

step "Checking ports OpenAlgo needs (80, 443, 5000, 8765, 5555)"
for p in 80 443 5000 8765 5555; do
  if ss -tln 2>/dev/null | grep -qE "(127\.0\.0\.1|0\.0\.0\.0|\[::\]|\*):${p}[[:space:]]"; then
    if [ "$p" = 80 ] || [ "$p" = 443 ]; then
      say "[note] port $p is in use (nginx already running) — the official installer manages its own vhost"
    else
      die "port $p is already used by another process. Free it, or install OpenAlgo with the multi-instance installer (install-multi.sh), which uses a different port range."
    fi
  fi
done
say "no conflicting application ports"

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo; echo "Check only — nothing was installed."; exit 0
fi

[ "$(id -u)" -eq 0 ] || die "Run with sudo."

step "Downloading the official OpenAlgo installer"
mkdir -p "$WORKDIR"
curl -fsSL "$INSTALLER_URL" -o "$WORKDIR/install.sh" || die "could not download $INSTALLER_URL"
chmod +x "$WORKDIR/install.sh"
say "saved to $WORKDIR/install.sh"

step "Running the official OpenAlgo installer (interactive)"
cat <<TXT

  The installer now asks you, in its own prompts:
    * Domain name            -> type: $OA_DOMAIN
                                (this issues the TLS certificate GOALGO will
                                 reuse; GOALGO takes over the vhost afterwards)
    * Broker                 -> pick your broker from its list
    * Broker API key/secret  -> paste them; they are stored only in
                                $OA_DIR/.env on this server
    * Remote MCP?            -> answer n unless you specifically want it

  It installs packages, uv, the app, Nginx and a Let's Encrypt certificate,
  and creates the systemd unit "${OA_SERVICE}".

TXT
"$WORKDIR/install.sh"

step "Verifying OpenAlgo"
systemctl is-enabled --quiet "$OA_SERVICE" && say "service enabled at boot"
systemctl is-active  --quiet "$OA_SERVICE" && say "service running" || say "[warn] service not active — check: journalctl -u $OA_SERVICE -n 100"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:5000" || true)"
say "http://127.0.0.1:5000 -> HTTP $CODE (private; this is what GOALGO talks to)"
[ -d "/etc/letsencrypt/live/$OA_DOMAIN" ] && say "TLS certificate for $OA_DOMAIN present — GOALGO will reuse it"
echo
echo "Next: reach the OpenAlgo admin UI privately through an SSH tunnel from your"
echo "own machine (OpenAlgo is intentionally not published):"
echo "    ssh -N -L 5000:127.0.0.1:5000 root@210.56.147.234"
echo "    then open http://localhost:5000"
echo "Complete the broker login there, then generate an API key (API Key page)."
echo "GOALGO asks for that key during its own deployment."
