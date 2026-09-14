# GOALGO — deployment & launch guide

GOALGO is the trading console. OpenAlgo is the execution engine and the source of truth
for every broker fact. They run side by side on the same Ubuntu 24 VPS but stay separate:
GOALGO never touches OpenAlgo's database, and OpenAlgo keeps sole custody of broker credentials.

---

## 1. Environment variables (server only)

Names live in `.env.example`; real values are entered on the server and never committed.

| Variable | What it is | Where you get it |
| --- | --- | --- |
| `APP_URL` | Public address of GOALGO, e.g. `https://app.goalgo.fairwoodit.com` | Your domain |
| `OPENALGO_BASE_URL` | Address of your OpenAlgo instance, e.g. `http://127.0.0.1:5000` | Your OpenAlgo install |
| `OPENALGO_API_KEY` | OpenAlgo API key | OpenAlgo → API key page |
| `OPENALGO_STRATEGY_WEBHOOK_URL` | OpenAlgo strategy webhook, `.../strategy/webhook/<token>` | OpenAlgo → your strategy |
| `GOALGO_WEBHOOK_TOKEN` | Shared secret TradingView must send to GOALGO | You generate it (`openssl rand -hex 32`) |
| `GOALGO_OWNER_USER_ID` | The GOALGO account inbound signals belong to | Copy from the Activity page after first sign-in |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Database and auth | Provisioned automatically by Lovable Cloud |

Credentials you must enter by hand, once: the OpenAlgo API key, the OpenAlgo strategy
webhook URL, and the GOALGO webhook secret. Broker credentials are entered **only** in
OpenAlgo, never in GOALGO.

---

## 2. Database

Schema is versioned in `supabase/migrations/`. Tables: `profiles`, `app_settings`,
`signals`, `audit_logs`, `connection_events`. Every table has row-level security so one
signed-in account sees only its own rows. Nothing that OpenAlgo already stores (orders,
positions, funds) is duplicated here.

---

## 3. Production deployment — Ubuntu 24, VPS 210.56.147.234

OpenAlgo keeps `https://goalgo.fairwoodit.com`. GOALGO runs as its own service
on its own port behind `https://app.goalgo.fairwoodit.com`. Nothing below
reads, edits, reloads or restarts OpenAlgo, its nginx site, its certificate or
its database.

### 3.0 MANUAL ACTION REQUIRED — DNS

At your DNS provider add:

| Type | Name | Value |
|---|---|---|
| A | `app.goalgo.fairwoodit.com` | `210.56.147.234` |

Verify before continuing (must print the VPS IP):

```sh
dig +short app.goalgo.fairwoodit.com
```

### 3.1 SSH in and install dependencies (once)

```sh
ssh root@210.56.147.234

apt-get update
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs nginx git certbot python3-certbot-nginx
node -v        # must be v20 or newer
```

### 3.2 Get the code

```sh
mkdir -p /opt/goalgo
git clone <your-repo-url> /opt/goalgo/src
cd /opt/goalgo/src
```

### 3.3 First run — creates the secrets file and stops

```sh
sudo ./deploy/deploy.sh
```

It writes `/etc/goalgo/goalgo.env` (chmod 600) from the template and stops,
telling you to fill it in.

### 3.4 Enter the production secrets

```sh
sudo nano /etc/goalgo/goalgo.env
openssl rand -hex 32      # use this value for GOALGO_WEBHOOK_TOKEN
```

Fill every variable listed in `deploy/goalgo.env.example`. This file is the
only place production secrets exist; it is never in git, never in the browser
bundle and never printed by any script.

### 3.5 Deploy for real

```sh
sudo ./deploy/deploy.sh          # build + service + nginx on port 80
sudo ./deploy/deploy.sh --ssl    # once DNS resolves: adds the Let's Encrypt cert
```

`deploy.sh` validates prerequisites, refuses to run if the port is taken by
another process, builds a timestamped release under `/opt/goalgo/releases`,
points `/opt/goalgo/current` at it, installs and starts the `goalgo` systemd
service, writes only the `app.goalgo.fairwoodit.com` nginx site, runs
`nginx -t` before any reload, and prints a per-step OK/SKIPPED/FAILED summary.
If another nginx site already claims the hostname, it stops instead of
overwriting it.

Options: `GOALGO_PORT=3100 sudo ./deploy/deploy.sh` (different port),
`--no-nginx` (leave the web server alone).

### 3.6 Verify

```sh
./deploy/health-check.sh https://app.goalgo.fairwoodit.com
GOALGO_WEBHOOK_TOKEN=<token> ./deploy/health-check.sh https://app.goalgo.fairwoodit.com
```

Expected: `ALL CHECKS PASSED`, health JSON with
`"openalgoConfigured":true,"webhookConfigured":true,"databaseConfigured":true`,
and with the token also `"openalgo":{"reachable":true,...}`.

