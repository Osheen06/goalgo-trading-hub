# GOALGO — migration plan: Lovable-managed Supabase → self-owned Supabase

Status: **PLAN ONLY — nothing executed.** No project created, nothing changed
in `uzlvvmgfjzgosgaelnrh`, no VPS/OpenAlgo/Nginx/app change.

Source project ref: `uzlvvmgfjzgosgaelnrh` (Lovable-managed)
Target project ref: `<NEW_REF>` (yours, created in step 1 of the runbook)
Production app: `https://goalgo.fairwoodit.com` (VPS 210.56.147.234)

---

## 1. Exact source database objects that must be migrated

All live in schema `public` (verified against `supabase/migrations/*` and the live schema).

### Tables, keys, indexes

| Table | Columns | PK | FK | Indexes |
|---|---|---|---|---|
| `profiles` | `id uuid`, `email text`, `full_name text`, `created_at timestamptz NOT NULL default now()` | `id` | `id → auth.users(id) ON DELETE CASCADE` | PK only |
| `app_settings` | `user_id uuid`, `openalgo_base_url text`, `tradingview_strategy_name text`, `automated_trading_enabled boolean NOT NULL default false`, `webhook_relay_enabled boolean NOT NULL default true`, `openalgo_strategy_webhook_url text`, `updated_at timestamptz NOT NULL default now()` | `user_id` | `user_id → auth.users(id) CASCADE` | PK only |
| `signals` | `id uuid default gen_random_uuid()`, `user_id uuid`, `received_at timestamptz NOT NULL default now()`, `strategy`, `symbol`, `exchange`, `action`, `quantity`, `pricetype`, `product` (all text), `status text NOT NULL default 'received'`, `forwarded_at timestamptz`, `broker_order_id text`, `response_status text`, `message text`, `raw_payload jsonb` | `id` | `user_id → auth.users(id) CASCADE` | `signals_received_at_idx (received_at DESC)` |
| `audit_logs` | `id uuid default gen_random_uuid()`, `user_id uuid`, `action text NOT NULL`, `detail text`, `severity text NOT NULL default 'info'`, `meta jsonb`, `created_at timestamptz NOT NULL default now()` | `id` | `user_id → auth.users(id) CASCADE` | `audit_logs_created_at_idx (created_at DESC)` |
| `connection_events` | `id uuid default gen_random_uuid()`, `user_id uuid`, `target text NOT NULL`, `status text NOT NULL`, `latency_ms integer`, `message text`, `created_at timestamptz NOT NULL default now()` | `id` | `user_id → auth.users(id) CASCADE` | `connection_events_created_at_idx (created_at DESC)` |
| `app_owner` | `singleton boolean default true CHECK (singleton)`, `user_id uuid NOT NULL`, `claimed_at timestamptz NOT NULL default now()` | `singleton` | `user_id → auth.users(id) CASCADE` | PK only |

### Grants (required — PostgREST fails without them)

- `profiles`: SELECT, INSERT, UPDATE → `authenticated`; ALL → `service_role`
- `app_settings`: SELECT, INSERT, UPDATE → `authenticated`; ALL → `service_role`
- `signals`: SELECT → `authenticated`; ALL → `service_role`
- `audit_logs`: SELECT, INSERT → `authenticated`; ALL → `service_role`
- `connection_events`: SELECT, INSERT → `authenticated`; ALL → `service_role`
- `app_owner`: SELECT → `authenticated`; ALL → `service_role`
- No `anon` grants anywhere (every policy is `auth.uid()`-scoped).

### RLS policies (RLS enabled on all six tables)

- `profiles` — "own profile" `FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id)`
- `app_settings` — "own settings" `FOR ALL TO authenticated USING/CHECK (auth.uid() = user_id)`
- `signals` — "own signals" `FOR SELECT TO authenticated USING (auth.uid() = user_id)` (no insert/update/delete policy: writes only via service role)
- `audit_logs` — "own audit read" SELECT, "own audit insert" INSERT `auth.uid() = user_id`
- `connection_events` — "own conn read" SELECT, "own conn insert" INSERT `auth.uid() = user_id`
- `app_owner` — "operators can read their own link" `FOR SELECT TO authenticated USING (user_id = auth.uid())`; no write policy

