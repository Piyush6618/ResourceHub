-- ============================================================================
-- Migration 005: Complete Schema Lockdown, Grants, RLS Policies & Storage Policies
-- Dependencies: Migrations 001, 002, 003, 004
-- ============================================================================
BEGIN;

-- 1. Schema-Level Permissions & Default Privileges Lockdown
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

-- 2. Function Execution Grants (Least Privilege)
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_or_create_subject(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_subject(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_manage_subject(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_subject(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_storage_cleanup(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_storage_cleanup(text) TO authenticated, service_role;

-- 3. Table & Column-Level Grants
REVOKE ALL ON
  public.profiles,
  public.subjects,
  public.resources,
  public.storage_cleanup_queue,
  public.resource_likes,
  public.resource_comments,
  public.resource_suggestions,
  public.content_reports,
  public.google_drive_tokens
FROM PUBLIC, anon, authenticated;

-- profiles: SELECT all columns; UPDATE strictly limited to display_name and designation
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (display_name, designation) ON public.profiles TO authenticated;

-- subjects: SELECT only (creation goes strictly through get_or_create_subject RPC!)
GRANT SELECT ON public.subjects TO authenticated;

-- resources: SELECT, INSERT, DELETE, and metadata-only UPDATE
GRANT SELECT, INSERT, DELETE ON public.resources TO authenticated;
GRANT UPDATE (title, subject_id, subject, description) ON public.resources TO authenticated;

-- storage_cleanup_queue: SELECT only (updates go through confirm_storage_cleanup RPC)
GRANT SELECT ON public.storage_cleanup_queue TO authenticated;

-- resource_likes: SELECT, INSERT, DELETE
GRANT SELECT, INSERT, DELETE ON public.resource_likes TO authenticated;

-- resource_comments: SELECT, INSERT, UPDATE (body only), DELETE
GRANT SELECT, INSERT, DELETE ON public.resource_comments TO authenticated;
GRANT UPDATE (body) ON public.resource_comments TO authenticated;

-- resource_suggestions: SELECT, INSERT, UPDATE (mutable columns only), DELETE
GRANT SELECT, INSERT, DELETE ON public.resource_suggestions TO authenticated;
GRANT UPDATE (title, details, status, review_note) ON public.resource_suggestions TO authenticated;

-- content_reports: SELECT, INSERT, UPDATE (admin resolution columns only), DELETE
GRANT SELECT, INSERT, DELETE ON public.content_reports TO authenticated;
GRANT UPDATE (status, resolution_note) ON public.content_reports TO authenticated;

-- Ensure service_role retains full access for administrative operations
GRANT ALL ON
  public.profiles,
  public.subjects,
  public.resources,
  public.storage_cleanup_queue,
  public.resource_likes,
  public.resource_comments,
  public.resource_suggestions,
  public.content_reports,
  public.google_drive_tokens
TO service_role;

-- 4. Enable Row-Level Security on All Tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_cleanup_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_drive_tokens ENABLE ROW LEVEL SECURITY;

-- 5. Drop All Legacy & Prior Policies Before Creating Final Policies
DROP POLICY IF EXISTS "Users can view facilitator profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self_or_admin" ON public.profiles;

DROP POLICY IF EXISTS "subjects_select_authenticated" ON public.subjects;
DROP POLICY IF EXISTS "subjects_insert_authenticated" ON public.subjects;
DROP POLICY IF EXISTS "subjects_update_admin" ON public.subjects;
DROP POLICY IF EXISTS "subjects_delete_admin" ON public.subjects;

DROP POLICY IF EXISTS "Students can view resources" ON public.resources;
DROP POLICY IF EXISTS "Facilitators can upload resources" ON public.resources;
DROP POLICY IF EXISTS "resources_select_authenticated" ON public.resources;
DROP POLICY IF EXISTS "resources_insert_authenticated_owner" ON public.resources;
DROP POLICY IF EXISTS "resources_update_owner_or_admin" ON public.resources;
DROP POLICY IF EXISTS "resources_delete_owner_or_admin" ON public.resources;

DROP POLICY IF EXISTS "storage_cleanup_queue_select_owner_or_admin" ON public.storage_cleanup_queue;

DROP POLICY IF EXISTS "Users can view likes" ON public.resource_likes;
DROP POLICY IF EXISTS "Users can add their own likes" ON public.resource_likes;
DROP POLICY IF EXISTS "Users can remove their own likes" ON public.resource_likes;
DROP POLICY IF EXISTS "resource_likes_select_authenticated" ON public.resource_likes;
DROP POLICY IF EXISTS "resource_likes_insert_self" ON public.resource_likes;
DROP POLICY IF EXISTS "resource_likes_delete_self_or_admin" ON public.resource_likes;

DROP POLICY IF EXISTS "resource_comments_select_authenticated" ON public.resource_comments;
DROP POLICY IF EXISTS "resource_comments_insert_self" ON public.resource_comments;
DROP POLICY IF EXISTS "resource_comments_update_author" ON public.resource_comments;
DROP POLICY IF EXISTS "resource_comments_delete_author_resource_owner_or_admin" ON public.resource_comments;

DROP POLICY IF EXISTS "resource_suggestions_select_authenticated" ON public.resource_suggestions;
DROP POLICY IF EXISTS "resource_suggestions_insert_self" ON public.resource_suggestions;
DROP POLICY IF EXISTS "resource_suggestions_update_submitter_owner_or_admin" ON public.resource_suggestions;
DROP POLICY IF EXISTS "resource_suggestions_delete_submitter_owner_or_admin" ON public.resource_suggestions;

DROP POLICY IF EXISTS "content_reports_select_reporter_or_admin" ON public.content_reports;
DROP POLICY IF EXISTS "content_reports_insert_self" ON public.content_reports;
DROP POLICY IF EXISTS "content_reports_update_admin" ON public.content_reports;
DROP POLICY IF EXISTS "content_reports_delete_admin" ON public.content_reports;

-- ============================================================================
-- 5.1 public.profiles Policies
-- ============================================================================
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "profiles_update_self_or_admin"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    public.is_active_user()
    AND (id = (SELECT auth.uid()) OR public.is_admin())
  )
  WITH CHECK (
    public.is_active_user()
    AND (id = (SELECT auth.uid()) OR public.is_admin())
  );

-- ============================================================================
-- 5.2 public.subjects Policies (Read-only via table; writes via RPCs)
-- ============================================================================
CREATE POLICY "subjects_select_authenticated"
  ON public.subjects FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- 5.3 public.resources Policies
-- ============================================================================
CREATE POLICY "resources_select_authenticated"
  ON public.resources FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "resources_insert_authenticated_owner"
  ON public.resources FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND owner_id = (SELECT auth.uid())
    AND split_part(file_path, '/', 1) = (SELECT auth.uid()::text)
  );

CREATE POLICY "resources_update_owner_or_admin"
  ON public.resources FOR UPDATE
  TO authenticated
  USING (
    public.is_active_user()
    AND (owner_id = (SELECT auth.uid()) OR public.is_admin())
  )
  WITH CHECK (
    public.is_active_user()
    AND (owner_id = (SELECT auth.uid()) OR public.is_admin())
  );

CREATE POLICY "resources_delete_owner_or_admin"
  ON public.resources FOR DELETE
  TO authenticated
  USING (
    public.is_active_user()
    AND (owner_id = (SELECT auth.uid()) OR public.is_admin())
  );

-- ============================================================================
-- 5.4 public.storage_cleanup_queue Policies
-- ============================================================================
CREATE POLICY "storage_cleanup_queue_select_owner_or_admin"
  ON public.storage_cleanup_queue FOR SELECT
  TO authenticated
  USING (
    requested_by = (SELECT auth.uid())
    OR public.is_admin()
  );

-- ============================================================================
-- 5.5 public.resource_likes Policies
-- ============================================================================
CREATE POLICY "resource_likes_select_authenticated"
  ON public.resource_likes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "resource_likes_insert_self"
  ON public.resource_likes FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND user_id = (SELECT auth.uid())
  );

CREATE POLICY "resource_likes_delete_self_or_admin"
  ON public.resource_likes FOR DELETE
  TO authenticated
  USING (
    public.is_active_user()
    AND (user_id = (SELECT auth.uid()) OR public.is_admin())
  );

-- ============================================================================
-- 5.6 public.resource_comments Policies
-- ============================================================================
CREATE POLICY "resource_comments_select_authenticated"
  ON public.resource_comments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "resource_comments_insert_self"
  ON public.resource_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND user_id = (SELECT auth.uid())
  );

CREATE POLICY "resource_comments_update_author"
  ON public.resource_comments FOR UPDATE
  TO authenticated
  USING (
    public.is_active_user()
    AND user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.is_active_user()
    AND user_id = (SELECT auth.uid())
  );

CREATE POLICY "resource_comments_delete_author_resource_owner_or_admin"
  ON public.resource_comments FOR DELETE
  TO authenticated
  USING (
    public.is_active_user()
    AND (
      user_id = (SELECT auth.uid())
      OR public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.resources r
        WHERE r.id = resource_comments.resource_id
          AND r.owner_id = (SELECT auth.uid())
      )
    )
  );

