#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GOALGO — one-time GitHub access setup for a PRIVATE repository.
#
#   sudo ./deploy/setup-github-access.sh
#
# Creates a read-only SSH key on THIS server (an SSH "deploy key"), prints the
# PUBLIC half, and tells you exactly where to paste it on GitHub. The PRIVATE
# half never leaves /root/.ssh and is never printed, logged or committed.
#
# Nothing about this script touches OpenAlgo or GOALGO application files.
# Re-running it keeps the existing key and just prints the public half again.
# ---------------------------------------------------------------------------
set -euo pipefail

KEY="${KEY_PATH:-/root/.ssh/goalgo_deploy_key}"
REPO_SLUG="${REPO_SLUG:-}"   # e.g. Osheen06/goalgo

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }

mkdir -p "$(dirname "$KEY")"
chmod 700 "$(dirname "$KEY")"

if [ -f "$KEY" ]; then
  echo "Existing deploy key found — keeping it."
else
  ssh-keygen -t ed25519 -N '' -C "goalgo-deploy@$(hostname)" -f "$KEY" >/dev/null
  echo "New deploy key created."
fi
chmod 600 "$KEY"

# Make git use this key for github.com without touching any other SSH config.
CFG=/root/.ssh/config
touch "$CFG"; chmod 600 "$CFG"
if ! grep -q '^Host github-goalgo$' "$CFG"; then
  cat >> "$CFG" <<EOF

Host github-goalgo
  HostName github.com
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
EOF
  echo "Added SSH alias 'github-goalgo' to $CFG"
fi

ssh-keyscan -t ed25519 github.com 2>/dev/null >> /root/.ssh/known_hosts || true
sort -u -o /root/.ssh/known_hosts /root/.ssh/known_hosts

echo
echo "==================================================================="
echo "COPY THE LINE BELOW (this is the PUBLIC key — safe to share):"
echo "==================================================================="
cat "$KEY.pub"
echo "==================================================================="
echo
echo "Now, in your browser:"
echo "  1. Open your GOALGO repository on GitHub"
echo "  2. Settings -> Deploy keys -> Add deploy key"
echo "  3. Title: goalgo-vps      Key: paste the line above"
echo "  4. Leave 'Allow write access' UNCHECKED (read-only is all we need)"
echo "  5. Click 'Add key'"
echo
if [ -n "$REPO_SLUG" ]; then
  echo "Then clone with:"
  echo "  git clone github-goalgo:$REPO_SLUG /opt/goalgo/src"
else
  echo "Then clone with (replace OWNER/REPO with your repository):"
  echo "  git clone github-goalgo:OWNER/REPO /opt/goalgo/src"
fi
echo
echo "Test access first (optional):  ssh -T github-goalgo"
echo "Expected: 'Hi OWNER/REPO! You've successfully authenticated...'"
