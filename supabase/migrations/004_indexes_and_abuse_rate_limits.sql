-- ============================================================================
-- Migration 004: Secondary Indexes, Duplicate-Report Guards & Rate-Limit Triggers
-- Dependencies: Migrations 001, 002, 003
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 1. Secondary Indexes for Foreign Keys, Sorting, Filtering & Rate-Limit Lookups
CREATE INDEX IF NOT EXISTS idx_profiles_role_status ON public.profiles (role, status);

CREATE INDEX IF NOT EXISTS idx_subjects_name_asc ON public.subjects (name ASC);

CREATE INDEX IF NOT EXISTS idx_resources_created_at_desc ON public.resources (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resources_likes_count_desc ON public.resources (likes_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resources_subject_id_created ON public.resources (subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resources_file_type_created ON public.resources (file_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resources_owner_created ON public.resources (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resources_title_trgm ON public.resources USING gin (title extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_storage_cleanup_queue_unprocessed
  ON public.storage_cleanup_queue (created_at ASC)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resource_likes_user_id ON public.resource_likes (user_id);

CREATE INDEX IF NOT EXISTS idx_resource_comments_resource_created
  ON public.resource_comments (resource_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_resource_comments_parent_id
  ON public.resource_comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_resource_comments_user_created
  ON public.resource_comments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_resource_suggestions_resource_status
  ON public.resource_suggestions (resource_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_suggestions_user_created
  ON public.resource_suggestions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_reports_status_created
  ON public.content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_resource_id
  ON public.content_reports (resource_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_comment_id
  ON public.content_reports (comment_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_reporter_created
  ON public.content_reports (reporter_id, created_at DESC);

-- Partial unique indexes preventing a user from filing duplicate open reports on the same item
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_unique_open_resource
  ON public.content_reports (reporter_id, resource_id)
  WHERE target_type = 'resource' AND status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_unique_open_comment
  ON public.content_reports (reporter_id, comment_id)
  WHERE target_type = 'comment' AND status = 'open';

-- 2. Database-Enforced Abuse & Rate-Limit Triggers (Sliding Windows)

-- 2a. Resource Upload Rate Limit (Max 5 per 10 min, Max 25 per 24 hours for non-admins)
CREATE OR REPLACE FUNCTION public.enforce_resource_upload_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_recent_10m integer;
  v_recent_24h integer;
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT
    count(*) FILTER (WHERE created_at > now() - interval '10 minutes')::integer,
    count(*)::integer
  INTO v_recent_10m, v_recent_24h
  FROM public.resources
  WHERE owner_id = NEW.owner_id
    AND created_at > now() - interval '24 hours';

  IF v_recent_10m >= 5 THEN
    RAISE EXCEPTION 'Rate limit exceeded: you may upload at most 5 resources every 10 minutes';
  END IF;

  IF v_recent_24h >= 25 THEN
    RAISE EXCEPTION 'Rate limit exceeded: you may upload at most 25 resources per 24 hours';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_resource_upload_rate_limit() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_enforce_resource_upload_rate_limit ON public.resources;
CREATE TRIGGER trg_enforce_resource_upload_rate_limit
BEFORE INSERT ON public.resources
FOR EACH ROW
EXECUTE FUNCTION public.enforce_resource_upload_rate_limit();

-- 2b. Comment Rate Limit (Max 6 per 1 min, Max 30 per 1 hour, plus 5-min duplicate text guard)
CREATE OR REPLACE FUNCTION public.enforce_comment_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_recent_1m integer;
  v_recent_1h integer;
  v_dup_exists boolean;
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT
    count(*) FILTER (WHERE created_at > now() - interval '1 minute')::integer,
    count(*)::integer,
    bool_or(
      resource_id = NEW.resource_id
      AND created_at > now() - interval '5 minutes'
      AND lower(btrim(body)) = lower(btrim(NEW.body))
    )
  INTO v_recent_1m, v_recent_1h, v_dup_exists
  FROM public.resource_comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF COALESCE(v_dup_exists, false) THEN
    RAISE EXCEPTION 'Duplicate comment detected: please do not post identical comments repeatedly';
  END IF;

  IF v_recent_1m >= 6 THEN
    RAISE EXCEPTION 'Rate limit exceeded: please wait a moment before posting another comment';
  END IF;

  IF v_recent_1h >= 30 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 30 comments per hour';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_comment_rate_limit() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_enforce_comment_rate_limit ON public.resource_comments;
CREATE TRIGGER trg_enforce_comment_rate_limit
BEFORE INSERT ON public.resource_comments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_comment_rate_limit();

-- 2c. Suggestion Rate Limit (Max 5 per 10 min, Max 3 pending suggestions per resource per user)
CREATE OR REPLACE FUNCTION public.enforce_suggestion_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_recent_10m integer;
  v_pending_on_resource integer;
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer INTO v_recent_10m
  FROM public.resource_suggestions
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '10 minutes';

  IF v_recent_10m >= 5 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 5 suggestions every 10 minutes';
  END IF;

  SELECT count(*)::integer INTO v_pending_on_resource
  FROM public.resource_suggestions
  WHERE user_id = NEW.user_id
    AND resource_id = NEW.resource_id
    AND status = 'pending';

  IF v_pending_on_resource >= 3 THEN
    RAISE EXCEPTION 'You already have 3 pending suggestions on this resource awaiting review';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_suggestion_rate_limit() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_enforce_suggestion_rate_limit ON public.resource_suggestions;
CREATE TRIGGER trg_enforce_suggestion_rate_limit
BEFORE INSERT ON public.resource_suggestions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_suggestion_rate_limit();

-- 2d. Report Rate Limit (Max 10 reports per hour per user)
CREATE OR REPLACE FUNCTION public.enforce_report_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_recent_1h integer;
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer INTO v_recent_1h
  FROM public.content_reports
  WHERE reporter_id = NEW.reporter_id
    AND created_at > now() - interval '1 hour';

  IF v_recent_1h >= 10 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 10 reports per hour';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_report_rate_limit() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_enforce_report_rate_limit ON public.content_reports;
CREATE TRIGGER trg_enforce_report_rate_limit
BEFORE INSERT ON public.content_reports
FOR EACH ROW
EXECUTE FUNCTION public.enforce_report_rate_limit();

COMMIT;
