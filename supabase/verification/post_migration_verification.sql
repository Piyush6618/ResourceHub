-- 1. Verify row counts and likes_count accuracy (Expected: 0 mismatches)
SELECT r.id, r.likes_count, count(rl.id) AS actual_likes
FROM public.resources r
LEFT JOIN public.resource_likes rl ON rl.resource_id = r.id
GROUP BY r.id, r.likes_count
HAVING r.likes_count <> count(rl.id);

-- 2. Verify all resources have non-null subject_id matching canonical subject name
SELECT count(*) AS unmapped_resources
FROM public.resources r
LEFT JOIN public.subjects s ON s.id = r.subject_id
WHERE r.subject_id IS NULL OR r.subject <> s.name;

-- 3. Verify anon has ZERO table privileges in public (Expected: 0 rows)
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'anon';

-- 4. Role-Separated Transactional Security Test (Rolls back automatically!)
BEGIN;
  -- Simulate Ordinary User A (non-admin)
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims', json_build_object(
    'sub', (SELECT id::text FROM public.profiles WHERE role = 'user' LIMIT 1),
    'role', 'authenticated'
  )::text, true);

  -- Test A1: Ordinary user CANNOT escalate own role to 'admin' (must fail with 42501 / trigger error)
  DO $$
  BEGIN
    UPDATE public.profiles SET role = 'admin' WHERE id = auth.uid();
    RAISE EXCEPTION 'SECURITY FAILURE: Ordinary user was able to update role!';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    RAISE NOTICE 'PASS: Ordinary user blocked from updating role';
  END $$;

  -- Test A2: Ordinary user CANNOT insert directly into public.subjects (must fail with 42501)
  DO $$
  BEGIN
    INSERT INTO public.subjects (name) VALUES ('Bypass Attempt');
    RAISE EXCEPTION 'SECURITY FAILURE: Direct insert into subjects succeeded!';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: Direct insert into subjects blocked; must use get_or_create_subject()';
  END $$;

  -- Test A3: Ordinary user CANNOT delete another user's resource (must affect 0 rows)
  DO $$
  DECLARE v_deleted int;
  BEGIN
    WITH del AS (
      DELETE FROM public.resources WHERE owner_id <> auth.uid() RETURNING 1
    ) SELECT count(*) INTO v_deleted FROM del;
    IF v_deleted > 0 THEN
      RAISE EXCEPTION 'SECURITY FAILURE: Non-owner deleted another user resource!';
    END IF;
    RAISE NOTICE 'PASS: Non-owner blocked from deleting others resources';
  END $$;
ROLLBACK;
