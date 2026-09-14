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
