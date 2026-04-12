-- Moodbase: per-user saves (items) and projects with Supabase Auth + Google.
-- Run once in Supabase Dashboard → SQL → New query, then Run.
--
-- Before RLS, optionally assign existing rows to your user (replace YOUR_USER_UUID):
--   UPDATE public.items SET user_id = 'YOUR_USER_UUID'::uuid WHERE user_id IS NULL;
--   UPDATE public.projects SET user_id = 'YOUR_USER_UUID'::uuid WHERE user_id IS NULL;
-- Find YOUR_USER_UUID under Authentication → Users.

-- 1) Owner column (saves live in `items`)
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE;

ALTER TABLE public.items ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.projects ALTER COLUMN user_id SET DEFAULT auth.uid();

-- 2) Enable RLS
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- 3) Policies: authenticated users only see their own rows
DROP POLICY IF EXISTS "items_select_own" ON public.items;
DROP POLICY IF EXISTS "items_insert_own" ON public.items;
DROP POLICY IF EXISTS "items_update_own" ON public.items;
DROP POLICY IF EXISTS "items_delete_own" ON public.items;

CREATE POLICY "items_select_own" ON public.items FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "items_insert_own" ON public.items FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "items_update_own" ON public.items FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "items_delete_own" ON public.items FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "projects_select_own" ON public.projects;
DROP POLICY IF EXISTS "projects_insert_own" ON public.projects;
DROP POLICY IF EXISTS "projects_update_own" ON public.projects;
DROP POLICY IF EXISTS "projects_delete_own" ON public.projects;

CREATE POLICY "projects_select_own" ON public.projects FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "projects_insert_own" ON public.projects FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "projects_update_own" ON public.projects FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "projects_delete_own" ON public.projects FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 4) Realtime: RLS applies to postgres_changes when the client uses a logged-in JWT.
-- If replication was not enabled, in Dashboard → Database → Replication, include `items` (and `projects` if needed).
