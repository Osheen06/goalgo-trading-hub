CREATE TABLE public.app_owner (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claimed_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_owner TO authenticated;
GRANT ALL ON public.app_owner TO service_role;

ALTER TABLE public.app_owner ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner row is readable by signed-in users"
  ON public.app_owner FOR SELECT TO authenticated USING (true);

-- Backfill: if accounts already exist, the earliest one becomes the owner.
INSERT INTO public.app_owner (singleton, user_id)
SELECT true, u.id FROM auth.users u ORDER BY u.created_at ASC LIMIT 1
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  existing_owner uuid;
BEGIN
  -- Single-trader deployment: the first account claims ownership, later
  -- registrations are refused so the app closes itself after setup.
  INSERT INTO public.app_owner (singleton, user_id)
  VALUES (true, NEW.id)
  ON CONFLICT (singleton) DO NOTHING;

  SELECT user_id INTO existing_owner FROM public.app_owner WHERE singleton;

  IF existing_owner IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Registration is closed: this GOALGO deployment already has an owner.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.app_settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;