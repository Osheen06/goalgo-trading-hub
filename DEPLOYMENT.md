# GOALGO — Production deployment (Ubuntu 24.04, VPS 210.56.147.234)

**One public domain. No new DNS record.**

| Application | Address | Port | Service | Files |
| --- | --- | --- | --- | --- |
| GOALGO (this repo) | `https://goalgo.fairwoodit.com` — public | 3000 (localhost) | `goalgo` | `/opt/goalgo` |
| OpenAlgo (execution layer) | `http://127.0.0.1:5000` — **private, not published** | 5000 (+8765 ws, 5555 zmq) | `openalgo` | `/var/python/openalgo` |

nginx terminates HTTPS for `goalgo.fairwoodit.com` and reverse-proxies everything
to GOALGO. GOALGO reaches OpenAlgo over the loopback interface only. OpenAlgo
keeps its own service, its own configuration and its own database; GOALGO never
edits them.

---

## Phase 1 — DNS (already done)

```
Type: A   Name: goalgo (or @, as your zone requires)   Value: 210.56.147.234   TTL: 300
```

Verify:

```bash
dig +short goalgo.fairwoodit.com     # must print 210.56.147.234
```

No other record is needed.

## Phase 2 — get the code onto the server

Connect this Lovable project to GitHub first (chat input → **+** → **GitHub →
Connect project**). Note the URL `https://github.com/OWNER/REPO` and whether it
is **Public** or **Private**.

### A. Public repository

```bash
ssh root@210.56.147.234
apt-get update && apt-get install -y git curl nginx openssl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
mkdir -p /opt/goalgo
git clone https://github.com/OWNER/REPO.git /opt/goalgo/src
cd /opt/goalgo/src
```

### B. Private repository — one read-only deploy key

```bash
ssh root@210.56.147.234
apt-get update && apt-get install -y git curl openssl
mkdir -p /opt/goalgo && cd /opt/goalgo
curl -fsSLO https://raw.githubusercontent.com/OWNER/REPO/main/deploy/setup-github-access.sh
sudo bash setup-github-access.sh
```

It prints one `ssh-ed25519 …` line (the public half). On GitHub: repository →
**Settings → Deploy keys → Add deploy key**, title `goalgo-vps`, paste the line,
leave **Allow write access** unchecked, **Add key**. Then:

```bash
ssh -T github-goalgo                       # expect "successfully authenticated"
git clone github-goalgo:OWNER/REPO /opt/goalgo/src
cd /opt/goalgo/src
```

### Then, either way

```bash
sudo ./deploy/deploy-all.sh --check     # inspect only, changes nothing
sudo ./deploy/deploy-all.sh             # full deployment
```

`deploy/bootstrap.sh` does prerequisites + clone + handover in one command:

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/deploy/bootstrap.sh \
  | sudo REPO_URL=https://github.com/OWNER/REPO.git bash
```

## Phase 3 — what `deploy-all.sh` does

1. Prints server state (OS, domain, DNS, OpenAlgo, GOALGO, nginx sites, ports).
2. **OpenAlgo**: `deploy/install-openalgo.sh` stops immediately and changes
   nothing if `/var/python/openalgo`, `openalgo.service` or
   `/etc/nginx/sites-available/openalgo.conf` already exist. Otherwise it checks
   DNS and ports 5000/8765/5555, downloads the **official** installer from
   `github.com/marketcalls/openalgo/main/install/install.sh` and runs it. That
   installer asks for the domain, broker and broker API credentials, and creates
   `/var/python/openalgo`, `openalgo.service` and a Let's Encrypt certificate for
   `goalgo.fairwoodit.com`.
3. Verifies OpenAlgo answers on `http://127.0.0.1:5000`; stops if it does not.
4. **GOALGO**: runs `deploy/deploy.sh --ssl`, which
   - checks DNS resolves to 210.56.147.234,
   - checks port 3000 is free,
   - takes ownership of the `goalgo.fairwoodit.com` vhost: if OpenAlgo's
     installer left a vhost for the same hostname, only its `sites-enabled`
     **symlink** is removed — the file in `sites-available` and the certificate
     stay untouched, and OpenAlgo keeps running on 127.0.0.1:5000,
   - writes `/etc/goalgo/goalgo.env` (mode 600, existing values kept),
   - generates `GOALGO_WEBHOOK_TOKEN` once with `openssl rand -hex 32`,
   - prompts (hidden) for the remaining secrets,
   - builds the release (`NITRO_PRESET=node_server`), installs the systemd unit,
     writes its nginx site, validates it, runs certbot, health-checks locally.
5. Runs `deploy/health-check.sh https://goalgo.fairwoodit.com`.

Re-running is safe: existing secrets, releases, services, vhost files and
certificates are preserved; only missing pieces are created.

## Phase 4 — values you must type

OpenAlgo's own installer asks (stored only in `/var/python/openalgo/.env`):

| Value | Where you get it |
| --- | --- |
| Domain | `goalgo.fairwoodit.com` (issues the certificate GOALGO reuses) |
| Broker | pick yours from the installer's list |
| Broker API key / secret | your broker's developer portal |

`deploy.sh` then asks:

| Value | Required | Where you get it |
| --- | --- | --- |
| `OPENALGO_API_KEY` | yes | OpenAlgo UI → API Key (after broker login) |
| `SUPABASE_SERVICE_ROLE_KEY` | optional | your Supabase project settings; needed only so inbound TradingView webhooks can be recorded |
| `OPENALGO_STRATEGY_WEBHOOK_URL` | optional | OpenAlgo UI → Strategy → your strategy → Webhook URL. OpenAlgo exposes no API that lists it, so it is pasted once. |

Derived automatically: `APP_URL=https://goalgo.fairwoodit.com`,
`OPENALGO_BASE_URL=http://127.0.0.1:5000`, the public Supabase values,
`GOALGO_WEBHOOK_TOKEN`. There is no `GOALGO_OWNER_USER_ID` — the first account
that registers becomes the owner and registration then closes.

## Phase 5 — reaching the OpenAlgo admin UI (private)

OpenAlgo is deliberately not published. From your own machine:

```bash
ssh -N -L 5000:127.0.0.1:5000 root@210.56.147.234
# leave it running, then open http://localhost:5000 in your browser
```

Use it for the broker login and to copy the API key.

**Broker OAuth callbacks.** If your broker redirects the login back to a public
HTTPS URL, that exact path must reach OpenAlgo. Read the callback path from
OpenAlgo's own broker setup page, then re-run with only that path exposed:

```bash
sudo OPENALGO_PUBLIC_PATHS="/<broker>/callback" ./deploy/deploy.sh
```

Nothing else of OpenAlgo is ever published. If your broker does not need this,
leave it unset.

## Phase 6 — verification

```bash
# OpenAlgo (private)
systemctl status openalgo --no-pager
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000      # expect 200/302

# GOALGO (public)
systemctl status goalgo --no-pager
./deploy/health-check.sh https://goalgo.fairwoodit.com              # expect ALL CHECKS PASSED

# GOALGO -> OpenAlgo (deep probe; token read from the env file)
curl -s -H "x-goalgo-token: $(sudo sed -n 's/^GOALGO_WEBHOOK_TOKEN=//p' /etc/goalgo/goalgo.env)" \
     'https://goalgo.fairwoodit.com/api/public/health?deep=1'
# expect openalgoConfigured:true and openalgo.reachable:true
```

Then open `https://goalgo.fairwoodit.com`, create the first account (it becomes
the owner), and check that the OpenAlgo page shows *Connected* and Funds shows
your real broker balance.

## Phase 7 — broker authentication

Done inside OpenAlgo through the SSH tunnel (Phase 5), not in GOALGO. GOALGO's
Broker page then reflects the real session state. GOALGO never holds broker
credentials.

## Phase 8 — TradingView (one-time, by the developer)

1. In GOALGO open **TradingView** and copy the webhook URL shown there
   (`https://goalgo.fairwoodit.com/api/public/webhooks/tradingview?...` — it
   already contains the token).
2. In TradingView create the alert on your strategy, set *Webhook URL* to that
   URL, and use the alert message format shown on the same page.
3. Paste OpenAlgo's strategy webhook URL into `/etc/goalgo/goalgo.env` via
   `sudo ./deploy/deploy.sh` (it prompts when still empty), then
   `sudo systemctl restart goalgo`.

TradingView only ever talks to GOALGO on the public domain; OpenAlgo's own
webhook is called from the server over localhost.

## Phase 9 — controlled end-to-end test

1. In GOALGO → Settings keep **Automated trading** OFF. Fire a TradingView test
   alert: Signals must show it as **rejected** and nothing reaches the broker.
2. Turn automated trading ON. Fire one alert for **1 share of a liquid symbol**
   during market hours.
3. Watch: Signals → accepted; Orders → real broker order ID; Order details →
   full lifecycle; Positions → the position.
4. Close it from Positions (explicit confirmation) and turn automated trading off.

## Update / rollback / operations

```bash
cd /opt/goalgo/src && sudo ./deploy/update.sh      # pull, rebuild, auto-rollback on failure
sudo ./deploy/rollback.sh                          # previous release
systemctl restart goalgo | stop goalgo | status goalgo
journalctl -u goalgo -f
```

OpenAlgo updates separately: `cd /var/python/openalgo && sudo ./install/update.sh`.

## Troubleshooting

| Symptom | Command |
| --- | --- |
| GOALGO 502 | `journalctl -u goalgo -n 100 --no-pager` |
| OpenAlgo unreachable | `systemctl status openalgo` · `journalctl -u openalgo -n 100 --no-pager` |
| nginx won't reload | `nginx -t` |
| certificate missing | `certbot certificates` then `certbot --nginx -d goalgo.fairwoodit.com` |
| port conflict | `ss -tlnp` |
| two vhosts claim the domain | `ls -l /etc/nginx/sites-enabled` — only `goalgo.fairwoodit.com` should be linked |
| OpenAlgo install log | `cat ~/openalgo-install/logs/$(ls -t ~/openalgo-install/logs/ \| head -1)` |
| GOALGO says "not configured" | a value in `/etc/goalgo/goalgo.env` is empty — re-run `sudo ./deploy/deploy.sh` |

GOALGO's scripts never edit `/var/python/openalgo/.env`, OpenAlgo's database or
its systemd unit.