### Functions and triggers

- `public.handle_new_user()` — `SECURITY DEFINER`, `SET search_path = public`. Current (final) body: claim `app_owner` with `ON CONFLICT (singleton) DO NOTHING`, then insert `profiles` and `app_settings`. `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`.
- Trigger `on_auth_user_created` — `AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()`. **Must be recreated manually on the target**; it lives in the `auth` schema and is not part of a `public`-only dump.
- Dropped and must NOT be recreated: `public.registration_open()`, `public.is_broker_operator(uuid)`.

### Enums / extensions / realtime

- Enums: **none**.
- Extensions: `pgcrypto` for `gen_random_uuid()` (present by default on Supabase).
- Realtime: `ALTER TABLE public.signals REPLICA IDENTITY FULL;` and `ALTER PUBLICATION supabase_realtime ADD TABLE public.signals;` — must be re-applied on the target.
- Storage buckets: none. Edge functions: none. Cron: none.

---

## 2. Exact auth data that must be preserved

| Object | Why | How |
|---|---|---|
| `auth.users` | user UUIDs are the ownership key for every table via `auth.uid()`; `encrypted_password` preserves existing passwords; `email_confirmed_at` preserves confirmed status | data-only dump/restore, IDs preserved |
| `auth.identities` | Google identity links (`provider='google'`, `provider_id` = Google `sub`) and the `email` identity rows; without these, Google login creates *new* users | data-only dump/restore |
| `auth.mfa_factors` / `auth.mfa_amr_claims` | only if MFA is ever enabled (currently none) | skip |
| `auth.sessions`, `auth.refresh_tokens` | **deliberately not migrated** — everyone signs in again once after cutover | skip |

Accounts to preserve (3 real): `hellokitty06032006@gmail.com`,
`poonamyadav170506@gmail.com`, `osheenmalhotra1588@gmail.com`.
The 5 `goalgo-selftest-*@example.com` rows are unconfirmed test accounts and may be excluded.

**Critical ordering:** restore `auth.users` **before** `public.*` data (FKs), and
create the `on_auth_user_created` trigger **after** the auth restore, otherwise
the trigger fires during restore and duplicates `profiles`/`app_settings` rows.

---

## 3. Exact application data that must be preserved

`public.profiles`, `public.app_settings`, `public.app_owner` (the broker-operator
link — losing it breaks trading access), `public.signals`, `public.audit_logs`,
`public.connection_events`. All data-only, same UUIDs.

Not in the database, therefore unaffected: OpenAlgo API key, webhook token,
broker credentials — all in `/etc/goalgo/goalgo.env` on the VPS.

---

## 4. Exact order of migration

1. Back up the source (section 6). Verify dump files are non-empty.
2. Create the new Supabase project in your own org (same region: keep latency identical).
3. Apply schema: run this repo's migrations against the target, then manually add the realtime config and the `auth.users` trigger *later* (step 6).
4. **Drop/disable the `on_auth_user_created` trigger on the target** before loading data.
5. Restore `auth.users` + `auth.identities` (data only).
6. Restore `public` data in FK-safe order: `profiles`, `app_settings`, `app_owner`, `signals`, `audit_logs`, `connection_events`. Then create the `on_auth_user_created` trigger and apply the realtime statements.
7. Configure target Auth: Site URL, redirect allow list, Google provider, email settings, signup enabled, email confirmations as today.
8. Add the new project's callback URL to the existing Google OAuth client.
9. Verify (section 7) against the target while production still points at the old project.
10. Cut over the VPS env vars (section 8) and re-run `sudo ./deploy/deploy.sh`.
11. Post-cutover verification: Google login, email login, password reset, dashboard, TradingView webhook, `deploy/health-check.sh`.
12. Keep the old project untouched and read-only for at least 7 days.

---

## 5. Exact Supabase CLI commands