-- ============================================================================
-- 5.7 public.resource_suggestions Policies
-- ============================================================================
CREATE POLICY "resource_suggestions_select_authenticated"
  ON public.resource_suggestions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "resource_suggestions_insert_self"
  ON public.resource_suggestions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND user_id = (SELECT auth.uid())
    AND status = 'pending'
  );

CREATE POLICY "resource_suggestions_update_submitter_owner_or_admin"
  ON public.resource_suggestions FOR UPDATE
  TO authenticated
  USING (
    public.is_active_user()
    AND (
      (user_id = (SELECT auth.uid()) AND status = 'pending')
      OR public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.resources r
        WHERE r.id = resource_suggestions.resource_id
          AND r.owner_id = (SELECT auth.uid())
      )
    )
  )
  WITH CHECK (
    public.is_active_user()
    AND (
      user_id = (SELECT auth.uid())
      OR public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.resources r
        WHERE r.id = resource_suggestions.resource_id
          AND r.owner_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY "resource_suggestions_delete_submitter_owner_or_admin"
  ON public.resource_suggestions FOR DELETE
  TO authenticated
  USING (
    public.is_active_user()
    AND (
      (user_id = (SELECT auth.uid()) AND status = 'pending')
      OR public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.resources r
        WHERE r.id = resource_suggestions.resource_id
          AND r.owner_id = (SELECT auth.uid())
      )
    )
  );

-- ============================================================================
-- 5.8 public.content_reports Policies
-- ============================================================================
CREATE POLICY "content_reports_select_reporter_or_admin"
  ON public.content_reports FOR SELECT
  TO authenticated
  USING (
    reporter_id = (SELECT auth.uid())
    OR public.is_admin()
  );

CREATE POLICY "content_reports_insert_self"
  ON public.content_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND reporter_id = (SELECT auth.uid())
    AND status = 'open'
  );

