-- Access upload support screens read Supabase directly with Firebase admin RLS.

revoke all on public.import_batches from anon, authenticated;
grant select on public.import_batches to authenticated;

drop policy if exists import_batches_firebase_admin_select on public.import_batches;
create policy import_batches_firebase_admin_select
on public.import_batches for select to authenticated
using (private.portal_can_read_all_student_stats());
