# GOALGO — Pre-Migration Production Safety Verification

Verified against the repository migrations in `supabase/migrations/` and a
read-only inspection of the live project `uzlvvmgfjzgosgaelnrh`.
**Nothing was executed, created, or modified.**

---

## 1. Source region

Pooler host of the live project: `aws-0-ap-southeast-1.pooler.supabase.com`.

- Provider: AWS
- Region: **ap-southeast-1 (Singapore)**
- Instance size: Tiny, project not paused, managed by Lovable.

## 2. Target region to select

**AWS ap-southeast-1 (Singapore)** — same region as the source.
Rationale: your VPS (Pakistan/Asia) and broker/OpenAlgo traffic already
perform acceptably against this region, latency stays unchanged, and an
identical region removes region-specific behaviour from the cutover as a
variable. (`ap-south-1 / Mumbai` would be marginally closer for Indian
broker APIs, but broker traffic goes VPS → broker directly and never through
Supabase, so it gains nothing.)

## 3. Public tables and dependencies (confirmed)

| Table | PK | FK | Other columns | Indexes |
|---|---|---|---|---|
| `profiles` | `id uuid` | `id → auth.users(id) ON DELETE CASCADE` | `email`, `full_name`, `created_at` | `profiles_pkey` |
| `app_settings` | `user_id uuid` | `user_id → auth.users(id) CASCADE` | `openalgo_base_url`, `tradingview_strategy_name`, `automated_trading_enabled` (default false), `webhook_relay_enabled` (default true), `openalgo_strategy_webhook_url`, `updated_at` | `app_settings_pkey` |
| `signals` | `id uuid default gen_random_uuid()` | `user_id → auth.users(id) CASCADE` | `received_at`, `strategy`, `symbol`, `exchange`, `action`, `quantity`, `pricetype`, `product`, `status` (default `'received'`), `forwarded_at`, `broker_order_id`, `response_status`, `message`, `raw_payload jsonb` | `signals_pkey`, `signals_received_at_idx (received_at DESC)` |
| `audit_logs` | `id uuid default gen_random_uuid()` | `user_id → auth.users(id) CASCADE` | `action`, `detail`, `severity` (default `'info'`), `meta jsonb`, `created_at` | `audit_logs_pkey`, `audit_logs_created_at_idx (created_at DESC)` |
| `connection_events` | `id uuid default gen_random_uuid()` | `user_id → auth.users(id) CASCADE` | `target`, `status`, `latency_ms`, `message`, `created_at` | `connection_events_pkey`, `connection_events_created_at_idx (created_at DESC)` |
| `app_owner` | `singleton boolean CHECK (singleton)` | `user_id → auth.users(id) CASCADE` | `claimed_at` | `app_owner_pkey` |

No enums, no views, no storage buckets, no edge functions, no extensions
beyond Supabase defaults. Every table depends on `auth.users`, so **auth must
be restored before public data**.

Current row counts (source, read-only): `auth.users` 9, `auth.identities` 9
(3 Google), `profiles` 9, `app_settings` 9, `app_owner` 1, `signals` 0,
`audit_logs` 0, `connection_events` 0.

Grants (must be recreated exactly; no `anon` grants anywhere):

```sql
GRANT SELECT, INSERT, UPDATE ON public.profiles      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.app_settings  TO authenticated;
GRANT SELECT                 ON public.signals       TO authenticated;
GRANT SELECT, INSERT         ON public.audit_logs    TO authenticated;
GRANT SELECT, INSERT         ON public.connection_events TO authenticated;
GRANT SELECT                 ON public.app_owner     TO authenticated;
GRANT ALL ON public.profiles, public.app_settings, public.signals,
             public.audit_logs, public.connection_events, public.app_owner
          TO service_role;
```

## 4. RLS policies (verified live, exact)

RLS is ENABLED on all six tables. Eight policies, all `TO authenticated`:

```sql
-- profiles
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
-- app_settings
CREATE POLICY "own settings" ON public.app_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- signals
CREATE POLICY "own signals" ON public.signals FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
-- audit_logs
CREATE POLICY "own audit read" ON public.audit_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "own audit insert" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
-- connection_events
CREATE POLICY "own conn read" ON public.connection_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "own conn insert" ON public.connection_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
-- app_owner
CREATE POLICY "operators can read their own link" ON public.app_owner
  FOR SELECT TO authenticated USING (user_id = auth.uid());
```

