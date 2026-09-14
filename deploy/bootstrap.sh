#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GOALGO — one-command bootstrap for a fresh Ubuntu 24.04 VPS.
#
# Installs prerequisites, fetches the GOALGO repository into /opt/goalgo/src
# and hands over to deploy/deploy-all.sh.
#
#   PUBLIC repository:
#     curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/deploy/bootstrap.sh \
#       | sudo REPO_URL=https://github.com/OWNER/REPO.git bash
#
#   or, if you already have the files:
#     sudo REPO_URL=https://github.com/OWNER/REPO.git ./deploy/bootstrap.sh
#
#   PRIVATE repository (after running deploy/setup-github-access.sh once):
#     sudo REPO_URL=github-goalgo:OWNER/REPO ./deploy/bootstrap.sh
#
# Options (environment variables):
#   REPO_URL   required — HTTPS URL, or github-goalgo:OWNER/REPO for a deploy key
#   REPO_REF   branch/tag to check out (default: main)
#   SRC_DIR    checkout location (default: /opt/goalgo/src)
#   CHECK_ONLY =1 to stop after the inspection pass (changes nothing on the host)
#
# It never touches OpenAlgo files and never stores GitHub credentials.
# Re-running updates the checkout in place instead of re-cloning.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_URL="${REPO_URL:-}"
REPO_REF="${REPO_REF:-main}"
SRC_DIR="${SRC_DIR:-/opt/goalgo/src}"
CHECK_ONLY="${CHECK_ONLY:-0}"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }

if [ -z "$REPO_URL" ]; then
  cat >&2 <<'EOF'
REPO_URL is not set.

  Public repo :  sudo REPO_URL=https://github.com/OWNER/REPO.git ./deploy/bootstrap.sh
  Private repo:  sudo ./deploy/setup-github-access.sh        # once, paste key on GitHub
                 sudo REPO_URL=github-goalgo:OWNER/REPO ./deploy/bootstrap.sh
EOF
  exit 2
fi

echo "############ GOALGO bootstrap"
echo "  repository: $REPO_URL ($REPO_REF)"
echo "  target:     $SRC_DIR"

echo
echo "############ prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl nginx openssl ca-certificates >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "  git    $(git --version | awk '{print $3}')"
echo "  node   $(node -v)"
echo "  nginx  $(nginx -v 2>&1 | awk -F/ '{print $2}')"

echo
echo "############ fetching the repository"
mkdir -p "$(dirname "$SRC_DIR")"
if [ -d "$SRC_DIR/.git" ]; then
  echo "  existing checkout found — updating in place"
  git -C "$SRC_DIR" remote set-url origin "$REPO_URL"
  git -C "$SRC_DIR" fetch --prune origin
  git -C "$SRC_DIR" checkout -q "$REPO_REF"
  git -C "$SRC_DIR" reset --hard "origin/$REPO_REF"
elif [ -e "$SRC_DIR" ] && [ -n "$(ls -A "$SRC_DIR" 2>/dev/null)" ]; then
  echo "  [STOP] $SRC_DIR exists and is not a git checkout. Move it aside first." >&2
  exit 1
else
  git clone --branch "$REPO_REF" "$REPO_URL" "$SRC_DIR"
fi
chmod +x "$SRC_DIR"/deploy/*.sh
echo "  at commit $(git -C "$SRC_DIR" rev-parse --short HEAD)"

if [ ! -x "$SRC_DIR/deploy/deploy-all.sh" ]; then
  echo "  [STOP] deploy/deploy-all.sh is missing from the repository." >&2
  exit 1
fi

echo
if [ "$CHECK_ONLY" = "1" ]; then
  exec "$SRC_DIR/deploy/deploy-all.sh" --check
fi
echo "############ handing over to deploy-all.sh"
exec "$SRC_DIR/deploy/deploy-all.sh"
