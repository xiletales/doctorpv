-- Closes the Supabase Data API on every table in the public schema.
-- RLS with no policies gives anon and authenticated no rows, while the table owner that
-- Prisma connects as keeps full access. Never add FORCE ROW LEVEL SECURITY here, as it would
-- lock the application out too. Safe to run repeatedly, and it also covers tables added later.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
