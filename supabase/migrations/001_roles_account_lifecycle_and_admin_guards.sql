-- ============================================================================
-- Migration 001: Roles Reconciliation, Account Lifecycle & Last-Admin Guard
-- Dependencies: Existing Phase 1 schema (public.profiles, auth.users)
-- ============================================================================
BEGIN;

-- Preflight assertion: Ensure public.profiles exists and has no NULL ids
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: public.profiles does not exist';
  END IF;
END $$;

-- 1. Add account lifecycle & timestamp columns to public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. Drop legacy role check constraint so existing rows can be migrated
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

-- 3. Migrate all existing non-admin roles ('student', 'teacher', 'facilitator') to 'user'
UPDATE public.profiles
SET role = 'user',
    status = COALESCE(status, 'active'),
    updated_at = now()
WHERE role IS DISTINCT FROM 'admin';

-- 4. Set default role to 'user' and apply strict CHECK constraints
ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'user'::text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check,
  DROP CONSTRAINT IF EXISTS profiles_display_name_check,
  DROP CONSTRAINT IF EXISTS profiles_designation_check,
  DROP CONSTRAINT IF EXISTS profiles_suspended_reason_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
    CHECK (role = ANY (ARRAY['user'::text, 'admin'::text])),
  ADD CONSTRAINT profiles_status_check
    CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text])),
  ADD CONSTRAINT profiles_display_name_check
    CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 80) NOT VALID,
  ADD CONSTRAINT profiles_designation_check
    CHECK (designation IS NULL OR char_length(btrim(designation)) <= 100) NOT VALID,
  ADD CONSTRAINT profiles_suspended_reason_check
    CHECK (suspended_reason IS NULL OR char_length(btrim(suspended_reason)) <= 500) NOT VALID;

ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_display_name_check;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_designation_check;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_suspended_reason_check;

-- 5. Helper functions: public.is_admin() and public.is_active_user()
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role = 'admin'
      AND p.status = 'active'
  );
$$;

ALTER FUNCTION public.is_admin() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.status = 'active'
  );
$$;

ALTER FUNCTION public.is_active_user() OWNER TO postgres;

-- 6. Update signup trigger to assign role='user', status='active', and extract metadata
CREATE OR REPLACE FUNCTION public.create_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, status, display_name, designation)
  VALUES (
    NEW.id,
    'user',
    'active',
     left(NULLIF(btrim(NEW.raw_user_meta_data->>'display_name'), ''), 80),
     left(NULLIF(btrim(NEW.raw_user_meta_data->>'designation'), ''), 100)
  );
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.create_user_profile() OWNER TO postgres;

-- 7. Trigger: Protect immutable profile columns & block ordinary role/status edits
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Profile id and created_at are immutable';
  END IF;

  -- Role changes are forbidden from any client JWT session (must use server-side SQL)
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF (SELECT auth.uid()) IS NOT NULL THEN
      RAISE EXCEPTION 'Unauthorized: role modifications require a controlled server-side operation';
    END IF;
  END IF;

  -- Status changes ('active' <-> 'suspended') require an active admin or server-side session
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
     OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason THEN
    IF (SELECT auth.uid()) IS NOT NULL AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Unauthorized: only administrators can change account status';
    END IF;
  END IF;

  NEW.display_name := NULLIF(btrim(NEW.display_name), '');
  NEW.designation  := NULLIF(btrim(NEW.designation), '');
  NEW.updated_at   := now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_profile_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_protect_profile_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_columns();

-- 8. Trigger: Prevent accidental removal, demotion, or suspension of the last active admin
CREATE OR REPLACE FUNCTION public.prevent_last_admin_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_remaining_admins integer;
BEGIN
  IF OLD.role = 'admin' AND OLD.status = 'active' THEN
    IF TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NEW.status <> 'active' THEN
      SELECT count(*)::integer INTO v_remaining_admins
      FROM public.profiles p
      WHERE p.role = 'admin'
        AND p.status = 'active'
        AND p.id <> OLD.id;

      IF v_remaining_admins < 1 THEN
        RAISE EXCEPTION 'Operation blocked: ResourceHub must retain at least one active administrator';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.prevent_last_admin_removal() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_prevent_last_admin_removal ON public.profiles;
CREATE TRIGGER trg_prevent_last_admin_removal
BEFORE UPDATE OR DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_last_admin_removal();

-- 9. Controlled RPC for admins to suspend or restore user accounts
CREATE OR REPLACE FUNCTION public.admin_set_user_status(
  p_target_user_id uuid,
  p_new_status text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_target_role text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: administrator privileges required';
  END IF;

  IF p_new_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Invalid status: must be active or suspended';
  END IF;

  SELECT role INTO v_target_role
  FROM public.profiles
  WHERE id = p_target_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user profile not found';
  END IF;

  IF v_target_role = 'admin' AND p_new_status = 'suspended' THEN
    RAISE EXCEPTION 'Cannot suspend an administrator account';
  END IF;

  UPDATE public.profiles
  SET status = p_new_status,
      suspended_at = CASE WHEN p_new_status = 'suspended' THEN now() ELSE NULL END,
      suspended_reason = CASE WHEN p_new_status = 'suspended' THEN NULLIF(btrim(p_reason), '') ELSE NULL END,
      updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

ALTER FUNCTION public.admin_set_user_status(uuid, text, text) OWNER TO postgres;

COMMIT;