Prerequisites: `supabase` CLI v2+, `psql`/`pg_dump` v15+, the **source** database
connection string (request it from Lovable Support for `uzlvvmgfjzgosgaelnrh`;
Lovable Cloud does not expose the DB password in the UI), and the **target**
connection string from your own project's dashboard.

```bash
# Never put these in the repo or shell history files.
export SRC_DB="postgresql://postgres:<SRC_PASSWORD>@db.uzlvvmgfjzgosgaelnrh.supabase.co:5432/postgres"
export DST_DB="postgresql://postgres:<DST_PASSWORD>@db.<NEW_REF>.supabase.co:5432/postgres"

# 3. Schema onto the target, from this repo
supabase link --project-ref <NEW_REF>
supabase db push                      # applies supabase/migrations/* in order

# 4. Keep the signup trigger out of the way during restore
psql "$DST_DB" -c 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;'

# 5. Auth data
psql "$DST_DB" -v ON_ERROR_STOP=1 -f backups/auth.sql

# 6. Application data, then trigger + realtime
psql "$DST_DB" -v ON_ERROR_STOP=1 -f backups/public-data.sql
psql "$DST_DB" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
ALTER TABLE public.signals REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.signals;
SQL
```

Auth settings (step 7) are dashboard-side on your own project:
Authentication → URL Configuration → Site URL `https://goalgo.fairwoodit.com`,
Redirect URLs `https://goalgo.fairwoodit.com/**` (plus preview URLs if you still
use Lovable preview); Providers → Email on, Google on; Sign-ups enabled;
email confirmations as today.

---

## 6. Exact backup commands

```bash
mkdir -p backups && chmod 700 backups

# Full safety net (schema + data, everything)
pg_dump "$SRC_DB" --no-owner --no-privileges -Fc -f backups/full-$(date +%F).dump

# Auth data only (users + identities), no schema
pg_dump "$SRC_DB" --data-only --no-owner --no-privileges \
  --table=auth.users --table=auth.identities \
  -f backups/auth.sql

# Application data only
pg_dump "$SRC_DB" --data-only --no-owner --no-privileges \
  --schema=public -f backups/public-data.sql

# Reference copy of the source schema (for diffing after restore)
pg_dump "$SRC_DB" --schema-only --no-owner --no-privileges \
  --schema=public -f backups/public-schema.sql

ls -l backups/            # all four files must be non-empty
```

Also save, before cutover: `sudo cp /etc/goalgo/goalgo.env /root/goalgo.env.bak-$(date +%F)` (mode 600).

---

## 7. Exact verification commands

```bash
# Row counts must match between source and target
for t in profiles app_settings app_owner signals audit_logs connection_events; do
  echo -n "$t src="; psql "$SRC_DB" -tAc "select count(*) from public.$t";
  echo -n "$t dst="; psql "$DST_DB" -tAc "select count(*) from public.$t";
done
psql "$SRC_DB" -tAc "select count(*) from auth.users"; psql "$DST_DB" -tAc "select count(*) from auth.users"
psql "$SRC_DB" -tAc "select count(*) from auth.identities where provider='google'"
psql "$DST_DB" -tAc "select count(*) from auth.identities where provider='google'"

# UUIDs preserved and the broker-operator link intact
psql "$DST_DB" -tAc "select user_id from public.app_owner"
psql "$SRC_DB" -tAc "select user_id from public.app_owner"   # must be identical

# RLS on, policies present
psql "$DST_DB" -c "select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r';"
psql "$DST_DB" -c "select tablename, policyname, cmd from pg_policies where schemaname='public' order by 1,2;"

# Trigger + realtime
psql "$DST_DB" -c "select tgname from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal;"
psql "$DST_DB" -c "select tablename from pg_publication_tables where pubname='supabase_realtime';"

# Schema diff against the source reference
pg_dump "$DST_DB" --schema-only --no-owner --no-privileges --schema=public -f /tmp/dst-schema.sql
diff backups/public-schema.sql /tmp/dst-schema.sql

# Anonymous access must return nothing (RLS proof) — publishable key only
curl -s "https://<NEW_REF>.supabase.co/rest/v1/profiles?select=id" \
  -H "apikey: <NEW_PUBLISHABLE_KEY>"        # expect []

# Application suite (in the repo, pointed at the new project)
npm ci && npx tsgo --noEmit && npx vitest run && NITRO_PRESET=node_server npm run build
```

