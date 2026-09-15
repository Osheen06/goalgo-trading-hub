# GOALGO authentication architecture and ownership

## Who controls what today

| Component | Controlled by | Changeable by you |
|---|---|---|
| Sign-in / sign-up / callback screens, redirect construction | Application code (`src/routes/auth.tsx`, `src/routes/auth_.callback.tsx`, `src/lib/auth-redirect.ts`) | Yes |
| `APP_URL` / `VITE_PUBLIC_APP_URL` (production origin used to build redirects) | VPS deployment env (`/etc/goalgo/goalgo.env`, written by `deploy/deploy.sh`) | Yes |
| Database schema, RLS, user rows | Supabase project `uzlvvmgfjzgosgaelnrh` (Lovable Cloud managed) | Yes, through migrations |
| Sign-in methods on/off, Google client ID/secret, email settings | Lovable Cloud backend UI | Yes |
| **Auth Site URL and redirect allow list** | Supabase Auth server config, Lovable-managed | **No** |
| OpenAlgo, broker session, Nginx, TLS | VPS | Yes |

## Can this be solved while staying on Lovable Cloud?

No — not by you, and not by code. The redirect allow list is enforced inside the
Supabase Auth server. No application code, environment variable, or Lovable
tool available to this project can change it; the Lovable Cloud backend UI does
not expose Site URL / redirect URLs, and Support has confirmed it cannot
currently be changed there. Any code that appeared to override it would be a
fake fix: Supabase silently rewrites a non-allowlisted `redirectTo` to the Site
URL, which is exactly the preview-domain bounce you are seeing.

Two real options:

1. **Stay on Lovable Cloud** — Support (or a future Lovable Cloud setting) sets
   Site URL `https://goalgo.fairwoodit.com` and adds
   `https://goalgo.fairwoodit.com/**`, keeping existing preview entries. Zero
   migration, but you stay dependent on them for future domain changes.
2. **Move Auth to a Supabase project you own** — you control Site URL, redirect
   list, providers and everything else, permanently. Plan below.

## What has been implemented now (works with either option)

An explicit application-environment concept, so redirects no longer depend on
whatever host the page happens to be served from:

- `VITE_PUBLIC_APP_URL` is compiled into the browser bundle from the
  deployment's `APP_URL` (`deploy/deploy.sh`, `deploy/goalgo.env.example`).
- `src/lib/auth-redirect.ts` resolves exactly one origin — the configured one,
  or the browser origin when nothing is configured (Lovable preview) — and only
  ever appends fixed in-app paths (`/auth/callback`, `/dashboard`,
  `/reset-password`). No redirect target is ever read from the URL, query
  string, or any other browser-supplied input.
- Google sign-in, sign-up confirmation, and password reset all use it.
- The console diagnostic prints the resolved origin plus whether it came from
  configuration or the browser. It never prints tokens, secrets, or keys.

This makes production redirects deterministic. It does **not** bypass the
Supabase allow list — the same URL must also be permitted server-side.

## Minimal migration path to a Supabase project you own

1. **Create one project** in your own Supabase organisation (same region).
2. **Move the schema**: run this repo's `supabase/migrations/*` against the new
   project in order. No data loss risk — it is the same definition set.
3. **Move the data**: `pg_dump --data-only --schema=public` from the current
   project, restore into the new one. Ask Lovable Support for a database dump
   (or use the connection string if available).
4. **Move the users**: copy `auth.users` and `auth.identities` rows
   (`--data-only --schema=auth --table=auth.users --table=auth.identities`).
   Password hashes and Google identity links transfer as-is, so existing
   accounts — including `hellokitty06032006@gmail.com` — keep working with the
   same passwords and the same Google login. User IDs are preserved, so all
   `auth.uid()`-based RLS ownership stays valid.
5. **Google OAuth**: keep the same Google Cloud client. Add the new project's
   callback `https://<new-ref>.supabase.co/auth/v1/callback` to the client's
   authorised redirect URIs, and paste the same client ID/secret into the new
   project's Google provider.
6. **Auth URL config (the whole point)**: Site URL
   `https://goalgo.fairwoodit.com`, redirect URLs
   `https://goalgo.fairwoodit.com/**` plus your preview URLs.
7. **Point production at it**: on the VPS only, set `SUPABASE_URL`,
   `VITE_SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `VITE_SUPABASE_PUBLISHABLE_KEY` (and `SUPABASE_SERVICE_ROLE_KEY` if used) to
   the new project, then re-run `deploy/deploy.sh`. Lovable preview keeps its
   own values, so preview auth is untouched and the two environments stay
   cleanly separated.
8. **Verify**: sign in with email/password as an existing user, sign in with
   Google from `https://goalgo.fairwoodit.com/auth`, confirm the browser stays
   on `goalgo.fairwoodit.com` through `/auth/callback` to `/dashboard`, and run
   `deploy/health-check.sh`.
9. **Cut over safely**: keep the old project untouched until step 8 passes; the
   rollback is reverting the four env values and re-running deploy.

No secrets belong in the repo at any step: service-role keys, the Google client
secret, and the OpenAlgo API key stay in `/etc/goalgo/goalgo.env` (mode 600) or
the provider dashboards.