Then open `https://app.goalgo.fairwoodit.com` and sign in.

### 3.7 Day-to-day operations

```sh
sudo systemctl start|stop|restart|status goalgo
journalctl -u goalgo -f                 # live logs (never contain secrets)
cd /opt/goalgo/src && sudo ./deploy/update.sh     # pull + rebuild + auto-rollback on failure
./deploy/rollback.sh --list                       # show releases
sudo ./deploy/rollback.sh                         # back to the previous release
sudo ./deploy/rollback.sh 20260914123000          # back to a specific release
```

`Restart=always` plus `systemctl enable` means GOALGO returns after a crash or
reboot. The service runs as the unprivileged `goalgo` user with systemd
hardening (`ProtectSystem=strict`, `NoNewPrivileges`, `PrivateTmp`).

### 3.8 What to check if the VPS is not a clean machine

- `sudo ss -tlnp` — which ports OpenAlgo already uses; pick a free `GOALGO_PORT`.
- `ls /etc/nginx/sites-enabled/` — confirm no existing file claims
  `app.goalgo.fairwoodit.com`; the OpenAlgo file for `goalgo.fairwoodit.com`
  must stay exactly as it is.
- `grep -r "map \$http_upgrade" /etc/nginx/` — if OpenAlgo already defines this
  map, delete that line from `/etc/nginx/conf.d/goalgo-common.conf`.
- `certbot certificates` — the existing OpenAlgo certificate must remain listed
  after you run `--ssl`.

### 3.9 Database

The database is Supabase (managed). Schema changes are applied as migrations
from this project; there is nothing to install on the VPS and OpenAlgo's own
database is never touched.

---

## 4. TradingView (one-time setup)

1. Open the TradingView page in GOALGO and copy the webhook URL.
2. In your TradingView alert, set the webhook URL to that address including
   `?token=<GOALGO_WEBHOOK_TOKEN>`.
3. The alert message must be the JSON your OpenAlgo strategy expects — GOALGO forwards it
   unchanged.
4. Fire one alert and confirm it appears on the Signals page.

---

## 5. End-to-end verification

1. **OpenAlgo** page → Check connection shows Connected with a latency figure.
2. **Broker** page → Verify connection names your broker and lists detected capabilities.
3. **Funds / Positions / Orders** show real broker data (or a clear empty state).
4. **TradingView** alert fires → appears on **Signals** within seconds.
5. Signal is forwarded → the resulting order appears on **Orders**, and its **Order details**
   page shows the full lifecycle.
6. **Settings** → turn automated trading off, fire an alert, confirm it is recorded and
   rejected without reaching the broker. Turn it back on.

---

## 6. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| “Not configured” everywhere | `OPENALGO_BASE_URL` / `OPENALGO_API_KEY` missing on the server |
| OpenAlgo connected, broker “Authentication required” | Broker session expired — log in again inside OpenAlgo |
| Signals arrive but nothing is forwarded | Automated trading is off, or `OPENALGO_STRATEGY_WEBHOOK_URL` is unset |
| TradingView reports 401 | Alert URL is missing or has the wrong `token` |
| Signals recorded with no owner | `GOALGO_OWNER_USER_ID` is unset |
| 502 Bad Gateway | GOALGO service down or on a different port than nginx proxies to |
| Certbot fails | DNS for `app.goalgo.fairwoodit.com` does not resolve to the VPS yet |

Commands:

```sh
systemctl status goalgo                      # is it running?
journalctl -u goalgo -n 200 --no-pager       # recent application logs
journalctl -u goalgo -f                      # follow live
curl -s http://127.0.0.1:3000/api/public/health
sudo ss -tlnp | grep -E ':(80|443|3000) '    # who owns which port
sudo nginx -t                                # config valid?
sudo tail -n 100 /var/log/nginx/error.log
sudo certbot certificates                    # both certs still listed?
curl -sI https://goalgo.fairwoodit.com | head -1   # OpenAlgo still fine
./deploy/health-check.sh https://app.goalgo.fairwoodit.com
sudo ./deploy/rollback.sh                    # last resort: previous release
```

---


## 7. Launch checklist

- [ ] OpenAlgo running and broker logged in
- [ ] All server environment variables set
- [ ] Database migrations applied
- [ ] HTTPS live on app.goalgo.fairwoodit.com (OpenAlgo still answering on goalgo.fairwoodit.com), no ngrok
- [ ] Owner account created and `GOALGO_OWNER_USER_ID` set
- [ ] OpenAlgo and Broker pages both verified
- [ ] TradingView alert delivered end to end
- [ ] Automated trading switch tested off and on
- [ ] Emergency controls reviewed (square-off and cancel-all)
- [ ] Both services restart automatically after a reboot