After cutover, on the VPS: `sudo ./deploy/health-check.sh`, then in a browser
sign in with password, sign in with Google (must stay on
`goalgo.fairwoodit.com` through `/auth/callback` → `/dashboard`), request a
password reset, and fire one TradingView test alert.

---

## 8. Exact environment variables that must change on the VPS

Only `/etc/goalgo/goalgo.env` (mode 600, root:goalgo). Nothing else on the VPS changes.

| Variable | New value |
|---|---|
| `SUPABASE_URL` | `https://<NEW_REF>.supabase.co` |
| `VITE_SUPABASE_URL` | `https://<NEW_REF>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | new project's publishable/anon key |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | same publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | new project's service-role key (server-only; used by the TradingView webhook) |
| `VITE_SUPABASE_PROJECT_ID` (if present) | `<NEW_REF>` |

Unchanged: `APP_URL`, `VITE_PUBLIC_APP_URL`, `OPENALGO_BASE_URL`,
`OPENALGO_API_KEY`, `GOALGO_WEBHOOK_TOKEN`, `OPENALGO_STRATEGY_WEBHOOK_URL`,
`PORT`, `HOST`, `NODE_ENV`.

Then: `sudo ./deploy/deploy.sh` (rebuilds so the publishable values are compiled
into the bundle) and `sudo systemctl status goalgo`.

---

## 9. Exact Google OAuth configuration required

Same Google Cloud project and same OAuth client — no new client needed.

1. Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client ID.
2. Authorised redirect URIs → **add** `https://<NEW_REF>.supabase.co/auth/v1/callback`. Keep the existing `https://uzlvvmgfjzgosgaelnrh.supabase.co/auth/v1/callback` until rollback is no longer possible.
3. Authorised JavaScript origins → `https://goalgo.fairwoodit.com`.
4. OAuth consent screen: publish it (or keep every real user in the test-user list — testing mode blocks anyone not listed).
5. New Supabase project → Authentication → Providers → Google: enable, paste the same Client ID and Client Secret.
6. Because the client secret was pasted into chat earlier, rotate it in Google *after* both projects hold the new value, or immediately after the old project is retired.

Identity continuity: `auth.identities` rows carry the Google `sub`, so existing
Google users map to their existing UUIDs and keep all their data.

---

## 10. Rollback procedure

Rollback is env-only while the source project stays untouched.

1. Restore the env file: `sudo cp /root/goalgo.env.bak-<date> /etc/goalgo/goalgo.env && sudo chmod 600 /etc/goalgo/goalgo.env`.
2. `sudo ./deploy/deploy.sh` (or `sudo ./deploy/rollback.sh` to relink the previous release), then `sudo systemctl restart goalgo`.
3. Verify: `sudo ./deploy/health-check.sh`, sign in with password and with Google.
4. Leave the new project in place for a second attempt; nothing in the old project was written to.
5. If data was created on the new project during the trial window, re-export it (`pg_dump --data-only --schema=public`) before retrying, so nothing is lost.
6. Worst case (source damaged — should not happen, this plan never writes to it): `pg_restore --clean --no-owner --no-privileges -d "$SRC_DB" backups/full-<date>.dump`.

---

## Resulting ownership

| Layer | After migration |
|---|---|
| GitHub repository | You |
| Database + schema/migrations | You |
| Auth: Site URL, redirect allow list, providers, email | **You** |
| Google OAuth client | You (already) |
| VPS, Nginx, TLS, OpenAlgo, broker | You (already) |
| GOALGO runtime + deployment | You (already) |
| Lovable | Optional development tool only — production runs without it |

**Known dependency to resolve before step 2:** the source database connection
string for `uzlvvmgfjzgosgaelnrh`. Lovable Cloud does not expose the database
password, so either Support provides it / a full dump, or the Cloud → Advanced
settings → Export data path is used instead of `pg_dump` for the source side.
Everything else in this plan is executable by you.