No INSERT/UPDATE/DELETE policy exists for `signals`, and no write policy for
`app_owner` — those paths are service-role only. That is intentional.

## 5. Functions and triggers required after migration

Exactly one function and one trigger:

- `public.handle_new_user()` (SECURITY DEFINER, `search_path = public`)
- `on_auth_user_created` — `AFTER INSERT ON auth.users FOR EACH ROW`

Plus the hardening statement:

```sql
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
```

Historic functions `public.registration_open()` and
`public.is_broker_operator(uuid)` were **dropped** and must **not** be
recreated. Confirmed: no other functions exist in `public`.

## 6. Exact definition of `public.handle_new_user()` (live)

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- First account ever claims the broker-operator link. Later accounts simply
  -- do nothing here (ON CONFLICT) and are fully valid users.
  INSERT INTO public.app_owner (singleton, user_id)
  VALUES (true, NEW.id)
  ON CONFLICT (singleton) DO NOTHING;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.app_settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;
```

## 7. Can `auth.users` be restored with original UUIDs and passwords?

**Yes — technically**, provided you obtain a dump of the `auth` schema.
`auth.users.id` and `auth.users.encrypted_password` are ordinary columns; a
`pg_dump --data-only --schema=auth` insert restores both byte-for-byte, and
Supabase GoTrue verifies bcrypt hashes with no per-project salt or key. Users
keep their UUIDs, so every `auth.uid()`-based RLS row continues to match.
Caveat: restore as the `supabase_auth_admin` role, and restore the auth
schema **before** any public data.

## 8. Can `auth.identities` be restored with Google identities?

**Yes.** `auth.identities` stores `provider = 'google'`, `provider_id` (the
Google `sub`), `user_id`, and an `identity_data` JSON blob. None of it is
encrypted with a project-scoped key. Restoring the rows verbatim preserves
the Google links (3 Google identities exist today).

## 9. Will existing Google users map to the same `auth.users` rows?

**Yes, conditionally.** GoTrue matches an incoming Google login by
`(provider, provider_id)` → `auth.identities.user_id`. If both `auth.users`
and `auth.identities` are restored with original values **and** you keep the
same Google Cloud OAuth client (same `sub` values are issued per Google
project), the same person lands on the same UUID. If you created a *new*
Google OAuth client in a *different* Google Cloud project, the `sub` values
differ and users would be treated as new — so reuse the existing client.

## 10. Can the source export actually include `auth.users` / `auth.identities`?

**Not through any mechanism available to you or to me today.** Explicitly:

- I have read-only SQL access here; I cannot produce a `pg_dump`.
- Lovable Cloud does not expose the database password or a direct Postgres
  superuser connection string, so you cannot run `pg_dump` yourself.
- The Lovable **Cloud → Advanced settings → Export data** feature exports
  project data; it is **not documented to include the `auth` schema**, and I
  will not claim it does. Treat it as public-schema data only until you see
  `auth.users` in the output.
- `supabase db dump --linked` requires the project to be linked with its
  database password — same blocker.

**Conclusion:** obtaining `auth.users` + `auth.identities` requires **Lovable
Support** to either (a) provide a dump of the `auth` schema for project
`uzlvvmgfjzgosgaelnrh`, or (b) provide the database password / direct
connection string so you can dump it yourself.

Fallback if Support cannot provide it (accept only if you must):
re-invite the 3 real accounts on the new project. Password logins break
(users set a new password), Google logins work but **new UUIDs are issued**,
so `profiles`, `app_settings`, and `app_owner` rows must be re-keyed by
email. With today's data (9 users, 9 settings rows, 0 signals/audit/conn
rows) that is survivable, but it is a data-identity change, not a migration.

## 11. Exact procedure for obtaining the source export

Step 1 — request from Lovable Support (no credentials invented):

> Project `uzlvvmgfjzgosgaelnrh`. I am migrating to a Supabase project I own.
> Please provide either (a) a `pg_dump` of the `auth` and `public` schemas,
> or (b) the database connection string/password so I can run the dump
> myself. I need `auth.users` and `auth.identities` preserved with original
> UUIDs and password hashes.

Step 2 — once you have a connection string (`$SRC` = the full
`postgresql://...` URL they give you; never paste it into chat or a repo):

