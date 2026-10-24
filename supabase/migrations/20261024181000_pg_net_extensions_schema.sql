-- Supabase's security advisor: extensions belong in the extensions schema, not public.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
