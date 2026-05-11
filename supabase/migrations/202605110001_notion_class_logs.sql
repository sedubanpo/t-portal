-- Notion class-log tracking.
-- Stores read-only snapshots from Notion's "수업일지DB" so the portal can
-- compare written lesson logs against Supabase attendance rows.

alter table public.students
  add column if not exists notion_student_page_id text;

create unique index if not exists students_notion_student_page_id_idx
  on public.students (notion_student_page_id)
  where notion_student_page_id is not null and notion_student_page_id <> '';

alter table public.teachers
  add column if not exists notion_teacher_page_id text;

create unique index if not exists teachers_notion_teacher_page_id_idx
  on public.teachers (notion_teacher_page_id)
  where notion_teacher_page_id is not null and notion_teacher_page_id <> '';

create table if not exists public.notion_class_logs (
  id uuid primary key default gen_random_uuid(),
  notion_page_id text not null,
  lesson_date date not null,
  teacher_name text,
  teacher_page_id text,
  student_name text,
  student_page_id text,
  subject text,
  lesson_type text,
  title text,
  source_url text,
  created_time timestamptz,
  last_edited_time timestamptz,
  raw_row jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notion_page_id)
);

create index if not exists notion_class_logs_lesson_date_idx
  on public.notion_class_logs (lesson_date);

create index if not exists notion_class_logs_teacher_date_idx
  on public.notion_class_logs (teacher_name, lesson_date);

create index if not exists notion_class_logs_student_date_idx
  on public.notion_class_logs (student_name, lesson_date);

create index if not exists notion_class_logs_student_page_idx
  on public.notion_class_logs (student_page_id)
  where student_page_id is not null and student_page_id <> '';

drop trigger if exists notion_class_logs_touch_updated_at on public.notion_class_logs;
create trigger notion_class_logs_touch_updated_at
before update on public.notion_class_logs
for each row execute function public.touch_updated_at();

alter table public.notion_class_logs enable row level security;
