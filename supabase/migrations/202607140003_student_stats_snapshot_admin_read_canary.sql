-- Admin-only read policy for precomputed student statistics snapshots.
--
-- The snapshot contains aggregate rows for all students, so teacher-scoped
-- access is intentionally not allowed. Only an active portal admin or an
-- identity with all_student_access may read it through Firebase Third-Party Auth.

revoke all on public.student_stats_monthly_snapshots from anon, authenticated;
grant select on public.student_stats_monthly_snapshots to authenticated;

create or replace function private.portal_can_read_all_student_stats()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.portal_identities identity_row
    where identity_row.firebase_uid = nullif((select auth.jwt() ->> 'sub'), '')
      and identity_row.active = true
      and (
        identity_row.role = 'admin'
        or identity_row.all_student_access = true
      )
  )
$$;

revoke all on function private.portal_can_read_all_student_stats() from public;
grant execute on function private.portal_can_read_all_student_stats() to authenticated;

drop policy if exists student_stats_monthly_snapshots_firebase_admin_select
on public.student_stats_monthly_snapshots;

create policy student_stats_monthly_snapshots_firebase_admin_select
on public.student_stats_monthly_snapshots
for select
to authenticated
using (
  (select auth.jwt() ->> 'iss') = 'https://securetoken.google.com/fir-lms-prod'
  and (select auth.jwt() ->> 'aud') = 'fir-lms-prod'
  and (select auth.jwt() ->> 'role') = 'authenticated'
  and private.portal_can_read_all_student_stats()
);

comment on policy student_stats_monthly_snapshots_firebase_admin_select
on public.student_stats_monthly_snapshots is
  'Read-only Firebase shadow canary for administrators with all-student access.';
