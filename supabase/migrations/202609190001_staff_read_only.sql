-- Approved 2026-09-19: active STAFF with teacherPortal enabled may read admin
-- information. The Firebase server issues a one-hour read-only claim after
-- checking live Firestore account/profile/access state. No write scope changes.
begin;
create or replace function private.portal_staff_read_access()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'iss','')='https://securetoken.google.com/fir-lms-prod'
    and coalesce(auth.jwt()->>'aud','')='fir-lms-prod'
    and coalesce(auth.jwt()->>'role','')='authenticated'
    and case when coalesce(auth.jwt()->>'portalStaffReadUntil','') ~ '^[0-9]{1,12}$'
      then (auth.jwt()->>'portalStaffReadUntil')::bigint > extract(epoch from now())
      else false end
    and exists(select 1 from public.portal_identities p where p.firebase_uid=auth.jwt()->>'sub' and p.active=true);
$$;
revoke all on function private.portal_staff_read_access() from public,anon;
grant execute on function private.portal_staff_read_access() to authenticated;

do $$
declare tbl text; fn record; definition text;
begin
  foreach tbl in array array['teacher_hours_monthly_summaries','student_stats_monthly_snapshots','portal_master_sync_runs','student_subject_catalog','student_subject_choices','attendance_logs','import_batches','class_log_rows','signatures','teacher_student_flow_exclusions'] loop
    execute format('drop policy if exists portal_staff_read_only on public.%I',tbl);
    execute format('create policy portal_staff_read_only on public.%I for select to authenticated using (private.portal_staff_read_access())',tbl);
  end loop;
  -- Only the explicitly enumerated read RPCs. Shared scope helpers used by
  -- save/upload/review functions deliberately retain their existing behavior.
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('portal_get_student_stop_dashboard','portal_get_teacher_student_flow_dashboard','portal_get_teacher_student_flow_dashboard_v2','portal_get_teacher_hours_live','portal_list_teacher_hours_issues') loop
    definition:=pg_get_functiondef(fn.oid);
    if position('private.portal_staff_read_access()' in definition)>0 then continue; end if;
    definition:=replace(definition,'private.portal_can_read_all_student_stats()','(private.portal_can_read_all_student_stats() or private.portal_staff_read_access())');
    definition:=replace(definition,'private.portal_can_access_teacher(private.portal_teacher_id_by_name(v_teacher), v_teacher)','(private.portal_can_access_teacher(private.portal_teacher_id_by_name(v_teacher), v_teacher) or private.portal_staff_read_access())');
    if fn.proname='portal_list_teacher_hours_issues' then
      definition:=replace(definition,'identity_row.role = ''admin''','(identity_row.role = ''admin'' or private.portal_staff_read_access())');
    end if;
    execute definition;
  end loop;
end $$;
commit;
