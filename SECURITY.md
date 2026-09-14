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
