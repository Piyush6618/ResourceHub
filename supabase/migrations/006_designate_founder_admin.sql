-- ============================================================================
-- Migration 006: Controlled Founder Administrator Designation
-- Dependencies: Migration 001 (must be run in Supabase SQL Editor as postgres)
-- ============================================================================
BEGIN;

UPDATE public.profiles p
SET role = 'admin',
    status = 'active',
    updated_at = now()
FROM auth.users u
WHERE p.id = u.id
  AND lower(u.email) = lower('<FOUNDER_EMAIL>');

-- Verify that at least one active administrator now exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE role = 'admin' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Migration 006 failed: founder email did not match any row in public.profiles';
  END IF;
END $$;

COMMIT;
