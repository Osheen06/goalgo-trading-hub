ALTER TABLE public.signals REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.signals;