```bash
# Roles are managed by Supabase; do not dump them.
pg_dump "$SRC" --schema=public  --schema-only --no-owner --no-privileges \
  -f goalgo_public_schema.sql
pg_dump "$SRC" --schema=public  --data-only  --no-owner --column-inserts \
  -f goalgo_public_data.sql
pg_dump "$SRC" --schema=auth    --data-only  --no-owner --column-inserts \
  --table=auth.users --table=auth.identities \
  -f goalgo_auth_data.sql
```

Step 3 — store all three files outside the repository, mode `600`.

## 12. Target project creation settings

| Setting | Value |
|---|---|
| Organization | your own (company) Supabase org, not Lovable's |
| Project name | `goalgo-production` |
| Region | AWS `ap-southeast-1` (Singapore) |
| Postgres version | latest offered (match or exceed the source major version) |
| Plan | Pro recommended (daily backups, PITR option); Free works functionally |
| Database password | generate in the dashboard, store in your password manager |
| Data API | enabled, exposed schema `public` only |

Do **not** enable any sample data or templates.

## 13. Exact schema migration commands

Run against the **new** project (`$DST` = new project connection string):

```bash
supabase link --project-ref <NEW_REF>        # prompts for the new DB password
supabase db push                              # applies supabase/migrations/* in order
```

`supabase db push` reproduces every table, index, grant, RLS policy,
`handle_new_user()`, the `on_auth_user_created` trigger, and the realtime
publication, because they all live in `supabase/migrations/`.

**Then immediately drop the trigger before restoring data** (see §16):

```bash
psql "$DST" -c 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;'
```

Alternative to `db push`, if you prefer the dump: `psql "$DST" -f
goalgo_public_schema.sql`. Prefer `db push` — the repo migrations are the
source of truth.

## 14. Exact auth data restore commands

```bash
psql "$DST" -v ON_ERROR_STOP=1 -f goalgo_auth_data.sql
psql "$DST" -c "select count(*) from auth.users;"        # expect 9
psql "$DST" -c "select count(*) from auth.identities;"   # expect 9
psql "$DST" -c "select count(*) from auth.identities where provider='google';"  # expect 3
```

If the restore errors on ownership, prefix the file with
`SET session_authorization = supabase_auth_admin;` or run as the postgres
role provided by Supabase.

## 15. Exact public data restore commands

```bash
psql "$DST" -v ON_ERROR_STOP=1 -f goalgo_public_data.sql
psql "$DST" -c "select count(*) from public.profiles;"      # expect 9
psql "$DST" -c "select count(*) from public.app_settings;"  # expect 9
psql "$DST" -c "select * from public.app_owner;"            # expect 1 row, original user_id
```

## 16. Trigger creation command, and why it must come last

```bash
psql "$DST" -v ON_ERROR_STOP=1 -c "
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();"
```

**Why after the data restore:** the trigger fires on *every* insert into
`auth.users`, including the restore inserts. If it is active during the
restore it would, for each of the 9 restored users, attempt to claim
`app_owner` and create `profiles` / `app_settings` rows. Those inserts run
before your real `profiles` / `app_settings` restore, so the subsequent
restore would collide on primary keys (or, with `ON CONFLICT DO NOTHING`
semantics, silently leave you with trigger-generated defaults instead of your
real rows — `full_name`, `openalgo_base_url`, `automated_trading_enabled`
and friends would be reset to defaults). Worse, `app_owner` would be claimed
by whichever user happened to restore first, not your real operator.
Dropping the trigger for the restore and recreating it afterwards guarantees
the restored rows are exactly the source rows, while new sign-ups after
cutover still get their profile/settings automatically.

Also re-apply the hardening (already in the migrations, verify it survived):

```bash
psql "$DST" -c "REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;"
```

## 17. Exact realtime configuration commands

