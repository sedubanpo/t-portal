create table if not exists public.portal_basic_info (
  id uuid primary key default gen_random_uuid(),
  item_key text not null unique,
  source text not null default 'google_sheet',
  label text not null default '',
  value text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true,
  raw_row jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portal_notices (
  id uuid primary key default gen_random_uuid(),
  notice_key text not null unique,
  source text not null default 'google_sheet',
  notice_type text not null default '',
  content text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true,
  raw_row jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portal_homeroom_students (
  id uuid primary key default gen_random_uuid(),
  record_key text not null unique,
  source text not null default 'google_sheet',
  student_id text not null default '',
  student_name text not null default '',
  subject text not null default '',
  instructor_id text not null default '',
  instructor_name text not null default '',
  updated_label text not null default '',
  updated_by text not null default '',
  active boolean not null default true,
  raw_row jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portal_master_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'portal-master',
  synced_by text not null default '',
  status text not null default 'completed',
  counts jsonb not null default '{}'::jsonb,
  message text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists portal_basic_info_active_idx
  on public.portal_basic_info(active, sort_order);

create index if not exists portal_notices_active_idx
  on public.portal_notices(active, sort_order);

create index if not exists portal_homeroom_students_active_idx
  on public.portal_homeroom_students(active, instructor_name, student_name);

create index if not exists portal_master_sync_runs_latest_idx
  on public.portal_master_sync_runs(source, started_at desc);

drop trigger if exists portal_basic_info_touch_updated_at
on public.portal_basic_info;
create trigger portal_basic_info_touch_updated_at
before update on public.portal_basic_info
for each row execute function public.touch_updated_at();

drop trigger if exists portal_notices_touch_updated_at
on public.portal_notices;
create trigger portal_notices_touch_updated_at
before update on public.portal_notices
for each row execute function public.touch_updated_at();

drop trigger if exists portal_homeroom_students_touch_updated_at
on public.portal_homeroom_students;
create trigger portal_homeroom_students_touch_updated_at
before update on public.portal_homeroom_students
for each row execute function public.touch_updated_at();

alter table public.portal_basic_info enable row level security;
alter table public.portal_notices enable row level security;
alter table public.portal_homeroom_students enable row level security;
alter table public.portal_master_sync_runs enable row level security;