CREATE POLICY "content_reports_update_admin"
  ON public.content_reports FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "content_reports_delete_admin"
  ON public.content_reports FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============================================================================
-- 6. Storage Bucket Configuration & storage.objects RLS Policies
-- ============================================================================
UPDATE storage.buckets
SET public = false,
    file_size_limit = 20971520,
    allowed_mime_types = ARRAY[
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]
WHERE id = 'resources';

DROP POLICY IF EXISTS "Facilitators can upload resource files" ON storage.objects;
DROP POLICY IF EXISTS "Logged-in users can download resources" ON storage.objects;
DROP POLICY IF EXISTS "storage_resources_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "storage_resources_insert_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "storage_resources_delete_owner_or_admin" ON storage.objects;
DROP POLICY IF EXISTS "storage_resources_delete_unreferenced_only" ON storage.objects;

-- SELECT: Active users can download/preview files linked to an active resource
-- (or their own uploaded file during the pre-insert verification window)
CREATE POLICY "storage_resources_select_authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'resources'
    AND public.is_active_user()
    AND (
      EXISTS (
        SELECT 1 FROM public.resources r
        WHERE r.file_path = storage.objects.name
      )
      OR (storage.foldername(name))[1] = (SELECT auth.uid()::text)
      OR public.is_admin()
    )
  );

-- INSERT: Active users can upload ONLY into their own <auth.uid()>/<filename> folder
CREATE POLICY "storage_resources_insert_own_folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'resources'
    AND public.is_active_user()
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    AND array_length(storage.foldername(name), 1) = 1
    AND char_length(name) <= 220
    AND lower(storage.extension(name)) = ANY (ARRAY['pdf'::text, 'ppt'::text, 'pptx'::text])
  );

-- DELETE: Allowed ONLY when NO public.resources row references the file!
-- This guarantees a Storage file can NEVER be deleted while a DB resource row points to it,
-- while still permitting upload rollback (when DB insert fails) and post-DB-delete queue cleanup.
CREATE POLICY "storage_resources_delete_unreferenced_only"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'resources'
    AND public.is_active_user()
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid()::text)
      OR public.is_admin()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.resources r
      WHERE r.file_path = storage.objects.name
    )
  );

COMMIT;
