-- ONE-TIME bootstrap: lets the service_role JWT execute arbitrary DDL.
-- After running this once in the Supabase SQL editor, all future migrations
-- can be applied autonomously via `supabase.rpc('admin_exec_sql', {sql: ...})`.

CREATE OR REPLACE FUNCTION public.admin_exec_sql(sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE sql;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_exec_sql(text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_exec_sql(text) TO service_role;

-- Also apply migration 009 here so we don't have to come back to the editor.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS ibkr_today_complete_date DATE;
