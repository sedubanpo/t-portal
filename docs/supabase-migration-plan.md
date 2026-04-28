# Supabase PostgreSQL Migration Plan

## Goal

Move the academy portal from spreadsheet/Apps Script/Firebase-centered operational data to a PostgreSQL-backed model while preserving the current production path until validation is complete.

## Migration Principle

The existing source path remains the operational source during phase 1.

```text
MS Access export / current spreadsheet
  -> current Apps Script + Firebase path
  -> teacher portal

MS Access export / current spreadsheet
  -> Supabase PostgreSQL
  -> validation queries and future portal APIs
```

Cutover happens only after Supabase totals match the current portal for selected months and teachers.

## Phase 1: Parallel Database

1. Create a new Supabase project dedicated to the teacher portal.
   - Recommended project name: `sedu-teacher-portal-prod`.
   - Do not reuse a personal/test Supabase project. Attendance, signature, makeup, and audit data should live inside a clean operational boundary.
   - Create a separate development project later only when frontend reads/writes are actively migrated.
2. Run `supabase/migrations/202604290001_initial_academy_portal.sql`.
3. Set local environment variables:

```sh
export SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
```

For Apps Script uploads, use the `Legacy service_role` key from Supabase API Keys. The newer `sb_secret_...` key works for local Node imports, but Supabase blocks it on the Apps Script REST path.

4. Export a daily/monthly attendance CSV from Access.
5. Import it:

```sh
node scripts/import-attendance-csv.mjs /path/to/access-export.csv
```

6. Compare Supabase aggregate results with the current portal:

```sql
select *
from public.v_attendance_monthly_teacher
where month_start = date '2026-04-01'
order by teacher_name;
```

## Required Decisions

These are the only decisions needed before production connection:

1. Supabase project setup.
   - Decision: create a new project for this portal.
   - Recommended region: closest available region to Korea/Japan/Singapore.
   - Start read-only validation on a free project if needed, but use a paid project before production personal data or cutover so backups/PITR options can be enabled.
   - Store the service-role key only in local environment variables or a secret manager. Never paste it into `index.html`, Apps Script client code, or GitHub.

2. Access export contract.
   - Confirm the exact CSV headers and whether one file contains one day, one month, or all history.
   - The import script already accepts common Korean/English header names, but a fixed export template is safer.

3. Identity source of truth.
   - Decide whether teacher/student IDs will come from Access, current Teachers/student sheets, or Supabase-generated IDs.
   - Phase 1 uses normalized names plus school/grade for matching.

4. Authentication model.
   - Current phone/password can stay temporarily.
   - Before direct Supabase reads from the browser, define RLS policies by role: admin, teacher, homeroom teacher.

## Suggested Cutover Order

1. Read-only Supabase validation dashboard.
2. `시수 조회` read path.
3. `수강생 통합 관리` read path.
4. `학생 월간 수업 대시보드` read path.
5. `보강 추적기` read path.
6. Class log/signature writes.
7. Attendance writes.

This order minimizes risk because the current write path remains unchanged while query-heavy screens move first.

## Validation Queries

Teacher monthly hours:

```sql
select teacher_name, taught_count, taught_hours
from public.v_attendance_monthly_teacher
where month_start = date '2026-04-01'
order by taught_hours desc;
```

Student monthly summary:

```sql
select student_name, school, grade, attended_count, attended_hours, recent_class_date
from public.v_student_monthly_summary
where month_start = date '2026-04-01'
order by attended_count desc;
```

Daily rows for one teacher:

```sql
select class_date, student_name, category, status, start_time_text, end_time_text, hours, note
from public.attendance_logs
where teacher_name = '남종언'
  and class_date >= date '2026-04-01'
  and class_date < date '2026-05-01'
order by class_date, start_time_text;
```

## Safety Notes

- A new Supabase project is recommended because it gives this portal isolated credentials, RLS policies, backups, logs, and migration history.
- Reusing an existing project is acceptable only if it is already dedicated to this academy portal and has no unrelated tables, policies, or client keys.
- The service-role key must never be committed to the repository.
- Browser code should not use the service-role key.
- Phase 1 RLS creates no public read policies. Data is accessible only with service-role/admin access until auth is designed.
- `import_batches.source_hash` prevents accidental duplicate full-file imports.
- `attendance_logs.legacy_key` makes row-level upsert idempotent.

## Project Creation Checklist

After creating the new project, collect these values:

```text
SUPABASE_PROJECT_REF=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_HOST=
SUPABASE_DB_PASSWORD=
SUPABASE_REGION=
```

Only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are needed for the phase-1 import script. The anon key is recorded for later frontend migration, but should not be wired into the current portal until RLS policies are reviewed.
