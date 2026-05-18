-- Stopped student dashboard manual records and shared reasons.

create table if not exists public.student_stop_dashboard_records (
  id uuid primary key default gen_random_uuid(),
  record_key text not null unique,
  source text not null default 'auto',
  student_name text not null default '',
  school text not null default '',
  grade text not null default '',
  subject_group text not null default '',
  teacher_name text not null default '',
  latest_date date,
  stopped_date date,
  reason text not null default '',
  snapshot jsonb not null default '{}'::jsonb,
  created_by text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_stop_dashboard_records_student_idx
  on public.student_stop_dashboard_records (student_name);

create index if not exists student_stop_dashboard_records_source_idx
  on public.student_stop_dashboard_records (source);

create index if not exists student_stop_dashboard_records_deleted_idx
  on public.student_stop_dashboard_records (deleted_at);

drop trigger if exists student_stop_dashboard_records_touch_updated_at
  on public.student_stop_dashboard_records;

create trigger student_stop_dashboard_records_touch_updated_at
before update on public.student_stop_dashboard_records
for each row execute function public.touch_updated_at();

alter table public.student_stop_dashboard_records enable row level security;
