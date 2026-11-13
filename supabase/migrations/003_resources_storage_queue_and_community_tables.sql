-- ============================================================================
-- Migration 003: Resources Hardening, Storage Verification, Cleanup Queue & Community Tables
-- Dependencies: Migrations 001 & 002
-- ============================================================================
BEGIN;

-- Preflight assertion: Ensure no duplicate or NULL file_path values exist in public.resources
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.resources
    WHERE file_path IS NULL OR btrim(file_path) = ''
  ) THEN
    RAISE EXCEPTION 'Preflight failed: NULL or empty file_path in public.resources';
  END IF;

  IF EXISTS (
    SELECT file_path FROM public.resources
    GROUP BY file_path HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight failed: duplicate file_path values in public.resources';
  END IF;
END $$;

-- 1. Harden public.resources columns, constraints, and FKs
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS likes_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill file_size_bytes from storage.objects where available
UPDATE public.resources r
SET file_size_bytes = (so.metadata->>'size')::bigint
FROM storage.objects so
WHERE so.bucket_id = 'resources'
  AND so.name = r.file_path
  AND r.file_size_bytes IS NULL
  AND (so.metadata->>'size') ~ '^[0-9]+$';

-- Backfill likes_count from existing resource_likes
UPDATE public.resources r
SET likes_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT resource_id, count(*)::integer AS cnt
  FROM public.resource_likes
  GROUP BY resource_id
) sub
WHERE r.id = sub.resource_id;

ALTER TABLE public.resources
  ALTER COLUMN file_path SET NOT NULL;

ALTER TABLE public.resources
  DROP CONSTRAINT IF EXISTS resources_file_path_key,
  DROP CONSTRAINT IF EXISTS resources_title_check,
  DROP CONSTRAINT IF EXISTS resources_description_check,
  DROP CONSTRAINT IF EXISTS resources_file_size_check,
  DROP CONSTRAINT IF EXISTS resources_likes_count_check,
  DROP CONSTRAINT IF EXISTS resources_comments_count_check,
  DROP CONSTRAINT IF EXISTS resources_owner_profile_fkey;

ALTER TABLE public.resources
  ADD CONSTRAINT resources_file_path_key UNIQUE (file_path),
  ADD CONSTRAINT resources_title_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 200) NOT VALID,
  ADD CONSTRAINT resources_description_check
    CHECK (description IS NULL OR char_length(description) <= 2000) NOT VALID,
  ADD CONSTRAINT resources_file_size_check
    CHECK (file_size_bytes IS NULL OR (file_size_bytes BETWEEN 100 AND 20971520)) NOT VALID,
  ADD CONSTRAINT resources_likes_count_check
    CHECK (likes_count >= 0),
  ADD CONSTRAINT resources_comments_count_check
    CHECK (comments_count >= 0),
  ADD CONSTRAINT resources_owner_profile_fkey
    FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.resources VALIDATE CONSTRAINT resources_title_check;
ALTER TABLE public.resources VALIDATE CONSTRAINT resources_description_check;
ALTER TABLE public.resources VALIDATE CONSTRAINT resources_file_size_check;
ALTER TABLE public.resources VALIDATE CONSTRAINT resources_owner_profile_fkey;

-- Link resource_likes.user_id to public.profiles(id)
ALTER TABLE public.resource_likes
  DROP CONSTRAINT IF EXISTS resource_likes_user_profile_fkey;
ALTER TABLE public.resource_likes
  ADD CONSTRAINT resource_likes_user_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.resource_likes VALIDATE CONSTRAINT resource_likes_user_profile_fkey;

