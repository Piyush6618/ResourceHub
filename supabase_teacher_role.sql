-- Migration: Add 'teacher' role with resource upload permissions

-- 1. Allow 'teacher' in profiles.role check constraint
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['student'::text, 'facilitator'::text, 'teacher'::text]));

-- 2. Allow all users to read uploader profile metadata for both facilitators and teachers
ALTER POLICY "Users can view facilitator profiles"
  ON public.profiles
  USING (role = ANY (ARRAY['facilitator'::text, 'teacher'::text]));

-- 3. Allow both facilitators and teachers to insert rows into public.resources
ALTER POLICY "Facilitators can upload resources"
  ON public.resources
  WITH CHECK (
    (owner_id = (SELECT auth.uid() AS uid))
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid() AS uid)
        AND profiles.role = ANY (ARRAY['facilitator'::text, 'teacher'::text])
    )
  );

-- 4. Allow both facilitators and teachers to upload files into the 'resources' storage bucket
ALTER POLICY "Facilitators can upload resource files"
  ON storage.objects
  WITH CHECK (
    (bucket_id = 'resources'::text)
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid() AS uid)
        AND profiles.role = ANY (ARRAY['facilitator'::text, 'teacher'::text])
    )
  );
