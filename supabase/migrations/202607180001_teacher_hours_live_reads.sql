-- Fast teacher-hours fallback when a materialized monthly summary has been
-- invalidated by an attendance upload or class-log signature write.
-- Access remains scoped by the canonical Firebase portal identity.

drop policy if exists attendance_logs_firebase_teacher_scope_select
on public.attendance_logs;
create policy attendance_logs_firebase_teacher_scope_select
on public.attendance_logs
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

drop policy if exists signatures_firebase_teacher_scope_select
on public.signatures;
create policy signatures_firebase_teacher_scope_select
on public.signatures
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

comment on policy attendance_logs_firebase_teacher_scope_select
on public.attendance_logs is
  'Firebase teachers read only their own attendance rows; portal admins retain canonical scoped access.';

comment on policy signatures_firebase_teacher_scope_select
on public.signatures is
  'Firebase teachers read only their own hours-agreement signatures; portal admins retain canonical scoped access.';
