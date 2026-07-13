-- Expand the read-only teacher-hours identity scope to every active Firebase instructor.
-- The join is deliberately strict: normalized phone and display name must both match exactly once.

do $$
declare
  expected_count constant integer := 31;
  matched_count integer;
begin
  with expected(firebase_uid, phone_digits, teacher_name, role, all_teacher_access) as (
    values
      ('teacher_01029006589', '01029006589', '강세진', 'teacher', false),
      ('teacher_01050849557', '01050849557', '강영훈', 'teacher', false),
      ('teacher_01041836314', '01041836314', '김경민', 'teacher', false),
      ('teacher_01090020257', '01090020257', '김경석', 'teacher', false),
      ('teacher_01057861258', '01057861258', '김다인', 'teacher', false),
      ('teacher_01095967634', '01095967634', '김대일', 'teacher', false),
      ('teacher_01057532636', '01057532636', '김미라', 'teacher', false),
      ('teacher_01033934700', '01033934700', '김용찬', 'teacher', false),
      ('teacher_01034265447', '01034265447', '김이천', 'teacher', false),
      ('teacher_01051434540', '01051434540', '김인중', 'teacher', false),
      ('teacher_01088342967', '01088342967', '김인찬', 'teacher', false),
      ('teacher_01086021065', '01086021065', '남종언', 'teacher', false),
      ('teacher_01054008814', '01054008814', '문진영', 'teacher', false),
      ('teacher_01082673597', '01082673597', '박경훈', 'teacher', false),
      ('teacher_01099159605', '01099159605', '박규연', 'teacher', false),
      ('teacher_01067922976', '01067922976', '박민식', 'teacher', false),
      ('teacher_01021711681', '01021711681', '박서연', 'teacher', false),
      ('teacher_01020837308', '01020837308', '박은채', 'teacher', false),
      ('teacher_01042050617', '01042050617', '박준휘', 'teacher', false),
      ('teacher_01071311416', '01071311416', '송경석', 'teacher', false),
      ('teacher_01086262428', '01086262428', '안종성', 'teacher', false),
      ('teacher_01089945993', '01089945993', '안준성', 'admin', true),
      ('teacher_01042327428', '01042327428', '에스에듀', 'teacher', false),
      ('teacher_01063085081', '01063085081', '유소연', 'teacher', false),
      ('teacher_01054741440', '01054741440', '유아현', 'teacher', false),
      ('teacher_01028787522', '01028787522', '이선희', 'teacher', false),
      ('teacher_01098951893', '01098951893', '이영재', 'teacher', false),
      ('teacher_01097676461', '01097676461', '이은선', 'teacher', false),
      ('teacher_01022612809', '01022612809', '전다인', 'teacher', false),
      ('teacher_01046042616', '01046042616', '정지호', 'teacher', false),
      ('teacher_01052259356', '01052259356', '홍성우', 'teacher', false)
  )
  select count(*)
  into matched_count
  from expected e
  join public.teachers t
    on regexp_replace(coalesce(t.phone, ''), '[^0-9]', '', 'g') = e.phone_digits
   and regexp_replace(coalesce(t.display_name, ''), '[[:space:]]+', '', 'g') = regexp_replace(e.teacher_name, '[[:space:]]+', '', 'g');

  if matched_count <> expected_count then
    raise exception 'teacher identity expansion aborted: expected % exact matches, found %', expected_count, matched_count;
  end if;
end
$$;

with expected(firebase_uid, phone_digits, teacher_name, role, all_teacher_access) as (
  values
    ('teacher_01029006589', '01029006589', '강세진', 'teacher', false),
    ('teacher_01050849557', '01050849557', '강영훈', 'teacher', false),
    ('teacher_01041836314', '01041836314', '김경민', 'teacher', false),
    ('teacher_01090020257', '01090020257', '김경석', 'teacher', false),
    ('teacher_01057861258', '01057861258', '김다인', 'teacher', false),
    ('teacher_01095967634', '01095967634', '김대일', 'teacher', false),
    ('teacher_01057532636', '01057532636', '김미라', 'teacher', false),
    ('teacher_01033934700', '01033934700', '김용찬', 'teacher', false),
    ('teacher_01034265447', '01034265447', '김이천', 'teacher', false),
    ('teacher_01051434540', '01051434540', '김인중', 'teacher', false),
    ('teacher_01088342967', '01088342967', '김인찬', 'teacher', false),
    ('teacher_01086021065', '01086021065', '남종언', 'teacher', false),
    ('teacher_01054008814', '01054008814', '문진영', 'teacher', false),
    ('teacher_01082673597', '01082673597', '박경훈', 'teacher', false),
    ('teacher_01099159605', '01099159605', '박규연', 'teacher', false),
    ('teacher_01067922976', '01067922976', '박민식', 'teacher', false),
    ('teacher_01021711681', '01021711681', '박서연', 'teacher', false),
    ('teacher_01020837308', '01020837308', '박은채', 'teacher', false),
    ('teacher_01042050617', '01042050617', '박준휘', 'teacher', false),
    ('teacher_01071311416', '01071311416', '송경석', 'teacher', false),
    ('teacher_01086262428', '01086262428', '안종성', 'teacher', false),
    ('teacher_01089945993', '01089945993', '안준성', 'admin', true),
    ('teacher_01042327428', '01042327428', '에스에듀', 'teacher', false),
    ('teacher_01063085081', '01063085081', '유소연', 'teacher', false),
    ('teacher_01054741440', '01054741440', '유아현', 'teacher', false),
    ('teacher_01028787522', '01028787522', '이선희', 'teacher', false),
    ('teacher_01098951893', '01098951893', '이영재', 'teacher', false),
    ('teacher_01097676461', '01097676461', '이은선', 'teacher', false),
    ('teacher_01022612809', '01022612809', '전다인', 'teacher', false),
    ('teacher_01046042616', '01046042616', '정지호', 'teacher', false),
    ('teacher_01052259356', '01052259356', '홍성우', 'teacher', false)
)
insert into public.portal_identities (
  firebase_uid,
  teacher_id,
  teacher_name,
  role,
  active,
  all_teacher_access,
  all_student_access,
  source,
  synced_at
)
select
  e.firebase_uid,
  t.id,
  e.teacher_name,
  e.role,
  true,
  e.all_teacher_access,
  false,
  'verified-teachers-phone-name',
  now()
from expected e
join public.teachers t
  on regexp_replace(coalesce(t.phone, ''), '[^0-9]', '', 'g') = e.phone_digits
 and regexp_replace(coalesce(t.display_name, ''), '[[:space:]]+', '', 'g') = regexp_replace(e.teacher_name, '[[:space:]]+', '', 'g')
on conflict (firebase_uid) do update
set teacher_id = excluded.teacher_id,
    teacher_name = excluded.teacher_name,
    role = excluded.role,
    active = excluded.active,
    all_teacher_access = excluded.all_teacher_access,
    all_student_access = excluded.all_student_access,
    source = excluded.source,
    synced_at = excluded.synced_at;
