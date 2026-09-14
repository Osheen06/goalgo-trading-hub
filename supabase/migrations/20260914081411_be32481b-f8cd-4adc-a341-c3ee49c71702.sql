CREATE OR REPLACE FUNCTION public.registration_open()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.app_owner);
$$;

REVOKE ALL ON FUNCTION public.registration_open() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registration_open() TO anon, authenticated;