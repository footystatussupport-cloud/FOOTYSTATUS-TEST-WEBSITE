ALTER TABLE public.user_contacts
DROP CONSTRAINT IF EXISTS user_contacts_visibility_check;

ALTER TABLE public.user_contacts
ADD CONSTRAINT user_contacts_visibility_check
CHECK (visibility IN ('public', 'restricted', 'private'));

DROP POLICY IF EXISTS "Users can view own or public contacts" ON public.user_contacts;

CREATE POLICY "Users can view own or allowed contacts"
ON public.user_contacts
FOR SELECT
TO public
USING (
  auth.uid() = user_id
  OR visibility = 'public'
  OR (visibility = 'restricted' AND public.is_staff_member(auth.uid()))
);