-- 2. Trigger: Verify Storage object existence, MIME type, size & protect immutable resource columns
CREATE OR REPLACE FUNCTION public.verify_and_protect_resource()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_mime text;
  v_size bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Verify the uploaded file actually exists in storage.objects
    SELECT so.metadata->>'mimetype', (so.metadata->>'size')::bigint
    INTO v_mime, v_size
    FROM storage.objects so
    WHERE so.bucket_id = 'resources'
      AND so.name = NEW.file_path;

    IF v_mime IS NULL THEN
      RAISE EXCEPTION 'Storage verification failed: file % does not exist in resources bucket', NEW.file_path;
    END IF;

    IF v_size IS NOT NULL AND (v_size < 100 OR v_size > 20971520) THEN
      RAISE EXCEPTION 'Storage verification failed: file size (%) out of allowed bounds (100B - 20MB)', v_size;
    END IF;

    IF (NEW.file_type = 'PDF' AND v_mime <> 'application/pdf')
       OR (NEW.file_type = 'PPT' AND v_mime NOT IN ('application/vnd.ms-powerpoint', 'application/octet-stream'))
       OR (NEW.file_type = 'PPTX' AND v_mime <> 'application/vnd.openxmlformats-officedocument.presentationml.presentation') THEN
      RAISE EXCEPTION 'Storage verification failed: file_type (%) does not match uploaded MIME type (%)', NEW.file_type, v_mime;
    END IF;

    NEW.file_size_bytes := COALESCE(v_size, NEW.file_size_bytes);
    NEW.likes_count := 0;
    NEW.comments_count := 0;
    NEW.created_at := now();
    NEW.updated_at := now();
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
       OR NEW.file_path IS DISTINCT FROM OLD.file_path
       OR NEW.file_name IS DISTINCT FROM OLD.file_name
       OR NEW.file_type IS DISTINCT FROM OLD.file_type
       OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Resource file attributes, ownership, and creation timestamp are immutable';
    END IF;
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.verify_and_protect_resource() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_verify_and_protect_resource ON public.resources;
CREATE TRIGGER trg_verify_and_protect_resource
BEFORE INSERT OR UPDATE ON public.resources
FOR EACH ROW
EXECUTE FUNCTION public.verify_and_protect_resource();

-- 3. Transactional Storage Cleanup Queue (prevents orphaned files & broken DB links)
CREATE TABLE IF NOT EXISTS public.storage_cleanup_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL DEFAULT 'resources',
  file_path text NOT NULL UNIQUE,
  reason text NOT NULL
    CONSTRAINT storage_cleanup_queue_reason_check
    CHECK (reason = ANY (ARRAY['resource_deleted'::text, 'account_deleted'::text, 'upload_rollback'::text])),
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE OR REPLACE FUNCTION public.enqueue_storage_cleanup_on_resource_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  INSERT INTO public.storage_cleanup_queue (bucket_id, file_path, reason, requested_by)
  VALUES ('resources', OLD.file_path, 'resource_deleted', (SELECT auth.uid()))
  ON CONFLICT (file_path) DO UPDATE
    SET processed_at = NULL,
        attempts = public.storage_cleanup_queue.attempts + 1,
        created_at = now();
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.enqueue_storage_cleanup_on_resource_delete() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_enqueue_storage_cleanup_on_resource_delete ON public.resources;
CREATE TRIGGER trg_enqueue_storage_cleanup_on_resource_delete
AFTER DELETE ON public.resources
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_storage_cleanup_on_resource_delete();

-- RPC to confirm Storage file deletion after client removes the object from storage.objects
CREATE OR REPLACE FUNCTION public.confirm_storage_cleanup(p_file_path text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify the object is actually gone from storage.objects before marking processed
  IF EXISTS (
    SELECT 1 FROM storage.objects so
    WHERE so.bucket_id = 'resources' AND so.name = p_file_path
  ) THEN
    UPDATE public.storage_cleanup_queue
    SET attempts = attempts + 1,
        last_error = 'Object still present in storage.objects'
    WHERE file_path = p_file_path;
    RETURN false;
  END IF;

  UPDATE public.storage_cleanup_queue
  SET processed_at = now(),
      last_error = NULL
  WHERE file_path = p_file_path
    AND processed_at IS NULL;

  RETURN true;
END;
$$;

ALTER FUNCTION public.confirm_storage_cleanup(text) OWNER TO postgres;

-- 4. Maintain resources.likes_count
CREATE OR REPLACE FUNCTION public.maintain_resource_likes_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.resources
    SET likes_count = likes_count + 1
    WHERE id = NEW.resource_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.resources
    SET likes_count = GREATEST(0, likes_count - 1)
    WHERE id = OLD.resource_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.maintain_resource_likes_count() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_maintain_resource_likes_count ON public.resource_likes;
CREATE TRIGGER trg_maintain_resource_likes_count
AFTER INSERT OR DELETE ON public.resource_likes
FOR EACH ROW
EXECUTE FUNCTION public.maintain_resource_likes_count();

-- 5. Create public.resource_comments (2-level threading: depth 0 = root, depth 1 = reply)
CREATE TABLE IF NOT EXISTS public.resource_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.resource_comments(id) ON DELETE CASCADE,
  depth smallint NOT NULL DEFAULT 0
    CONSTRAINT resource_comments_depth_check
    CHECK (depth IN (0, 1)),
  body text NOT NULL
    CONSTRAINT resource_comments_body_check
    CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resource_comments_parent_depth_consistency
    CHECK ((parent_id IS NULL AND depth = 0) OR (parent_id IS NOT NULL AND depth = 1)),
  CONSTRAINT resource_comments_no_self_parent
    CHECK (parent_id IS DISTINCT FROM id)
);

