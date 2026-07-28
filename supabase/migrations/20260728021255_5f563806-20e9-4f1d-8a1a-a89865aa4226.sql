
CREATE TABLE IF NOT EXISTS public.calendar_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_groups TO authenticated;
GRANT ALL ON public.calendar_groups TO service_role;
ALTER TABLE public.calendar_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own calendar groups" ON public.calendar_groups
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_calendar_groups_updated_at BEFORE UPDATE ON public.calendar_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_luma_calendars
  ADD COLUMN IF NOT EXISTS calendar_cover_url text,
  ADD COLUMN IF NOT EXISTS calendar_description text,
  ADD COLUMN IF NOT EXISTS calendar_tint_color text,
  ADD COLUMN IF NOT EXISTS metadata_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.calendar_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suggested_group_name text,
  ADD COLUMN IF NOT EXISTS suggested_group_reason text,
  ADD COLUMN IF NOT EXISTS organization_manual boolean NOT NULL DEFAULT false;
