-- Expand per-user login bootstrap snapshot reads to active portal identities.
--
-- The trusted Apps Script server still verifies the Firebase token and creates
-- each teacher-scoped response. The browser receives read-only access to the
-- snapshot whose firebase_uid exactly matches the signed-in Firebase subject.

create or replace function private.portal_has_active_identity()
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
  )
$$;

revoke all on function private.portal_has_active_identity() from public;
grant execute on function private.portal_has_active_identity() to authenticated;

revoke all on public.portal_login_bootstrap_snapshots from anon, authenticated;
grant select on public.portal_login_bootstrap_snapshots to authenticated;

drop policy if exists portal_login_bootstrap_snapshots_firebase_admin_self_select
on public.portal_login_bootstrap_snapshots;

drop policy if exists portal_login_bootstrap_snapshots_firebase_self_select
on public.portal_login_bootstrap_snapshots;

create policy portal_login_bootstrap_snapshots_firebase_self_select
on public.portal_login_bootstrap_snapshots
for select
to authenticated
using (
  (select auth.jwt() ->> 'iss') = 'https://securetoken.google.com/fir-lms-prod'
  and (select auth.jwt() ->> 'aud') = 'fir-lms-prod'
  and (select auth.jwt() ->> 'role') = 'authenticated'
  and firebase_uid = nullif((select auth.jwt() ->> 'sub'), '')
  and private.portal_has_active_identity()
);

comment on policy portal_login_bootstrap_snapshots_firebase_self_select
on public.portal_login_bootstrap_snapshots is
  'Read-only Firebase access to the active identity own trusted login bootstrap snapshot.';
