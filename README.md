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
webhook URL. Registration is open: anyone can create an account with email and password and
gets a private, isolated workspace. The first account registered on a
deployment stays linked to that installation's single OpenAlgo/broker
connection (the "trading account"); other accounts see their own data only and
have no access to broker funds, orders, positions or order actions.
`GOALGO_OWNER_USER_ID` only overrides which account TradingView signals are
attributed to.

## Production deployment (Ubuntu 24 VPS)

One public domain, no extra DNS record. The VPS hosts GOALGO publicly at
`https://goalgo.fairwoodit.com` (port 3000, service `goalgo`) and OpenAlgo
privately on `http://127.0.0.1:5000` (service `openalgo`, never published).
nginx terminates HTTPS and proxies to GOALGO; GOALGO reaches OpenAlgo over
localhost only.

```sh
git clone https://github.com/OWNER/REPO.git /opt/goalgo/src && cd /opt/goalgo/src
sudo ./deploy/deploy-all.sh --check   # inspect the server, change nothing
sudo ./deploy/deploy-all.sh           # OpenAlgo (if absent) then GOALGO
./deploy/health-check.sh https://goalgo.fairwoodit.com
```

The OpenAlgo admin UI stays private; reach it with an SSH tunnel:
`ssh -N -L 5000:127.0.0.1:5000 root@<vps>` then open `http://localhost:5000`.

For a **private** repository run `sudo ./deploy/setup-github-access.sh` first —
it creates a read-only deploy key on the server and prints the public half to
paste into GitHub → Settings → Deploy keys. See DEPLOYMENT.md Phase 2.

`deploy/` contains `bootstrap.sh` (prerequisites + clone + handover),
`setup-github-access.sh` (deploy key for private repos), `deploy-all.sh`
(master), `install-openalgo.sh` (safe wrapper around OpenAlgo's **official**
installer — it stops if OpenAlgo already exists), `deploy.sh` (GOALGO),
`update.sh` (pull + rebuild + auto-rollback), `rollback.sh`, `health-check.sh`,
the systemd unit, the nginx site and the production env template. Nothing here
modifies OpenAlgo's files, service, database, vhost or certificate.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — components, OpenAlgo contract, data model
- [SECURITY.md](./SECURITY.md) — secret handling, validation, audit policy
- [DEPLOYMENT.md](./DEPLOYMENT.md) — exact copy-paste VPS procedure, TLS, rollback, troubleshooting


## Safety

Every action that can reach the broker requires explicit confirmation, is
audited, and reports success only when OpenAlgo confirms it. Connection tests
never place orders.