CREATE OR REPLACE FUNCTION public.validate_and_prep_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_parent_resource_id uuid;
  v_parent_depth smallint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_id IS NULL THEN
      NEW.depth := 0;
    ELSE
      SELECT rc.resource_id, rc.depth
      INTO v_parent_resource_id, v_parent_depth
      FROM public.resource_comments rc
      WHERE rc.id = NEW.parent_id;

      IF v_parent_resource_id IS NULL THEN
        RAISE EXCEPTION 'Parent comment does not exist';
      END IF;

      IF v_parent_resource_id IS DISTINCT FROM NEW.resource_id THEN
        RAISE EXCEPTION 'Cross-resource reply blocked: parent comment belongs to a different resource';
      END IF;

      IF v_parent_depth >= 1 THEN
        RAISE EXCEPTION 'Maximum reply depth (1) exceeded: replies must reference a top-level comment';
      END IF;

      NEW.depth := 1;
    END IF;
    NEW.created_at := now();
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
       OR NEW.depth IS DISTINCT FROM OLD.depth
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Comment ownership, resource association, parent_id, and depth are immutable';
    END IF;
  END IF;

  NEW.body := btrim(NEW.body);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.validate_and_prep_comment() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_validate_and_prep_comment ON public.resource_comments;
CREATE TRIGGER trg_validate_and_prep_comment
BEFORE INSERT OR UPDATE ON public.resource_comments
FOR EACH ROW
EXECUTE FUNCTION public.validate_and_prep_comment();

CREATE OR REPLACE FUNCTION public.maintain_resource_comments_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.resources
    SET comments_count = comments_count + 1
    WHERE id = NEW.resource_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.resources
    SET comments_count = GREATEST(0, comments_count - 1)
    WHERE id = OLD.resource_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.maintain_resource_comments_count() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_maintain_resource_comments_count ON public.resource_comments;
CREATE TRIGGER trg_maintain_resource_comments_count
AFTER INSERT OR DELETE ON public.resource_comments
FOR EACH ROW
EXECUTE FUNCTION public.maintain_resource_comments_count();

