-- Student movement tracker exclusion archive.

create table if not exists public.teacher_student_flow_exclusions (
  id uuid primary key default gen_random_uuid(),
  record_key text not null unique,
  student_name text not null default '',
  subject_group text not null default '',
  owner_teacher text not null default '',
  target_teacher text not null default '',
  current_teacher text not null default '',
  status text not null default '',
  latest_date date,
  days_since integer not null default 0,
  reason text not null default '',
  snapshot jsonb not null default '{}'::jsonb,
  created_by text,
  restored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists teacher_student_flow_exclusions_student_idx
  on public.teacher_student_flow_exclusions (student_name);

create index if not exists teacher_student_flow_exclusions_owner_idx
  on public.teacher_student_flow_exclusions (owner_teacher);

create index if not exists teacher_student_flow_exclusions_restored_idx
  on public.teacher_student_flow_exclusions (restored_at);

drop trigger if exists teacher_student_flow_exclusions_touch_updated_at
  on public.teacher_student_flow_exclusions;

create trigger teacher_student_flow_exclusions_touch_updated_at
before update on public.teacher_student_flow_exclusions
for each row execute function public.touch_updated_at();

alter table public.teacher_student_flow_exclusions enable row level security;
