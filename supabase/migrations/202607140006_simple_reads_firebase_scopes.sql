-- Direct read policies for small canonical portal datasets.
-- All access requires a valid Firebase Third-Party Auth token and an active
-- portal identity. Administrator datasets retain a second capability check.

revoke all on public.portal_notices from anon, authenticated;
grant select on public.portal_notices to authenticated;

drop policy if exists portal_notices_firebase_active_select on public.portal_notices;
create policy portal_notices_firebase_active_select
on public.portal_notices
for select
to authenticated
using (
  active = true
  and (select auth.jwt() ->> 'iss') = 'https://securetoken.google.com/fir-lms-prod'
  and (select auth.jwt() ->> 'aud') = 'fir-lms-prod'
  and (select auth.jwt() ->> 'role') = 'authenticated'
  and private.portal_has_active_identity()
);

revoke all on public.portal_master_sync_runs from anon, authenticated;
grant select on public.portal_master_sync_runs to authenticated;

drop policy if exists portal_master_sync_runs_firebase_admin_select on public.portal_master_sync_runs;
create policy portal_master_sync_runs_firebase_admin_select
on public.portal_master_sync_runs
for select
to authenticated
using (
  (select auth.jwt() ->> 'iss') = 'https://securetoken.google.com/fir-lms-prod'
  and (select auth.jwt() ->> 'aud') = 'fir-lms-prod'
  and (select auth.jwt() ->> 'role') = 'authenticated'
  and private.portal_can_read_all_student_stats()
);

revoke all on public.student_subject_catalog from anon, authenticated;
revoke all on public.student_subject_choices from anon, authenticated;
grant select on public.student_subject_catalog to authenticated;
grant select on public.student_subject_choices to authenticated;

drop policy if exists student_subject_catalog_firebase_admin_select on public.student_subject_catalog;
create policy student_subject_catalog_firebase_admin_select
on public.student_subject_catalog
for select
to authenticated
using (
  (select auth.jwt() ->> 'iss') = 'https://securetoken.google.com/fir-lms-prod'
  and (select auth.jwt() ->> 'aud') = 'fir-lms-prod'
  and (select auth.jwt() ->> 'role') = 'authenticated'
  and private.portal_can_read_all_student_stats()
);

drop policy if exists student_subject_choices_firebase_admin_select on public.student_subject_choices;
create policy student_subject_choices_firebase_admin_select
on public.student_subject_choices
for select
to authenticated
using (
  (select auth.jwt() ->> 'iss') = 'https://securetoken.google.com/fir-lms-prod'
  and (select auth.jwt() ->> 'aud') = 'fir-lms-prod'
  and (select auth.jwt() ->> 'role') = 'authenticated'
  and private.portal_can_read_all_student_stats()
);
