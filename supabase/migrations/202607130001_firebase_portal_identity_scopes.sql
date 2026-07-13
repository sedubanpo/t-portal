-- Firebase Auth / Firestore identity projection for the teacher portal.
--
-- This migration intentionally does not add policies to attendance_logs or
-- other operational tables. It creates the identity and scope foundation only.
-- Operational read policies must be added after UID mappings and teacher/student
-- foreign keys are backfilled and parity-tested.

create schema if not exists private;
revoke all on schema private from public;

create table if not exists public.portal_identities (
  firebase_uid text primary key,
  teacher_id uuid references public.teachers(id) on delete set null,
  teacher_name text not null default '',
  role text not null default 'teacher',
  active boolean not null default true,
  all_teacher_access boolean not null default false,
  all_student_access boolean not null default false,
  source text not null default 'firestore',
  source_version text,
  source_metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_identities_uid_not_blank check (length(btrim(firebase_uid)) > 0),
  constraint portal_identities_role_check check (role in ('teacher', 'homeroom', 'admin'))
);

create unique index if not exists portal_identities_teacher_id_unique
  on public.portal_identities (teacher_id)
  where teacher_id is not null;

create index if not exists portal_identities_active_role_idx
  on public.portal_identities (active, role);

create table if not exists public.portal_identity_teacher_scopes (
  firebase_uid text not null references public.portal_identities(firebase_uid) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (firebase_uid, teacher_id)
);

create index if not exists portal_identity_teacher_scopes_teacher_idx
  on public.portal_identity_teacher_scopes (teacher_id, firebase_uid);

create table if not exists public.portal_identity_student_scopes (
  firebase_uid text not null references public.portal_identities(firebase_uid) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (firebase_uid, student_id)
);

create index if not exists portal_identity_student_scopes_student_idx
  on public.portal_identity_student_scopes (student_id, firebase_uid);

drop trigger if exists portal_identities_touch_updated_at on public.portal_identities;
create trigger portal_identities_touch_updated_at
before update on public.portal_identities
for each row execute function public.touch_updated_at();

alter table public.portal_identities enable row level security;
alter table public.portal_identity_teacher_scopes enable row level security;
alter table public.portal_identity_student_scopes enable row level security;

revoke all on public.portal_identities from anon, authenticated;
revoke all on public.portal_identity_teacher_scopes from anon, authenticated;
revoke all on public.portal_identity_student_scopes from anon, authenticated;

grant select on public.portal_identities to authenticated;
grant select on public.portal_identity_teacher_scopes to authenticated;
grant select on public.portal_identity_student_scopes to authenticated;

drop policy if exists portal_identities_select_self on public.portal_identities;
create policy portal_identities_select_self
on public.portal_identities
for select
to authenticated
using (
  active = true
  and firebase_uid = nullif((select auth.jwt() ->> 'sub'), '')
);

drop policy if exists portal_identity_teacher_scopes_select_self on public.portal_identity_teacher_scopes;
create policy portal_identity_teacher_scopes_select_self
on public.portal_identity_teacher_scopes
for select
to authenticated
using (firebase_uid = nullif((select auth.jwt() ->> 'sub'), ''));

drop policy if exists portal_identity_student_scopes_select_self on public.portal_identity_student_scopes;
create policy portal_identity_student_scopes_select_self
on public.portal_identity_student_scopes
for select
to authenticated
using (firebase_uid = nullif((select auth.jwt() ->> 'sub'), ''));

create or replace function private.portal_can_access_teacher(
  target_teacher_id uuid,
  target_teacher_name text default null
)
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
        or identity_row.all_teacher_access = true
        or (target_teacher_id is not null and identity_row.teacher_id = target_teacher_id)
        or (
          target_teacher_id is null
          and nullif(btrim(target_teacher_name), '') is not null
          and public.normalize_portal_name(identity_row.teacher_name) = public.normalize_portal_name(target_teacher_name)
        )
        or exists (
          select 1
          from public.portal_identity_teacher_scopes teacher_scope
          where teacher_scope.firebase_uid = identity_row.firebase_uid
            and teacher_scope.teacher_id = target_teacher_id
        )
      )
  )
$$;

create or replace function private.portal_can_access_student(target_student_id uuid)
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
        or exists (
          select 1
          from public.portal_identity_student_scopes student_scope
          where student_scope.firebase_uid = identity_row.firebase_uid
            and student_scope.student_id = target_student_id
        )
      )
  )
$$;

revoke all on function private.portal_can_access_teacher(uuid, text) from public;
revoke all on function private.portal_can_access_student(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.portal_can_access_teacher(uuid, text) to authenticated;
grant execute on function private.portal_can_access_student(uuid) to authenticated;

comment on table public.portal_identities is
  'Read-only projection of Firebase/Firestore teacher portal identities for Supabase authorization.';
comment on function private.portal_can_access_teacher(uuid, text) is
  'Authorization helper for future teacher-scoped RLS policies. Does not expose operational tables by itself.';
comment on function private.portal_can_access_student(uuid) is
  'Authorization helper for future student-scoped RLS policies. Does not expose operational tables by itself.';

