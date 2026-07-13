-- Read-only canary policy for Firebase-authenticated teacher-hours summaries.
--
-- Apply only after:
--   1. Supabase Third-Party Auth trusts Firebase project fir-lms-prod.
--   2. Firebase users have the custom claim role = authenticated.
--   3. portal_identities has been backfilled and verified.

revoke all on public.teacher_hours_monthly_summaries from anon, authenticated;
grant select on public.teacher_hours_monthly_summaries to authenticated;

create or replace function private.portal_teacher_id_by_name(target_teacher_name text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select teacher_row.id
  from public.teachers teacher_row
  where teacher_row.normalized_name = public.normalize_portal_name(target_teacher_name)
  limit 1
$$;

revoke all on function private.portal_teacher_id_by_name(text) from public;
grant execute on function private.portal_teacher_id_by_name(text) to authenticated;

drop policy if exists teacher_hours_monthly_summaries_firebase_scoped_select
on public.teacher_hours_monthly_summaries;

create policy teacher_hours_monthly_summaries_firebase_scoped_select
on public.teacher_hours_monthly_summaries
for select
to authenticated
using (
  (select auth.jwt() ->> 'iss') = 'https://securetoken.google.com/fir-lms-prod'
  and (select auth.jwt() ->> 'aud') = 'fir-lms-prod'
  and (select auth.jwt() ->> 'role') = 'authenticated'
  and private.portal_can_access_teacher(
    private.portal_teacher_id_by_name(teacher_name),
    nullif(teacher_name, '')
  )
);

comment on policy teacher_hours_monthly_summaries_firebase_scoped_select
on public.teacher_hours_monthly_summaries is
  'Read-only Firebase canary. Teachers can read only their own summary; portal admins follow portal_identities scope.';
