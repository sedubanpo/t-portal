create extension if not exists pgcrypto;

create table if not exists public.student_subject_catalog (
  id uuid primary key default gen_random_uuid(),
  subject_group text not null,
  subject_name text not null,
  active boolean not null default true,
  sort_order integer not null default 999,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_subject_catalog_unique unique (subject_group, subject_name)
);

create table if not exists public.student_subject_choices (
  id uuid primary key default gen_random_uuid(),
  student_name text not null,
  student_key text not null,
  school text,
  grade text,
  subject_group text not null,
  subject_name text not null,
  term_label text,
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_student_subject_catalog_group
  on public.student_subject_catalog (subject_group, active, sort_order, subject_name);

create index if not exists idx_student_subject_choices_student
  on public.student_subject_choices (student_key, active, subject_group, created_at desc);

create index if not exists idx_student_subject_choices_history
  on public.student_subject_choices (student_key, subject_group, created_at desc);

create or replace function public.set_student_subject_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_student_subject_catalog_updated_at on public.student_subject_catalog;
create trigger trg_student_subject_catalog_updated_at
before update on public.student_subject_catalog
for each row execute function public.set_student_subject_updated_at();

drop trigger if exists trg_student_subject_choices_updated_at on public.student_subject_choices;
create trigger trg_student_subject_choices_updated_at
before update on public.student_subject_choices
for each row execute function public.set_student_subject_updated_at();
