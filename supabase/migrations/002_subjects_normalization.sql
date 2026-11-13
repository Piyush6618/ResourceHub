-- ============================================================================
-- Migration 002: Subject Normalization & Backward-Compatible Sync Trigger
-- Dependencies: Migration 001 (public.profiles, public.is_active_user, public.is_admin)
-- ============================================================================
BEGIN;

-- Preflight assertion: Ensure no existing resource has a NULL or blank subject
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.resources
    WHERE subject IS NULL OR btrim(subject) = ''
  ) THEN
    RAISE EXCEPTION 'Preflight failed: public.resources contains NULL or blank subject values';
  END IF;
END $$;

-- 1. Create normalized public.subjects table
CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
    CONSTRAINT subjects_name_length_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  normalized_name text GENERATED ALWAYS AS (
    lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
  ) STORED,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subjects_normalized_name_key UNIQUE (normalized_name)
);

-- 2. Backfill canonical subjects from all existing resources
INSERT INTO public.subjects (name, created_by, created_at)
SELECT DISTINCT ON (lower(regexp_replace(btrim(r.subject), '\s+', ' ', 'g')))
  regexp_replace(btrim(r.subject), '\s+', ' ', 'g') AS name,
  r.owner_id AS created_by,
  min(r.created_at) OVER (
    PARTITION BY lower(regexp_replace(btrim(r.subject), '\s+', ' ', 'g'))
  ) AS created_at
FROM public.resources r
ORDER BY lower(regexp_replace(btrim(r.subject), '\s+', ' ', 'g')), r.created_at ASC
ON CONFLICT (normalized_name) DO NOTHING;

-- 3. Add subject_id to public.resources and backfill every existing row
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE RESTRICT;

UPDATE public.resources r
SET subject_id = s.id,
    subject = s.name
FROM public.subjects s
WHERE s.normalized_name = lower(regexp_replace(btrim(r.subject), '\s+', ' ', 'g'))
  AND r.subject_id IS NULL;

-- 4. Verify 100% of resources are mapped before enforcing NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.resources WHERE subject_id IS NULL) THEN
    RAISE EXCEPTION 'Migration 002 aborted: unmapped subject_id rows remain in public.resources';
  END IF;
END $$;

ALTER TABLE public.resources
  ALTER COLUMN subject_id SET NOT NULL;

-- 5. Concurrency-safe RPC to resolve or create a canonical subject (the ONLY way users create subjects)
CREATE OR REPLACE FUNCTION public.get_or_create_subject(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_clean_name text;
  v_norm_name  text;
  v_subject_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Active user account required to create or resolve subjects';
  END IF;

  v_clean_name := regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g');
  v_norm_name  := lower(v_clean_name);

  IF char_length(v_clean_name) < 1 OR char_length(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'Subject name must be between 1 and 80 characters';
  END IF;

  SELECT s.id INTO v_subject_id
  FROM public.subjects s
  WHERE s.normalized_name = v_norm_name;

  IF v_subject_id IS NOT NULL THEN
    RETURN v_subject_id;
  END IF;

  INSERT INTO public.subjects (name, created_by)
  VALUES (v_clean_name, (SELECT auth.uid()))
  ON CONFLICT (normalized_name)
  DO UPDATE SET name = public.subjects.name
  RETURNING id INTO v_subject_id;

  RETURN v_subject_id;
END;
$$;

ALTER FUNCTION public.get_or_create_subject(text) OWNER TO postgres;

-- 6. Admin-only RPC to rename or delete unused subjects
CREATE OR REPLACE FUNCTION public.admin_manage_subject(
  p_subject_id uuid,
  p_action text,
  p_new_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_clean_name text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: administrator privileges required';
  END IF;

  IF p_action = 'rename' THEN
    v_clean_name := regexp_replace(btrim(COALESCE(p_new_name, '')), '\s+', ' ', 'g');
    IF char_length(v_clean_name) < 1 OR char_length(v_clean_name) > 80 THEN
      RAISE EXCEPTION 'Subject name must be between 1 and 80 characters';
    END IF;

    UPDATE public.subjects
    SET name = v_clean_name
    WHERE id = p_subject_id;

    UPDATE public.resources
    SET subject = v_clean_name
    WHERE subject_id = p_subject_id;
  ELSIF p_action = 'delete' THEN
    DELETE FROM public.subjects WHERE id = p_subject_id;
  ELSE
    RAISE EXCEPTION 'Invalid action: must be rename or delete';
  END IF;
END;
$$;

ALTER FUNCTION public.admin_manage_subject(uuid, text, text) OWNER TO postgres;

-- 7. Bidirectional sync trigger on public.resources (guarantees compatibility with both
-- the existing frontend that sends only `subject` and the new frontend that sends `subject_id`)
CREATE OR REPLACE FUNCTION public.sync_resource_subject_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- Case A: Legacy frontend inserted/updated `subject` text without `subject_id`
  IF NEW.subject_id IS NULL AND NEW.subject IS NOT NULL AND btrim(NEW.subject) <> '' THEN
    NEW.subject_id := public.get_or_create_subject(NEW.subject);
  -- Case B: Legacy frontend updated `subject` text while `subject_id` remained unchanged
  ELSIF TG_OP = 'UPDATE'
        AND NEW.subject IS DISTINCT FROM OLD.subject
        AND NEW.subject_id IS NOT DISTINCT FROM OLD.subject_id
        AND NEW.subject IS NOT NULL AND btrim(NEW.subject) <> '' THEN
    NEW.subject_id := public.get_or_create_subject(NEW.subject);
  END IF;

  -- Always sync `NEW.subject` text from the canonical `public.subjects` row
  IF NEW.subject_id IS NOT NULL THEN
    SELECT s.name INTO NEW.subject
    FROM public.subjects s
    WHERE s.id = NEW.subject_id;

    IF NEW.subject IS NULL THEN
      RAISE EXCEPTION 'Invalid subject_id: subject does not exist';
    END IF;
  END IF;

  NEW.title := btrim(NEW.title);
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_resource_subject_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_sync_resource_subject_columns ON public.resources;
CREATE TRIGGER trg_sync_resource_subject_columns
BEFORE INSERT OR UPDATE ON public.resources
FOR EACH ROW
EXECUTE FUNCTION public.sync_resource_subject_columns();

COMMIT;
