-- Expand the read-only teacher-hours canary to two teacher-scoped users.
-- The teacher IDs were verified against public.teachers before rollout.

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
values
  (
    'teacher_01020837308',
    '4a43ab3d-6458-47e7-af17-40048704ba0d',
    '박은채',
    'teacher',
    true,
    false,
    false,
    'firestore',
    now()
  ),
  (
    'teacher_01051434540',
    '538303e9-a0d2-4519-bc86-35db1a6bf0af',
    '김인중',
    'teacher',
    true,
    false,
    false,
    'firestore',
    now()
  )
on conflict (firebase_uid) do update
set teacher_id = excluded.teacher_id,
    teacher_name = excluded.teacher_name,
    role = excluded.role,
    active = excluded.active,
    all_teacher_access = excluded.all_teacher_access,
    all_student_access = excluded.all_student_access,
    source = excluded.source,
    synced_at = excluded.synced_at;
