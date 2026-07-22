-- Allow a signed-in Firebase teacher to repair a missing Supabase portal identity.
-- The match is intentionally strict: the verified Firebase email local part must
-- be an 11-digit Korean mobile number and must match exactly one active teacher.

create or replace function public.portal_ensure_own_identity()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_uid text := nullif((select auth.jwt() ->> 'sub'), '');
  actor_email text := lower(nullif((select auth.jwt() ->> 'email'), ''));
  phone_digits text := '';
  matched_teacher public.teachers%rowtype;
  matched_count integer := 0;
begin
  if actor_uid is null
     or (select auth.jwt() ->> 'iss') <> 'https://securetoken.google.com/fir-lms-prod'
     or (select auth.jwt() ->> 'aud') <> 'fir-lms-prod'
     or (select auth.jwt() ->> 'role') <> 'authenticated' then
    raise exception 'Firebase 로그인 권한을 확인할 수 없습니다.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.portal_identities
    where firebase_uid = actor_uid and active = true
  ) then
    return jsonb_build_object('success', true, 'provisioned', false);
  end if;

  if actor_email !~ '^[0-9]{11}@sedu-auth[.]local$' then
    raise exception '강사 계정 전화번호를 확인할 수 없습니다.' using errcode = '42501';
  end if;
  phone_digits := split_part(actor_email, '@', 1);

  select count(*) into matched_count
  from public.teachers
  where active = true
    and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = phone_digits;
  if matched_count <> 1 then
    raise exception '활성 강사 정보가 정확히 일치하지 않습니다.' using errcode = '42501';
  end if;

  select * into matched_teacher
  from public.teachers
  where active = true
    and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = phone_digits
  limit 1;

  insert into public.portal_identities (
    firebase_uid, teacher_id, teacher_name, role, active,
    all_teacher_access, all_student_access, source, synced_at
  ) values (
    actor_uid, matched_teacher.id, matched_teacher.display_name, 'teacher', true,
    false, false, 'firebase-email-phone-self-provision', now()
  )
  on conflict (firebase_uid) do update
  set teacher_id = excluded.teacher_id,
      teacher_name = excluded.teacher_name,
      role = case when public.portal_identities.role = 'admin' then 'admin' else 'teacher' end,
      active = true,
      all_teacher_access = case when public.portal_identities.role = 'admin' then public.portal_identities.all_teacher_access else false end,
      all_student_access = case when public.portal_identities.role = 'admin' then public.portal_identities.all_student_access else false end,
      source = excluded.source,
      synced_at = excluded.synced_at;

  return jsonb_build_object(
    'success', true,
    'provisioned', true,
    'teacherName', matched_teacher.display_name
  );
end;
$$;

revoke all on function public.portal_ensure_own_identity() from public, anon;
grant execute on function public.portal_ensure_own_identity() to authenticated;

comment on function public.portal_ensure_own_identity() is
  'Repairs a missing teacher portal identity from an exact Firebase sedu-auth email and active teacher phone match.';
