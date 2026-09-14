# GOALGO — Architecture

## Scope

One GOALGO deployment serves **one trader, one broker account, one OpenAlgo instance**.
There is no multi-tenancy, no organisations, no shared broker sessions.

## Runtime flow

```text
TradingView alert
      |  HTTPS POST + shared token
      v
GOALGO webhook   (src/routes/api/public/webhooks/tradingview.ts)
      |  records the signal, checks the server-side trading switch
      v
OpenAlgo strategy webhook  (POST /strategy/webhook/<token>)
      |
      v
OpenAlgo  ->  Broker  ->  Exchange
```

Browser reads never talk to OpenAlgo directly:

```text
Browser (React) -> TanStack server functions (Node/Worker) -> OpenAlgo REST /api/v1 -> Broker
```

## Components

| Layer | Location | Responsibility |
| --- | --- | --- |
| UI | `src/routes/_authenticated/*` | Pages; render only data returned by the backend |
| Shared UI | `src/components/goalgo/*` | Status dots, panels, data gates, order ticket |
| Backend API | `src/lib/openalgo.functions.ts` | Authenticated server functions, one per OpenAlgo capability |
| OpenAlgo client | `src/lib/openalgo/client.server.ts` | Server-only REST client; injects the API key; sanitises errors |
| Webhook receiver | `src/routes/api/public/webhooks/tradingview.ts` | Token-verified relay, signal persistence, kill switch |
| Database | Supabase Postgres | App metadata only |
| Auth | Supabase Auth | Email/password + Google; protected route subtree `_authenticated/` |

## OpenAlgo contract used

Base: `<OPENALGO_BASE_URL>/api/v1`. Auth: `apikey` field in the POST body.
Responses: `{ status: "success" | "error", data?, message? }`.

Endpoints called: `/ping`, `/analyzer`, `/analyzer/toggle`, `/funds`, `/orderbook`,
`/positionbook`, `/holdings`, `/tradebook`, `/orderstatus`, `/placeorder`,
`/modifyorder`, `/cancelorder`, `/cancelallorder`, `/closeposition`,
`/strategy/list`, `/strategy/start`, `/strategy/stop`, `/strategy/close_all`,
`/search`, `/quotes`. Public alert endpoint `/strategy/webhook/<token>` sits
outside `/api/v1`.

No endpoint is invented. Where the installed OpenAlgo version does not answer a
call, the UI shows an explicit error or "unavailable" state instead of data.

## Database (Supabase, RLS on every table)

| Table | Contents |
| --- | --- |
| `profiles` | id, email, full name |
| `app_settings` | OpenAlgo base URL, strategy name, `automated_trading_enabled`, `webhook_relay_enabled`, strategy webhook URL |
| `signals` | inbound TradingView alerts and their relay status (realtime enabled) |
| `audit_logs` | action, detail, severity, metadata |
| `connection_events` | target, status, latency, message |

Trading data (orders, positions, holdings, funds) is **never** mirrored here —
OpenAlgo remains the source of truth.

## Safety design

- `automated_trading_enabled` and `webhook_relay_enabled` are enforced in the
  webhook handler on the server. A disabled switch marks the signal `rejected`
  and returns HTTP 423 without forwarding.
- Every live action (place, modify, cancel, cancel-all, close-all, analyzer
  toggle, strategy start/stop) requires an explicit confirmation step and writes
  an audit row.
- Success is reported only when OpenAlgo returns `status: "success"`.
- Connection checks use read-only endpoints and never place orders.

## Production topology (single VPS 210.56.147.234, single public domain)

The VPS hosts **two independent applications behind one hostname**. Only GOALGO
is published. OpenAlgo listens on the loopback interface and is reached by
GOALGO over localhost. No second DNS record exists or is required.

