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

## 3. VPS, domain and SSL

1. Keep the existing OpenAlgo service untouched; confirm it still answers on its own port.
2. Deploy GOALGO as its own service on a different port (for example 3000).
3. Point `goalgo.fairwoodit.com` at the VPS with an A record.
4. Terminate TLS with nginx + Let's Encrypt (`certbot --nginx -d goalgo.fairwoodit.com`),
   proxying HTTPS to the GOALGO port. No ngrok anywhere.
5. Run GOALGO under systemd with `Restart=always` so it survives reboots; the same applies
   to OpenAlgo.
6. Allow only 80/443 publicly; keep the OpenAlgo port bound to localhost.

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
