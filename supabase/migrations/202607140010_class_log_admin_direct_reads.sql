-- Direct administrator reads for the class-log audit and checkout dashboards.
-- Firebase JWT identity and the canonical portal capability remain authoritative.

revoke all on public.class_log_rows from anon, authenticated;
revoke all on public.signatures from anon, authenticated;
grant select on public.class_log_rows to authenticated;
grant select on public.signatures to authenticated;

drop policy if exists class_log_rows_firebase_admin_select on public.class_log_rows;
create policy class_log_rows_firebase_admin_select
on public.class_log_rows for select to authenticated
using (private.portal_can_read_all_student_stats());

drop policy if exists signatures_firebase_admin_select on public.signatures;
create policy signatures_firebase_admin_select
on public.signatures for select to authenticated
using (private.portal_can_read_all_student_stats());
