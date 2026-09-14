# GOALGO — Security

## Secret handling

| Secret | Where it lives | Reaches the browser? |
| --- | --- | --- |
| `OPENALGO_API_KEY` | Server environment only | Never |
| `OPENALGO_STRATEGY_WEBHOOK_URL` | Server environment only | Never |
| `GOALGO_WEBHOOK_TOKEN` | Server environment only | Never |
| `SUPABASE_SERVICE_ROLE_KEY` | Server environment only | Never |
| Broker credentials | OpenAlgo's own configuration | Never — GOALGO never stores or receives them |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Client bundle | Yes, by design (publishable) |

`.env` is git-ignored. `.env.example` lists names only. No secret is logged,
returned in an API response, placed in a URL, or written to `localStorage`.

## Boundaries

- All OpenAlgo calls run in server functions (`createServerFn`) guarded by
  `requireSupabaseAuth`; the request bearer token is validated server-side.
- A route guard is UX only — the security boundary is the middleware on each
  server function.
- `src/lib/openalgo/client.server.ts` is server-only and is dynamically imported
  inside handlers so it cannot leak into a client bundle.
- Environment variables are read inside handlers, never at module scope.

## Input validation

Every server function and the webhook route validate input with Zod:
enumerated exchanges, order types and products, integer quantity bounds,
string length caps. OpenAlgo itself rejects undeclared fields.

## Webhook security

`POST /api/public/webhooks/tradingview` requires the shared token in the
`x-goalgo-token` header or a `?token=` parameter, compared in constant time.
Rejected calls return 401 with no detail. Any `apikey` present in an alert
payload is stripped before the signal is persisted.

## Error handling

`sanitizeMessage()` masks the API key and any `apikey`/`token`/`password`/
`secret` pair in upstream text and truncates to 400 characters before an error
can reach the browser. Stack traces and server configuration are never returned.

## Audit log

Recorded: sign-in, connection checks, order place/modify/cancel, cancel-all,
close-all, analyzer mode change, strategy start/stop, settings changes, errors.
Never recorded: passwords, API keys, tokens, broker or VPS credentials.

## Transport

Production runs behind Nginx with TLS (Let's Encrypt), HSTS, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, and a restrictive
`Permissions-Policy`. The app is same-origin: the browser calls only GOALGO, so
no cross-origin CORS allowance is required. The public webhook route is the only
unauthenticated endpoint and is token-protected.

## Reporting

Report suspected issues to the company's internal security contact. Rotate
`OPENALGO_API_KEY` and `GOALGO_WEBHOOK_TOKEN` immediately if either is exposed,
then restart the GOALGO service.

## Secrets at rest in production

All production secrets live in `/etc/goalgo/goalgo.env`, mode `600`, owner
`root:goalgo`, read only by systemd when starting the service. They are not in
git (`.gitignore` covers `.env*`, `goalgo.env`, `*.pem`, `*.key`), not in the
browser bundle (only `APP_URL` and the two `VITE_SUPABASE_*` publishable values
are client-visible), not in URLs, not in `localStorage`, and never printed by
the deploy, update, rollback or health-check scripts. Broker credentials are
never held by GOALGO at all — they exist only inside OpenAlgo.

The health endpoint returns booleans only; its deeper OpenAlgo probe requires
the `x-goalgo-token` header so it cannot be used to fingerprint or flood the
trading server.


## Single-owner model

This deployment serves exactly one trader. The first account that registers is
recorded in `public.app_owner` by a `SECURITY DEFINER` trigger; every later
registration is refused by the database, so no one can create a second account
even if the sign-up form is reached directly. Inbound TradingView signals are
attributed to that owner, which removes the need for a `GOALGO_OWNER_USER_ID`
environment variable.

`public.registration_open()` is intentionally callable without signing in. It
returns a single boolean and no account data, so the sign-in page can hide the
sign-up tab once the owner exists.

## Secrets on the server

`/etc/goalgo/goalgo.env` is created by `deploy.sh` with mode 600, owner
`root:goalgo`. Secrets are read with hidden input, never echoed, never written to
shell history by the script, and never printed in any log line or summary. The
webhook token is generated with `openssl rand -hex 32` and reused on every later
deployment run.

## Note on the committed `.env`

The Lovable workspace tracks a `.env` file that contains **only public values**
(`SUPABASE_URL`, `SUPABASE_PROJECT_ID`, `SUPABASE_PUBLISHABLE_KEY` and their
`VITE_` twins) — the same values shipped in the browser bundle. No server-side
secret is ever written there: production secrets exist only in
`/etc/goalgo/goalgo.env` on the VPS. Any other `.env*` file is git-ignored.

## Two applications, one server, one public domain

OpenAlgo and GOALGO run on the same VPS as separate services with separate
configuration files and separate secrets. Only GOALGO is published:
nginx serves `https://goalgo.fairwoodit.com` and proxies to GOALGO on
127.0.0.1:3000, while OpenAlgo listens on 127.0.0.1:5000 and is not reachable
from the internet. Its admin UI is reached through an SSH tunnel
(`ssh -N -L 5000:127.0.0.1:5000 root@<vps>`). If a broker's OAuth flow requires
a public callback, only that exact path is proxied to OpenAlgo, via
`OPENALGO_PUBLIC_PATHS`; no admin or API surface is exposed.

| | OpenAlgo | GOALGO |
| --- | --- | --- |
| Secrets file | `/var/python/openalgo/.env` (installer-owned) | `/etc/goalgo/goalgo.env`, mode 600, `root:goalgo` |
| Broker credentials | stored here, entered in the official installer's hidden prompts | never present |
| API key | issued here | consumed server-side only |

GOALGO's scripts never read, write, print or back up OpenAlgo's configuration;
`deploy/install-openalgo.sh` aborts rather than touch an existing install. When
both want the same hostname, GOALGO removes only the conflicting
`sites-enabled` symlink — the vhost file and the certificate are preserved.

## VPS access credentials

The VPS root password (or SSH key) is **never** stored in this repository, in
`.env`, in any deployment script, in documentation or in logs, and is never sent
to or requested by the application. SSH is performed manually by the operator.
If that password has been exposed anywhere, change it on the server
(`passwd`) and prefer key-only SSH (`PasswordAuthentication no`).
