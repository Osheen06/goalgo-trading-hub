# GOALGO — deployment & launch guide

GOALGO is the trading console. OpenAlgo is the execution engine and the source of truth
for every broker fact. They run side by side on the same Ubuntu 24 VPS but stay separate:
GOALGO never touches OpenAlgo's database, and OpenAlgo keeps sole custody of broker credentials.

---

## 1. Environment variables (server only)

Names live in `.env.example`; real values are entered on the server and never committed.

| Variable | What it is | Where you get it |
| --- | --- | --- |
| `APP_URL` | Public address of GOALGO, e.g. `https://goalgo.fairwoodit.com` | Your domain |
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

## 3. VPS, domain and SSL (Ubuntu 24, 210.56.147.234)

OpenAlgo keeps `https://goalgo.fairwoodit.com`. GOALGO gets its own host,
`https://app.goalgo.fairwoodit.com`, and its own port. Nothing in this section
touches the OpenAlgo service, its nginx server block, or its database.

**3.1 Check for port conflicts before choosing one**

```sh
sudo ss -tlnp | sort -k4       # list every listening port
sudo ss -tlnp | grep -q ':3000 ' && echo "3000 IS TAKEN — pick another" || echo "3000 free"
```
If 3000 is taken, pick a free port and change `PORT=` in the systemd unit and
the `proxy_pass` port in the nginx file.

**3.2 System user and directories**

```sh
sudo adduser --system --group --home /opt/goalgo goalgo
sudo mkdir -p /opt/goalgo/releases /etc/goalgo
sudo chown -R goalgo:goalgo /opt/goalgo
```

**3.3 Build and release**

Build on the VPS (or in CI, then copy the `.output` directory across). The VPS
build must target Node, not the edge runtime:

```sh
cd /opt/goalgo/releases
sudo -u goalgo git clone <your-repo-url> $(date +%Y%m%d%H%M%S)
cd <that-directory>
sudo -u goalgo npm ci
sudo -u goalgo env NITRO_PRESET=node_server npm run build
sudo ln -sfn "$PWD" /opt/goalgo/current
```

Node 20 or newer is required (`node -v`).

**3.4 Secrets file**

```sh
sudo install -m 600 -o root -g goalgo /dev/null /etc/goalgo/goalgo.env
sudo nano /etc/goalgo/goalgo.env     # one KEY=value per line, names from .env.example
```
This file is the only place production secrets exist. It is never in git.

**3.5 Service**

```sh
sudo cp deploy/goalgo.service /etc/systemd/system/goalgo.service
sudo systemctl daemon-reload
sudo systemctl enable --now goalgo
curl -s http://127.0.0.1:3000/api/public/health
```

**3.6 DNS and TLS**

```sh
# DNS: A record  app.goalgo.fairwoodit.com -> 210.56.147.234
sudo cp deploy/nginx-goalgo.conf /etc/nginx/sites-available/app.goalgo.fairwoodit.com
sudo ln -s /etc/nginx/sites-available/app.goalgo.fairwoodit.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.goalgo.fairwoodit.com
```
Add to the `http {}` block of `/etc/nginx/nginx.conf` if not already present:

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
limit_req_zone $binary_remote_addr zone=goalgo_hook:10m rate=10r/s;
```

**3.7 Firewall**

```sh
sudo ufw allow 80,443/tcp
# GOALGO listens on 127.0.0.1 only; keep the OpenAlgo port local too.
```

**3.8 Start / stop / restart / logs**

```sh
sudo systemctl start|stop|restart|status goalgo
journalctl -u goalgo -f
```

`Restart=always` plus `systemctl enable` means GOALGO comes back after a crash
or a reboot.

**3.9 Rollback**

Releases are timestamped directories and `current` is a symlink, so a rollback
is a symlink swap:

```sh
ls /opt/goalgo/releases
sudo ln -sfn /opt/goalgo/releases/<previous-timestamp> /opt/goalgo/current
sudo systemctl restart goalgo
curl -s http://127.0.0.1:3000/api/public/health
```
Database migrations are additive; if one must be undone, write a new reversing
migration rather than editing history.

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

---

## 7. Launch checklist

- [ ] OpenAlgo running and broker logged in
- [ ] All server environment variables set
- [ ] Database migrations applied
- [ ] HTTPS live on goalgo.fairwoodit.com, no ngrok
- [ ] Owner account created and `GOALGO_OWNER_USER_ID` set
- [ ] OpenAlgo and Broker pages both verified
- [ ] TradingView alert delivered end to end
- [ ] Automated trading switch tested off and on
- [ ] Emergency controls reviewed (square-off and cancel-all)
- [ ] Both services restart automatically after a reboot
