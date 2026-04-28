-- S-EDU teacher portal Supabase baseline schema.
-- Phase 1 keeps the current Apps Script/Firebase path intact and adds a
-- normalized PostgreSQL target for parallel imports and read-model validation.

create extension if not exists pgcrypto;

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'access-export',
  source_file text,
  source_hash text,
  imported_by text,
  imported_at timestamptz not null default now(),
  row_count integer not null default 0,
  status text not null default 'pending',
  note text,
  metadata jsonb not null default '{}'::jsonb,
  constraint import_batches_status_check check (status in ('pending', 'completed', 'failed', 'rolled_back'))
);

create unique index if not exists import_batches_source_hash_idx
  on public.import_batches (source_hash)
  where source_hash is not null;

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_name text not null,
  phone text,
  subject text,
  active boolean not null default true,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name)
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_name text not null,
  school text,
  school_key text generated always as (coalesce(school, '')) stored,
  school_level text,
  grade text,
  grade_key text generated always as (coalesce(grade, '')) stored,
  active boolean not null default true,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name, school_key, grade_key)
);

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  legacy_key text,
  class_date date not null,
  display_date text,
  category text,
  subject text,
  lesson_type text,
  student_id uuid references public.students(id),
  student_name text not null,
  student_school text,
  student_grade text,
  teacher_id uuid references public.teachers(id),
  teacher_name text not null,
  status text,
  campus text,
  start_time_text text,
  end_time_text text,
  hours numeric(6,2) not null default 0,
  note text,
  raw_student text,
  raw_row jsonb not null default '{}'::jsonb,
  import_batch_id uuid references public.import_batches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_updated_at timestamptz,
  unique (legacy_key)
);

create index if not exists attendance_logs_class_date_idx
  on public.attendance_logs (class_date);
create index if not exists attendance_logs_teacher_date_idx
  on public.attendance_logs (teacher_name, class_date);
create index if not exists attendance_logs_student_date_idx
  on public.attendance_logs (student_name, class_date);
create index if not exists attendance_logs_status_date_idx
  on public.attendance_logs (status, class_date);
create index if not exists attendance_logs_import_batch_idx
  on public.attendance_logs (import_batch_id);

create table if not exists public.class_log_rows (
  id uuid primary key default gen_random_uuid(),
  legacy_key text,
  class_date date not null,
  teacher_name text not null,
  student_name text not null,
  status text,
  reason text,
  start_time_text text,
  end_time_text text,
  class_name text,
  raw_row jsonb not null default '{}'::jsonb,
  import_batch_id uuid references public.import_batches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (legacy_key)
);

create index if not exists class_log_rows_date_teacher_idx
  on public.class_log_rows (class_date, teacher_name);

create table if not exists public.signatures (
  id uuid primary key default gen_random_uuid(),
  class_date date not null,
  teacher_name text not null,
  signed boolean not null default false,
  signed_at timestamptz,
  signed_by text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_date, teacher_name)
);

create table if not exists public.makeup_links (
  id uuid primary key default gen_random_uuid(),
  original_attendance_id uuid references public.attendance_logs(id),
  makeup_attendance_id uuid references public.attendance_logs(id),
  status text not null default 'unresolved',
  recognized_overdue boolean not null default false,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_links_status_check check (status in ('unresolved', 'linked', 'recognized', 'ignored'))
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor text,
  event_type text not null,
  entity_table text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.normalize_portal_name(input text)
returns text
language sql
immutable
as $$
  select regexp_replace(regexp_replace(coalesce(input, ''), '\s*T$', '', 'i'), '\s+', '', 'g')
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists teachers_touch_updated_at on public.teachers;
create trigger teachers_touch_updated_at
before update on public.teachers
for each row execute function public.touch_updated_at();

drop trigger if exists students_touch_updated_at on public.students;
create trigger students_touch_updated_at
before update on public.students
for each row execute function public.touch_updated_at();

drop trigger if exists attendance_logs_touch_updated_at on public.attendance_logs;
create trigger attendance_logs_touch_updated_at
before update on public.attendance_logs
for each row execute function public.touch_updated_at();

drop trigger if exists class_log_rows_touch_updated_at on public.class_log_rows;
create trigger class_log_rows_touch_updated_at
before update on public.class_log_rows
for each row execute function public.touch_updated_at();

drop trigger if exists signatures_touch_updated_at on public.signatures;
create trigger signatures_touch_updated_at
before update on public.signatures
for each row execute function public.touch_updated_at();

create or replace view public.v_attendance_monthly_teacher as
select
  date_trunc('month', class_date)::date as month_start,
  teacher_name,
  count(*) as row_count,
  count(*) filter (
    where coalesce(status, '') <> '당일취소'
      and coalesce(status, '') not like '%예고%'
      and hours > 0
  ) as taught_count,
  sum(
    case
      when coalesce(status, '') = '당일취소' or coalesce(status, '') like '%예고%' then 0
      else hours
    end
  ) as taught_hours
from public.attendance_logs
group by 1, 2;

create or replace view public.v_student_monthly_summary as
select
  date_trunc('month', class_date)::date as month_start,
  student_name,
  max(student_school) as school,
  max(student_grade) as grade,
  count(*) filter (
    where coalesce(status, '') <> '당일취소'
      and coalesce(status, '') not like '%예고%'
      and hours > 0
  ) as attended_count,
  sum(
    case
      when coalesce(status, '') = '당일취소' or coalesce(status, '') like '%예고%' then 0
      else hours
    end
  ) as attended_hours,
  max(class_date) as recent_class_date
from public.attendance_logs
group by 1, 2;

alter table public.import_batches enable row level security;
alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.class_log_rows enable row level security;
alter table public.signatures enable row level security;
alter table public.makeup_links enable row level security;
alter table public.audit_events enable row level security;

-- Phase 1 intentionally creates no public anon policies.
-- The import script uses a service-role key locally; application read policies
-- should be added only after auth/role mapping is finalized.
