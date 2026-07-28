CREATE TABLE IF NOT EXISTS public.calendar_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.user_luma_calendars
  ADD COLUMN IF NOT EXISTS calendar_cover_url text,
  ADD COLUMN IF NOT EXISTS calendar_description text,
  ADD COLUMN IF NOT EXISTS calendar_tint_color text,
  ADD COLUMN IF NOT EXISTS metadata_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.calendar_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS organization_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suggested_group_name text,
  ADD COLUMN IF NOT EXISTS suggested_group_reason text;

CREATE INDEX IF NOT EXISTS calendar_groups_user_order_idx
  ON public.calendar_groups (user_id, sort_order, name);
CREATE INDEX IF NOT EXISTS user_luma_calendars_group_order_idx
  ON public.user_luma_calendars (user_id, group_id, sort_order, calendar_name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_groups TO authenticated;
GRANT ALL ON public.calendar_groups TO service_role;
ALTER TABLE public.calendar_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own calendar groups"
  ON public.calendar_groups FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own calendar groups"
  ON public.calendar_groups FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own calendar groups"
  ON public.calendar_groups FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own calendar groups"
  ON public.calendar_groups FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_calendar_groups_updated_at ON public.calendar_groups;
CREATE TRIGGER update_calendar_groups_updated_at
  BEFORE UPDATE ON public.calendar_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
