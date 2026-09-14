# GOALGO — Production deployment (Ubuntu 24.04, VPS 210.56.147.234)

The server hosts **two independent applications**:

| Application | Domain | Port | Service | Files |
| --- | --- | --- | --- | --- |
| OpenAlgo (execution layer) | `https://goalgo.fairwoodit.com` | 5000 (+8765 ws, 5555 zmq) | `openalgo` | `/var/python/openalgo` |
| GOALGO (this repo) | `https://app.goalgo.fairwoodit.com` | 3000 | `goalgo` | `/opt/goalgo` |

They share only the machine and nginx. Separate services, separate
configuration, separate data, separate certificates. OpenAlgo is installed with
its **official installer**; GOALGO never edits OpenAlgo's files.

As of the last server inspection the VPS has **no OpenAlgo installation** —
Phase 2 below installs it.

---

## Phase 1 — DNS (MANUAL ACTION REQUIRED)

At your domain provider create/confirm both records:

```
Type: A   Name: goalgo   (or @ for the apex, as your zone requires)   Value: 210.56.147.234   TTL: 300
Type: A   Name: app                                                   Value: 210.56.147.234   TTL: 300
```

`goalgo.fairwoodit.com` must resolve before OpenAlgo's certificate can be
issued; `app.goalgo.fairwoodit.com` before GOALGO's. Verify:

```bash
dig +short goalgo.fairwoodit.com app.goalgo.fairwoodit.com
```

Both must print `210.56.147.234`.

## Phase 2 — get the code onto the server

The GOALGO code lives in a GitHub repository. Connect this Lovable project to
GitHub first (chat input → **+** → **GitHub → Connect project**); that creates
the repository and keeps pushing every change to it automatically. Note the
resulting URL — `https://github.com/OWNER/REPO` — and whether GitHub shows it as
**Public** or **Private** (the badge next to the repository name).

### A. Public repository — nothing to authorise

```bash
ssh root@210.56.147.234
apt-get update && apt-get install -y git curl nginx openssl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
mkdir -p /opt/goalgo
git clone https://github.com/OWNER/REPO.git /opt/goalgo/src
cd /opt/goalgo/src
```

### B. Private repository — one read-only key, pasted once

A private repository needs proof that the server is allowed to read it. The
safest way is a **deploy key**: a read-only key that works for this one
repository and nothing else. No password, no personal access token, no
GitHub login on the server.

```bash
ssh root@210.56.147.234
apt-get update && apt-get install -y git curl openssl
mkdir -p /opt/goalgo && cd /opt/goalgo
curl -fsSLO https://raw.githubusercontent.com/OWNER/REPO/main/deploy/setup-github-access.sh   # or scp it up
sudo bash setup-github-access.sh
```

The script prints one long line starting with `ssh-ed25519`. That is the
**public** half — safe to share. The private half stays on the server and is
never printed. Then, in your browser:

1. Open your repository on GitHub
2. **Settings → Deploy keys → Add deploy key**
3. Title `goalgo-vps`, Key = paste the printed line
4. Leave **Allow write access** unchecked
5. **Add key**

Back on the server:

```bash
ssh -T github-goalgo                                   # expect "successfully authenticated"
git clone github-goalgo:OWNER/REPO /opt/goalgo/src
cd /opt/goalgo/src
```

### Then, either way

Inspect first, change nothing:

```bash
sudo ./deploy/deploy-all.sh --check
```

Then run the master deployment:

```bash
sudo ./deploy/deploy-all.sh
```

### Shortcut — `deploy/bootstrap.sh`

`bootstrap.sh` does the prerequisites, the clone (or an in-place update if the
checkout already exists) and the handover to `deploy-all.sh` in one go:

```bash
# public repository
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/deploy/bootstrap.sh \
  | sudo REPO_URL=https://github.com/OWNER/REPO.git bash

# private repository, after the deploy key is added
sudo REPO_URL=github-goalgo:OWNER/REPO /opt/goalgo/src/deploy/bootstrap.sh
```

Add `CHECK_ONLY=1` to stop after the inspection pass. Re-running is safe: it
updates the checkout instead of re-cloning and never overwrites OpenAlgo.

## Phase 3 — what `deploy-all.sh` does

1. Prints the current server state (OS, OpenAlgo, GOALGO, nginx sites, ports).
2. **OpenAlgo**: `deploy/install-openalgo.sh` stops immediately if
   `/var/python/openalgo`, `openalgo.service` or `openalgo.conf` already exist.
   Otherwise it checks DNS and ports 5000/8765/5555, downloads the **official**
   installer from `github.com/marketcalls/openalgo/main/install/install.sh`
   and runs it. That installer asks you for the domain, broker and broker API
   credentials, then sets up `/var/python/openalgo`, `openalgo.service`,
   its own nginx vhost and its own Let's Encrypt certificate.
3. Verifies `https://goalgo.fairwoodit.com` answers; stops if it does not.
4. **GOALGO**: runs `deploy/deploy.sh --ssl` — DNS check, hostname/port conflict
   check, `/etc/goalgo/goalgo.env` (created mode 600, existing values kept),
   webhook token generated once with `openssl rand -hex 32`, hidden prompts for
   the remaining secrets, release build (`NITRO_PRESET=node_server`), systemd
   unit, its own nginx site, certbot, local health check.
