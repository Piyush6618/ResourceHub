BEGIN;

-- 1. Restore Phase 1 Storage & Table RLS policies
DROP POLICY IF EXISTS "storage_resources_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "storage_resources_insert_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "storage_resources_delete_unreferenced_only" ON storage.objects;

CREATE POLICY "Logged-in users can download resources"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resources');

-- 2. Drop Phase 2.1 triggers, community tables, and helper functions
DROP TRIGGER IF EXISTS trg_enforce_report_rate_limit ON public.content_reports;
DROP TRIGGER IF EXISTS trg_validate_and_stamp_report ON public.content_reports;
DROP TABLE IF EXISTS public.content_reports;

DROP TRIGGER IF EXISTS trg_enforce_suggestion_rate_limit ON public.resource_suggestions;
DROP TRIGGER IF EXISTS trg_enforce_suggestion_workflow ON public.resource_suggestions;
DROP TABLE IF EXISTS public.resource_suggestions;

DROP TRIGGER IF EXISTS trg_enforce_comment_rate_limit ON public.resource_comments;
DROP TRIGGER IF EXISTS trg_maintain_resource_comments_count ON public.resource_comments;
DROP TRIGGER IF EXISTS trg_validate_and_prep_comment ON public.resource_comments;
DROP TABLE IF EXISTS public.resource_comments;

DROP TRIGGER IF EXISTS trg_enqueue_storage_cleanup_on_resource_delete ON public.resources;
DROP TABLE IF EXISTS public.storage_cleanup_queue;

DROP TRIGGER IF EXISTS trg_verify_and_protect_resource ON public.resources;
DROP TRIGGER IF EXISTS trg_enforce_resource_upload_rate_limit ON public.resources;
DROP TRIGGER IF EXISTS trg_sync_resource_subject_columns ON public.resources;
DROP TRIGGER IF EXISTS trg_maintain_resource_likes_count ON public.resource_likes;

ALTER TABLE public.resources DROP COLUMN IF EXISTS subject_id;
DROP TABLE IF EXISTS public.subjects;

DROP TRIGGER IF EXISTS trg_prevent_last_admin_removal ON public.profiles;
DROP TRIGGER IF EXISTS trg_protect_profile_columns ON public.profiles;

COMMIT;
