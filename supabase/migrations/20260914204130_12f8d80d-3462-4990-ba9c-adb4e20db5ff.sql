-- 1. Registration is open to everyone. The first account remains linked as the
--    broker operator (the account bound to this deployment's single OpenAlgo /
--    broker session), but later registrations are accepted normally.
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

-- 2. registration_open() is kept for compatibility but registration is always open.
CREATE OR REPLACE FUNCTION public.registration_open()
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT true;
$function$;

-- 3. Ownership boundary helper: is this user the broker operator for this
--    deployment (the single OpenAlgo/broker session)?
CREATE OR REPLACE FUNCTION public.is_broker_operator(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_owner WHERE singleton AND user_id = _user_id
  );
$function$;

REVOKE ALL ON FUNCTION public.is_broker_operator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_broker_operator(uuid) TO authenticated;

-- 4. Tighten app_owner: a signed-in user may only see the row when it is their
--    own link, so one user cannot enumerate another user's id.
DROP POLICY IF EXISTS "owner row is readable by signed-in users" ON public.app_owner;
CREATE POLICY "operators can read their own link"
  ON public.app_owner FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 5. Re-assert per-user isolation on every user-owned table.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_owner ENABLE ROW LEVEL SECURITY;
