# Notion Class Log Tracking

## Purpose

Track whether teachers wrote lesson logs in Notion's `수업일지DB`, then compare those logs against Supabase attendance rows used by the teacher portal.

## Data Flow

```text
Notion 수업일지DB
  -> Apps Script server sync
  -> Supabase notion_class_logs
  -> existing class-log audit overview
  -> compare with attendance_logs
```

The browser never receives the Notion API token. Apps Script reads Notion with Script Properties and stores snapshots in Supabase.

## Required Supabase Migration

Run:

```sql
supabase/migrations/202605110001_notion_class_logs.sql
```

This creates `notion_class_logs` and adds optional Notion page-id mapping columns to `students` and `teachers`.

## Required Notion Setup

1. Create a Notion integration.
2. Share both databases with the integration:
   - `수업일지DB`
   - `재원생 DB-학부모용`
3. Copy the database IDs.

## Apps Script Properties

Required:

```text
NOTION_API_KEY=
NOTION_CLASS_LOG_DB_ID=
```

Recommended:

```text
NOTION_STUDENT_DB_ID=
```

Optional property-name overrides:

```text
NOTION_CLASS_LOG_TEACHER_PROP=강사명
NOTION_CLASS_LOG_STUDENT_PROP=학생명
NOTION_CLASS_LOG_TITLE_PROP=수업 제목(클릭)
NOTION_CLASS_LOG_DATE_PROP=날짜
NOTION_CLASS_LOG_TYPE_PROP=수업유형
```

## Matching Policy

Phase 1 treats a Notion row as a submitted lesson log when these fields are present:

```text
lesson_date + teacher_name + student_name
```

If the Notion `학생명` relation points to a student page, the sync stores both:

```text
student_name
student_page_id
```

That page id should later be mapped to `students.notion_student_page_id` for stronger matching and same-name protection.

## Current Limitation

Notion rows usually do not include start/end time, so same-day duplicate lessons by the same teacher/student may need manual review. A later phase should add time or attendance-log relation fields if exact one-to-one matching becomes necessary.