```text
                      ┌──────────────── Ubuntu 24 VPS ────────────────┐
browser ── HTTPS ──►  │ nginx :443  goalgo.fairwoodit.com             │
                      │      └────────────► 127.0.0.1:3000  GOALGO    │
TradingView ─ POST ──►│  /api/public/webhooks/tradingview (token, rate limited)
                      │                       │                       │
                      │                       ▼ localhost only        │
                      │            127.0.0.1:5000  OpenAlgo ──► broker│
                      │            (systemd: openalgo, not published) │
                      └───────────────────────────────────────────────┘
                                   GOALGO ──► Supabase (managed Postgres + Auth)
```

| | OpenAlgo | GOALGO |
| --- | --- | --- |
| Installed by | official `install/install.sh` (marketcalls/openalgo) | `deploy/deploy.sh` in this repo |
| Root | `/var/python/openalgo` | `/opt/goalgo` |
| Service | `openalgo` | `goalgo` |
| Config | `/var/python/openalgo/.env` | `/etc/goalgo/goalgo.env` |
| Data | its own SQLite/Postgres store | Supabase (app metadata only) |
| Network | 127.0.0.1:5000, private | 127.0.0.1:3000 behind nginx :443 |
| Public address | none (SSH tunnel for the admin UI) | `https://goalgo.fairwoodit.com` |
| Holds broker credentials | yes | never |

Only one nginx vhost owns `goalgo.fairwoodit.com`. If OpenAlgo's installer
created one for the same hostname, GOALGO removes just that `sites-enabled`
symlink; the file in `sites-available` and the Let's Encrypt certificate remain,
and the certificate is reused. Neither deployment writes to the other's files,
service or database. `deploy/install-openalgo.sh` refuses to run at all when an
OpenAlgo install is already present.

If a broker's OAuth login needs a public callback, `OPENALGO_PUBLIC_PATHS`
proxies only those exact paths to OpenAlgo; nothing else of OpenAlgo is exposed.

The GOALGO Node server (Nitro `node_server` build, `.output/server/index.mjs`)
binds to localhost only; nginx is the sole public listener. Releases live in
`/opt/goalgo/releases/<timestamp>` with `/opt/goalgo/current` as the active
symlink, so a rollback is a symlink swap plus a service restart.

## Multi-user model and the broker boundary

GOALGO is multi-user at the account level and single-account at the broker
level. These are deliberately separate layers.

**Per user (isolated, unlimited accounts)**
- `profiles`, `app_settings`, `signals`, `audit_logs`, `connection_events`
- Every table has RLS scoped to `auth.uid()`; there is no id-based lookup path
  that crosses users, and the browser never holds a service-role key.

**Per deployment (single, shared)**
- One OpenAlgo instance on `localhost:5000`, one broker session, one
  `OPENALGO_API_KEY` held in the server environment only.
- `public.app_owner` links exactly one account to that connection — the
  *broker operator*. Every server function that talks to OpenAlgo runs behind
  `requireBrokerOperator` (`src/lib/broker-access.ts`), which checks the
  caller's own RLS-scoped row. Other signed-in users get a clear notice and no
  broker data or order actions.
- The TradingView relay records incoming signals against the broker operator,
  since the alert belongs to the single broker session.

### What independent per-user broker accounts would require

Per-user trading is **not** implemented and must not be faked. It needs, at
minimum:

1. Per-user OpenAlgo credentials stored server-side and encrypted at rest
   (Postgres `pgsodium`/vault or an external secret store), never in the
   browser and never in `.env`.
2. One OpenAlgo instance **per trader** (OpenAlgo binds one broker session per
   installation), each on its own port/unit, with a registry mapping user →
   instance, plus per-instance health, restart and upgrade handling.
3. A per-user webhook token and a distinct TradingView webhook URL per user,
   with the relay resolving the user from the token instead of the operator.
4. Per-user rate limiting, kill switches and audit separation, and a resource
   plan: N OpenAlgo instances on one VPS is a capacity and blast-radius
   decision, not a code change.

Until 1–4 exist, one deployment serves one trading account, and additional
users are workspace users only.
