-- 1. Baseline row counts (Expected on live DB: profiles=5, resources=6, resource_likes=12, google_drive_tokens=1)
SELECT
  (SELECT count(*) FROM public.profiles) AS profiles_count,
  (SELECT count(*) FROM public.resources) AS resources_count,
  (SELECT count(*) FROM public.resource_likes) AS likes_count,
  (SELECT count(*) FROM public.google_drive_tokens) AS tokens_count;

-- 2. Check for orphan owner_id or user_id references not in public.profiles (Expected: 0 rows)
SELECT 'orphan_resource_owner' AS issue, id, owner_id
FROM public.resources r
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.owner_id)
UNION ALL
SELECT 'orphan_like_user' AS issue, id, user_id
FROM public.resource_likes rl
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = rl.user_id);

-- 3. Check for NULL/blank titles, subjects, file_paths, or duplicate file_paths (Expected: 0 rows)
SELECT id, title, subject, file_path
FROM public.resources
WHERE title IS NULL OR btrim(title) = ''
   OR subject IS NULL OR btrim(subject) = ''
   OR file_path IS NULL OR btrim(file_path) = ''
   OR file_path IN (
     SELECT file_path FROM public.resources GROUP BY file_path HAVING count(*) > 1
   );

-- 4. Check that every existing resource.file_path exists in storage.objects (Expected: 0 missing)
SELECT r.id, r.title, r.file_path
FROM public.resources r
LEFT JOIN storage.objects so
  ON so.bucket_id = 'resources' AND so.name = r.file_path
WHERE so.id IS NULL;
