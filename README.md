# GOALGO

A single-trader algorithmic trading front end for an existing OpenAlgo
installation. GOALGO never executes trades itself — OpenAlgo is the execution
layer and the source of truth for all broker data.

```text
TradingView -> GOALGO webhook -> OpenAlgo -> Broker -> Exchange
```

## What it does

- Dashboard with real connection, broker, funds, P&L, orders and signal status
- Signals feed (realtime), Orders with place / modify / cancel through OpenAlgo
- Positions, Holdings, Funds, Market data, Strategies
- Broker page showing the capabilities the installed OpenAlgo actually answers
- TradingView page with the production webhook URL and alert format
- OpenAlgo page with connection checks and health history
- Activity log (audit + connection events) and Settings with a server-enforced
  automated-trading kill switch and confirmed emergency controls

Anything the installed OpenAlgo version does not support is shown as
unavailable — never simulated.

## Stack

TanStack Start (React 19, Vite 7) · Tailwind v4 · shadcn/ui · Supabase
(Postgres + Auth, RLS on every table).

## Local development

```sh
bun install
cp .env.example .env   # fill in values; .env is git-ignored
bun run dev            # http://localhost:8080
```

## Required configuration

See `.env.example` for the full list of names. On the VPS, `deploy.sh` fills in
everything it can derive (`APP_URL`, `OPENALGO_BASE_URL`, the public Supabase
values) and generates `GOALGO_WEBHOOK_TOKEN`; it asks only for the OpenAlgo API
key and, optionally, the Supabase service-role key and the OpenAlgo strategy
webhook URL. There is no `GOALGO_OWNER_USER_ID` to set — the first account that
registers becomes the owner of the deployment and registration then closes.

## Production deployment (Ubuntu 24 VPS)

```sh
git clone <repo> /opt/goalgo/src && cd /opt/goalgo/src
sudo ./deploy/deploy.sh          # checks, secrets prompt, build, service, nginx, TLS
./deploy/health-check.sh https://app.goalgo.fairwoodit.com
```

`deploy/` also contains `update.sh` (pull + rebuild + auto-rollback),
`rollback.sh`, `health-check.sh`, the systemd unit, the nginx site and the
production env template. The scripts never touch the existing OpenAlgo
installation on the same server.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — components, OpenAlgo contract, data model
- [SECURITY.md](./SECURITY.md) — secret handling, validation, audit policy
- [DEPLOYMENT.md](./DEPLOYMENT.md) — exact copy-paste VPS procedure, TLS, rollback, troubleshooting


## Safety

Every action that can reach the broker requires explicit confirmation, is
audited, and reports success only when OpenAlgo confirms it. Connection tests
never place orders.
