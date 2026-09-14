DROP FUNCTION IF EXISTS public.registration_open();
DROP FUNCTION IF EXISTS public.is_broker_operator(uuid);
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;