5. Runs `deploy/health-check.sh` against GOALGO and re-checks OpenAlgo.

Re-running is safe: existing secrets, releases, services, vhosts and
certificates are preserved; only missing pieces are created.

## Phase 4 — values you must type

The OpenAlgo installer asks (its own hidden prompts, stored only in
`/var/python/openalgo/.env`):

| Value | Where you get it |
| --- | --- |
| Domain | `goalgo.fairwoodit.com` |
| Broker | pick yours from the installer's list |
| Broker API key / secret | your broker's developer portal |

`deploy.sh` then asks:

| Value | Required | Where you get it |
| --- | --- | --- |
| `OPENALGO_API_KEY` | yes | OpenAlgo UI → API Key (after broker login) |
| `SUPABASE_SERVICE_ROLE_KEY` | optional | your Supabase project settings; needed only so inbound TradingView webhooks can be recorded |
| `OPENALGO_STRATEGY_WEBHOOK_URL` | optional | OpenAlgo UI → Strategy → your strategy → Webhook URL. OpenAlgo exposes no API that lists it, so it must be pasted once. |

Everything else is derived automatically: `APP_URL`, `OPENALGO_BASE_URL`,
the public Supabase values, `GOALGO_WEBHOOK_TOKEN`. There is **no**
`GOALGO_OWNER_USER_ID` — the first account that registers in GOALGO becomes the
owner and registration then closes.

Nothing asks for, stores or prints the VPS root password.

## Phase 5 — verification

```bash
# OpenAlgo first
systemctl status openalgo --no-pager
curl -sI https://goalgo.fairwoodit.com | head -1        # expect HTTP/2 200 (or 302 to /login)

# GOALGO second
systemctl status goalgo --no-pager
./deploy/health-check.sh https://app.goalgo.fairwoodit.com   # expect ALL CHECKS PASSED

# GOALGO -> OpenAlgo (deep probe; token is read from the env file)
curl -s -H "x-goalgo-token: $(sudo sed -n 's/^GOALGO_WEBHOOK_TOKEN=//p' /etc/goalgo/goalgo.env)" \
     'https://app.goalgo.fairwoodit.com/api/public/health?deep=1'
# expect openalgoConfigured:true and openalgo.reachable:true
```

Then open `https://app.goalgo.fairwoodit.com`, create the first account (it
becomes the owner), and check the OpenAlgo page shows *Connected* and the Funds
page shows your real broker balance.

## Phase 6 — broker authentication

Done inside OpenAlgo, not GOALGO: open `https://goalgo.fairwoodit.com`, log in
with your broker, complete the broker's auth flow. GOALGO's Broker page then
reflects the real session state. GOALGO never holds broker credentials.

## Phase 7 — TradingView (one-time, by the developer)

1. In GOALGO open **TradingView** and copy the webhook URL shown there (it
   already contains the token).
2. In TradingView create the alert on your strategy, set *Webhook URL* to that
   URL, and use the alert message format shown on the same page.
3. Paste OpenAlgo's strategy webhook URL into `/etc/goalgo/goalgo.env` via
   `sudo ./deploy/deploy.sh` (it prompts for it if still empty), then
   `sudo systemctl restart goalgo`.

## Phase 8 — controlled end-to-end test

1. In GOALGO → Settings, keep **Automated trading** OFF. Fire a TradingView test
   alert: the Signals page must show the signal as **rejected** and nothing
   reaches the broker. That proves the server-side kill switch.
2. Turn automated trading ON. Fire one alert for **1 share of a liquid symbol**
   during market hours.
3. Watch: Signals → accepted; Orders → the order with a real broker order ID;
   Order details → the full lifecycle; Positions → the position.
4. Close it from Positions (explicit confirmation) and turn automated trading
   off again.

## Update / rollback / operations

```bash
cd /opt/goalgo/src && sudo ./deploy/update.sh      # pull, rebuild, auto-rollback on failure
sudo ./deploy/rollback.sh                          # previous release
systemctl restart goalgo | stop goalgo | status goalgo
journalctl -u goalgo -f
```

OpenAlgo is updated separately with its own updater:
`cd /var/python/openalgo && sudo ./install/update.sh`.

## Troubleshooting

| Symptom | Command |
| --- | --- |
| GOALGO 502 | `journalctl -u goalgo -n 100 --no-pager` |
| OpenAlgo 502 | `journalctl -u openalgo -n 100 --no-pager` |
| nginx won't reload | `nginx -t` |
| certificate missing | `certbot certificates` then `certbot --nginx -d <domain>` |
| port conflict | `ss -tlnp` |
| OpenAlgo install log | `cat ~/openalgo-install/logs/$(ls -t ~/openalgo-install/logs/ | head -1)` |
| GOALGO says "not configured" | a value in `/etc/goalgo/goalgo.env` is empty — re-run `sudo ./deploy/deploy.sh` |

Never edit OpenAlgo's nginx vhost (`/etc/nginx/sites-available/openalgo.conf`)
or its `.env` from GOALGO's scripts; nothing in this repo does.