```bash
psql "$DST" -c "ALTER TABLE public.signals REPLICA IDENTITY FULL;"
psql "$DST" -c "ALTER PUBLICATION supabase_realtime ADD TABLE public.signals;"
psql "$DST" -c "select * from pg_publication_tables where schemaname='public';"  # expect signals
```

(`supabase db push` already includes both; run them only if the check shows
`signals` missing.)

## 18. Supabase Auth configuration on the new project

Dashboard → Authentication → URL Configuration:

- **Site URL:** `https://goalgo.fairwoodit.com`
- **Redirect URLs:**
  - `https://goalgo.fairwoodit.com/**`
  - (optional, only if you keep using the Lovable preview against the new
    project) `https://id-preview--34b00a99-a445-4823-a6df-cab0adc6b1a0.lovable.app/**`

Authentication → Sign In / Providers:

- **Email:** enabled. **Confirm email: ON** (matches current behaviour —
  restored users are already confirmed and are unaffected).
- **Signups:** enabled (`Allow new users to sign up` = ON). GOALGO is
  multi-user; broker access is gated in the app via `app_owner`, not by
  closing registration.
- **Google:** enabled, using the **same** Google Cloud OAuth client you
  already have (see §9). Paste the existing Client ID and Client Secret.
- **Anonymous sign-ins:** OFF.

Google Cloud Console → your existing OAuth client → Authorized redirect URIs:
**add** `https://<NEW_REF>.supabase.co/auth/v1/callback`
(keep the old `https://uzlvvmgfjzgosgaelnrh.supabase.co/auth/v1/callback`
entry until rollback is no longer possible). Also move the consent screen out
of "Testing" to "In production" if you want users beyond the test list.

## 19. VPS environment variables that change

In `/etc/goalgo/goalgo.env` (mode 600, root:goalgo) — **values not shown**:

| Variable | Change |
|---|---|
| `SUPABASE_URL` | → new project URL `https://<NEW_REF>.supabase.co` |
| `VITE_SUPABASE_URL` | → same new project URL |
| `SUPABASE_PUBLISHABLE_KEY` | → new project publishable/anon key |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | → same new publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | → new project service-role key (server-only; used solely by the TradingView webhook writer) |

Unchanged: `APP_URL`, `VITE_PUBLIC_APP_URL`, `PORT`, `HOST`, `NODE_ENV`,
`OPENALGO_BASE_URL`, `OPENALGO_API_KEY`, `GOALGO_WEBHOOK_TOKEN`,
`OPENALGO_STRATEGY_WEBHOOK_URL`.

Note: `VITE_*` values are compiled into the browser bundle, so the app must
be **rebuilt**, not just restarted:

```bash
sudo ./deploy/deploy.sh          # rebuilds with the new VITE_ values
sudo systemctl restart goalgo
sudo ./deploy/health-check.sh
```

Also update the defaults in `deploy/deploy.sh` (lines 45–46) so future
deployments do not silently fall back to the old project.

## 20. Pre-cutover checklist

- [ ] Auth dump obtained from Support and verified to contain `auth.users` **and** `auth.identities` with the original UUIDs.
- [ ] Public schema + data dumps taken; files stored mode 600 outside the repo.
- [ ] Row counts recorded from the source: users 9, identities 9 (3 Google), profiles 9, app_settings 9, app_owner 1, signals 0, audit_logs 0, connection_events 0.
- [ ] Target project created in `ap-southeast-1`, DB password stored safely.
- [ ] `supabase db push` applied cleanly to the target; 6 tables, 8 policies, 1 function present.
- [ ] Trigger `on_auth_user_created` dropped on the target before any restore.
- [ ] Google client's new redirect URI added, old one kept.
- [ ] Site URL and redirect allowlist set on the target.
- [ ] Current `/etc/goalgo/goalgo.env` backed up (`cp -a` to a root-only path).
- [ ] Maintenance window agreed; no open broker positions depending on TradingView signal recording during cutover.

## 21. Post-cutover checklist

