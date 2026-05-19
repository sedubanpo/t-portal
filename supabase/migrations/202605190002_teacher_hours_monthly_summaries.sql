create table if not exists public.teacher_hours_monthly_summaries (
  id uuid primary key default gen_random_uuid(),
  summary_key text not null unique,
  month_key text not null,
  teacher_key text not null default 'ALL',
  teacher_name text not null default '',
  source_cache_version text not null default '',
  data_source text not null default '',
  fallback_from text not null default '',
  fallback_reason text not null default '',
  entry_count integer not null default 0,
  row_count integer not null default 0,
  state jsonb not null default '{}'::jsonb,
  performance jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teacher_hours_monthly_summaries
  add column if not exists summary_key text,
  add column if not exists month_key text,
  add column if not exists teacher_key text not null default 'ALL',
  add column if not exists teacher_name text not null default '',
  add column if not exists source_cache_version text not null default '',
  add column if not exists data_source text not null default '',
  add column if not exists fallback_from text not null default '',
  add column if not exists fallback_reason text not null default '',
  add column if not exists entry_count integer not null default 0,
  add column if not exists row_count integer not null default 0,
  add column if not exists state jsonb not null default '{}'::jsonb,
  add column if not exists performance jsonb not null default '{}'::jsonb,
  add column if not exists refreshed_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists teacher_hours_monthly_summaries_key_idx
  on public.teacher_hours_monthly_summaries(summary_key);

create index if not exists teacher_hours_monthly_summaries_lookup_idx
  on public.teacher_hours_monthly_summaries(month_key, teacher_key, source_cache_version);

create index if not exists teacher_hours_monthly_summaries_refreshed_idx
  on public.teacher_hours_monthly_summaries(refreshed_at desc);

drop trigger if exists teacher_hours_monthly_summaries_touch_updated_at
on public.teacher_hours_monthly_summaries;
create trigger teacher_hours_monthly_summaries_touch_updated_at
before update on public.teacher_hours_monthly_summaries
for each row execute function public.touch_updated_at();

alter table public.teacher_hours_monthly_summaries enable row level security;
