create extension if not exists pgcrypto;

create table if not exists public.student_stats_monthly_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique,
  month_key text not null,
  schema_version text not null,
  snapshot_format_version text not null default 'v1',
  source_cache_version text not null default '',
  data_source text not null default '',
  fallback_from text not null default '',
  fallback_reason text not null default '',
  entry_count integer not null default 0,
  row_count integer not null default 0,
  rows_json jsonb not null default '[]'::jsonb,
  performance jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.student_stats_monthly_snapshots
  add column if not exists snapshot_key text,
  add column if not exists month_key text not null default '',
  add column if not exists schema_version text not null default '',
  add column if not exists snapshot_format_version text not null default 'v1',
  add column if not exists source_cache_version text not null default '',
  add column if not exists data_source text not null default '',
  add column if not exists fallback_from text not null default '',
  add column if not exists fallback_reason text not null default '',
  add column if not exists entry_count integer not null default 0,
  add column if not exists row_count integer not null default 0,
  add column if not exists rows_json jsonb not null default '[]'::jsonb,
  add column if not exists performance jsonb not null default '{}'::jsonb,
  add column if not exists refreshed_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists student_stats_monthly_snapshots_key_idx
  on public.student_stats_monthly_snapshots(snapshot_key);

create index if not exists student_stats_monthly_snapshots_lookup_idx
  on public.student_stats_monthly_snapshots(month_key, schema_version, source_cache_version);

create index if not exists student_stats_monthly_snapshots_refreshed_idx
  on public.student_stats_monthly_snapshots(refreshed_at desc);

drop trigger if exists student_stats_monthly_snapshots_touch_updated_at
on public.student_stats_monthly_snapshots;
create trigger student_stats_monthly_snapshots_touch_updated_at
before update on public.student_stats_monthly_snapshots
for each row execute function public.touch_updated_at();

alter table public.student_stats_monthly_snapshots enable row level security;
