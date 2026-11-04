-- Extend only the attendance reconciliation RPC. The signed, expiring staff
-- session is issued after Firebase checks STAFF, active status and app access.
do $migration$
declare
  fn regprocedure := 'public.portal_apply_attendance_upload(jsonb)'::regprocedure;
  src text := pg_get_functiondef(fn);
  old_guard text := 'if not found or (identity_row.role <> ''admin'' and identity_row.all_student_access is not true) then';
  new_guard text := 'if not found or (identity_row.role <> ''admin'' and identity_row.all_student_access is not true and private.portal_staff_read_access() is not true) then';
begin
  if strpos(src,new_guard)>0 then return; end if;
  if cardinality(string_to_array(src,old_guard)) <> 2 then
    raise exception 'Unexpected attendance upload authorization guard';
  end if;
  execute replace(src,old_guard,new_guard);
end $migration$;
