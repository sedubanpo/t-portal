-- Reconcile Supabase portal capabilities with the canonical Firebase admin roles.
-- Verified against users/{uid}.role=ADMIN and userAppAccess/{uid}.teacherPortal=true
-- on 2026-07-14. STAFF or disabled accounts are deliberately excluded.

do $$
declare
  updated_count integer;
begin
  update public.portal_identities
  set role = 'admin',
      active = true,
      all_teacher_access = true,
      all_student_access = true,
      source = 'firebase-canonical-admin-reconcile-20260714',
      synced_at = now()
  where firebase_uid in (
    'teacher_01033934700', -- 김용찬
    'teacher_01052259356', -- 홍성우
    'teacher_01089945993', -- 안준성
    'teacher_01042327428'  -- 에스에듀
  );

  get diagnostics updated_count = row_count;
  if updated_count <> 4 then
    raise exception 'admin identity reconciliation aborted: expected 4 rows, updated %', updated_count;
  end if;
end
$$;