- [ ] Counts on the target match the recorded source counts exactly.
- [ ] `app_owner.user_id` equals the original operator UUID.
- [ ] Trigger recreated; `select tgname from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal;` returns `on_auth_user_created`.
- [ ] `select count(*) from pg_policies where schemaname='public';` returns 8.
- [ ] Password sign-in works for `hellokitty06032006@gmail.com`.
- [ ] Google sign-in from `https://goalgo.fairwoodit.com/auth` returns to `https://goalgo.fairwoodit.com/auth/callback` and lands on `/dashboard` — **no lovable.app redirect**.
- [ ] A Google user's UUID after sign-in equals the pre-migration UUID.
- [ ] A fresh test sign-up creates exactly one `profiles` and one `app_settings` row and does **not** steal `app_owner`.
- [ ] Cross-user isolation test suite passes against the new project.
- [ ] Dashboard shows OpenAlgo reachable and the correct broker; `deploy/health-check.sh` all green.
- [ ] TradingView webhook: unauthorised POST → 401; authorised test alert → row in `signals`.
- [ ] Browser bundle contains no service-role key, OpenAlgo key, or `127.0.0.1:5000` (`grep -r` over `dist/`).
- [ ] Password reset email arrives and its link points at `goalgo.fairwoodit.com`.

## 22. Rollback (non-destructive to the old project)

The old project is never modified or deleted during this migration — it stays
live and fully functional throughout. Rollback is therefore an env-only
revert:

```bash
sudo cp -a /root/goalgo.env.backup /etc/goalgo/goalgo.env   # restores old SUPABASE_* values
sudo ./deploy/deploy.sh          # rebuild with the old VITE_ values
sudo systemctl restart goalgo
sudo ./deploy/health-check.sh
```

Plus: revert `deploy/deploy.sh` defaults if already changed. The old Google
redirect URI was kept (§18), so Google login works again immediately.

Caveat: any account created, or signal/audit row written, **after** cutover
lives only on the new project and will not exist after rollback. Keep the
cutover window short and re-export the new project's data before rolling back
if anything was written. Leave the old project untouched for at least 30 days
before considering deletion.

## 23. OpenAlgo / broker / nginx / systemd / trading logic

**Confirmed: no change required to any of them.**

- OpenAlgo stays private on `127.0.0.1:5000`, same install, same API key.
- Broker credentials live inside OpenAlgo and are never touched.
- Nginx config is unchanged — the domain, TLS cert, and proxy to
  `127.0.0.1:3000` are unaffected by which Supabase project is used.
- The `goalgo` systemd unit is unchanged (it reads `/etc/goalgo/goalgo.env`;
  only values inside that file change).
- Trading logic in `src/lib/openalgo.functions.ts` is unchanged; it talks to
  OpenAlgo over loopback and uses Supabase only for auth and record-keeping.

## 24. Can the app be pointed at the new project purely by env vars?

**Yes.** Every Supabase reference in the code reads from environment:
`src/integrations/supabase/client.ts` (`VITE_SUPABASE_URL` /
`VITE_SUPABASE_PUBLISHABLE_KEY`, falling back to the server vars),
`auth-middleware.ts` (`SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`), and
`client.server.ts` (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`). No project
ref is hardcoded in application code. The only hardcoded occurrence is the
convenience *default* in `deploy/deploy.sh` lines 45–46, which must be updated
so it cannot reintroduce the old project on a future run. Auth redirects are
already driven by `VITE_PUBLIC_APP_URL` via `src/lib/auth-redirect.ts`.
Trading architecture is untouched.

## 25. Lovable Cloud dependency after migration

**Zero runtime dependency**, once §19 is applied and the app is rebuilt:

- Database and auth → your own Supabase project.
- Hosting, TLS, process supervision → your VPS (Nginx + systemd).
- Execution layer → your OpenAlgo install on the same VPS.
- Code → your GitHub repository; deploys run from the VPS.

Lovable remains useful only as an optional development/preview environment.
If you keep the preview working, point it at the new project as well (or at a
separate development project) — production will not depend on it either way.

---

### Two blockers to clear before execution

1. **§10 — the auth dump.** Without it, original UUIDs and password hashes
   cannot be preserved. This needs Lovable Support; there is no command I can
   give you that works around it.
2. **§18 — the Google consent screen** must list every user (or be published)
   before Google sign-in works for non-test accounts on the new project.

Nothing in this document has been executed.