-- 6. Create public.resource_suggestions with strict ownership & terminal review state rules
CREATE TABLE IF NOT EXISTS public.resource_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL
    CONSTRAINT resource_suggestions_title_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 150),
  details text NOT NULL
    CONSTRAINT resource_suggestions_details_check
    CHECK (char_length(btrim(details)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT resource_suggestions_status_check
    CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_note text
    CONSTRAINT resource_suggestions_review_note_check
    CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.enforce_suggestion_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_is_admin boolean := public.is_admin();
  v_is_resource_owner boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.title := btrim(NEW.title);
    NEW.details := btrim(NEW.details);
    NEW.status := 'pending';
    NEW.reviewed_by := NULL;
    NEW.review_note := NULL;
    NEW.reviewed_at := NULL;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE: Block reassignment of id, resource_id, user_id, created_at
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Suggestion ownership, resource association, and creation timestamp are immutable';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.resources r
    WHERE r.id = OLD.resource_id AND r.owner_id = v_caller
  ) INTO v_is_resource_owner;

  -- Case 1: Caller is the resource owner or admin performing a review
  IF (v_is_resource_owner OR v_is_admin) AND (
    NEW.status IS DISTINCT FROM OLD.status OR NEW.review_note IS DISTINCT FROM OLD.review_note
  ) THEN
    -- Submitter's title and details cannot be rewritten by a reviewer
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.details IS DISTINCT FROM OLD.details THEN
      RAISE EXCEPTION 'Reviewers cannot modify the suggestion author title or details';
    END IF;

    -- Terminal state rule: Once accepted or rejected, only an admin can reopen/change status
    IF OLD.status IN ('accepted', 'rejected') AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Reviewed suggestions are final and can only be reopened by an administrator';
    END IF;

    IF NEW.status = 'pending' THEN
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
      NEW.review_note := NULL;
    ELSE
      NEW.reviewed_by := v_caller;
      NEW.reviewed_at := now();
      NEW.review_note := NULLIF(btrim(NEW.review_note), '');
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Case 2: Caller is the suggestion submitter editing their own pending suggestion
  IF v_caller = OLD.user_id THEN
    IF OLD.status <> 'pending' OR NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'Suggestions can only be edited while pending';
    END IF;

    IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.review_note IS DISTINCT FROM OLD.review_note THEN
      RAISE EXCEPTION 'Unauthorized modification of suggestion review metadata';
    END IF;

    NEW.title := btrim(NEW.title);
    NEW.details := btrim(NEW.details);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unauthorized suggestion update';
END;
$$;

ALTER FUNCTION public.enforce_suggestion_workflow() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_enforce_suggestion_workflow ON public.resource_suggestions;
CREATE TRIGGER trg_enforce_suggestion_workflow
BEFORE INSERT OR UPDATE ON public.resource_suggestions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_suggestion_workflow();

-- 7. Create public.content_reports (supports flagging both resources and comments)
CREATE TABLE IF NOT EXISTS public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL
    CONSTRAINT content_reports_target_type_check
    CHECK (target_type = ANY (ARRAY['resource'::text, 'comment'::text])),
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.resource_comments(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL
    CONSTRAINT content_reports_reason_check
    CHECK (reason = ANY (ARRAY['spam'::text, 'inaccurate'::text, 'copyright'::text, 'inappropriate'::text, 'broken_file'::text, 'harassment'::text, 'other'::text])),
  details text
    CONSTRAINT content_reports_details_check
    CHECK (details IS NULL OR char_length(details) <= 1000),
  status text NOT NULL DEFAULT 'open'
    CONSTRAINT content_reports_status_check
    CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text])),
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_note text
    CONSTRAINT content_reports_resolution_note_check
    CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_target_consistency_check
    CHECK (
      (target_type = 'resource' AND comment_id IS NULL)
      OR (target_type = 'comment' AND comment_id IS NOT NULL)
    )
);

CREATE OR REPLACE FUNCTION public.validate_and_stamp_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_comment_resource_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.target_type = 'comment' THEN
      SELECT rc.resource_id INTO v_comment_resource_id
      FROM public.resource_comments rc
      WHERE rc.id = NEW.comment_id;

      IF v_comment_resource_id IS DISTINCT FROM NEW.resource_id THEN
        RAISE EXCEPTION 'Reported comment does not belong to the specified resource_id';
      END IF;
    END IF;

    NEW.status := 'open';
    NEW.resolved_by := NULL;
    NEW.resolution_note := NULL;
    NEW.resolved_at := NULL;
    NEW.details := NULLIF(btrim(NEW.details), '');
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE (Admin only)
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
     OR NEW.comment_id IS DISTINCT FROM OLD.comment_id
     OR NEW.reporter_id IS DISTINCT FROM OLD.reporter_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.details IS DISTINCT FROM OLD.details
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Report target, reporter, reason, and details are immutable';
  END IF;

  IF NEW.status IN ('resolved', 'dismissed') THEN
    NEW.resolved_by := (SELECT auth.uid());
    NEW.resolved_at := now();
  ELSE
    NEW.resolved_by := NULL;
    NEW.resolved_at := NULL;
  END IF;

  NEW.resolution_note := NULLIF(btrim(NEW.resolution_note), '');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.validate_and_stamp_report() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_validate_and_stamp_report ON public.content_reports;
CREATE TRIGGER trg_validate_and_stamp_report
BEFORE INSERT OR UPDATE ON public.content_reports
FOR EACH ROW
EXECUTE FUNCTION public.validate_and_stamp_report();

COMMIT;
