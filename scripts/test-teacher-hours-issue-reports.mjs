import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../portal-runtime-config.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/202608260001_teacher_hours_issue_reports.sql', import.meta.url), 'utf8');

assert.match(source, /const APP_VERSION = 'v[0-9]+'/);
assert.match(source, /시수오류/);
assert.match(source, /function submitHoursIssueReport\(/);
assert.match(source, /function loadTeacherHoursIssueReports\(/);
assert.match(source, /function loadTeacherHoursIssueInbox\(/);
assert.match(source, /function saveTeacherHoursIssueReview\(/);
assert.match(source, /function getTeacherHoursIssueForItem_\(/);
assert.match(source, /attendanceLogId: String\(item\.attendance_log_id/);
assert.match(source, /function renderTeacherHoursIssueNotices_\(/);
assert.match(source, /id="hours-issue-notices"/);
assert.match(source, /supabase-upload-modal\.issues-mode/);
assert.match(source, /class="supabase-modal-close"/);
assert.match(source, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(source, /portal_list_teacher_hours_issues/);
assert.match(source, /portal_submit_teacher_hours_issue/);
assert.match(source, /portal_review_teacher_hours_issue/);
assert.match(config, /submitTeacherHoursIssueReport/);
assert.match(config, /reviewTeacherHoursIssueReport/);
assert.match(migration, /create table if not exists public\.teacher_hours_issue_reports/);
assert.match(migration, /reporter_uid = identity_row\.firebase_uid/);
assert.match(migration, /identity_row\.role <> 'admin'/);
assert.match(migration, /workflow_status in \('received', 'held'\)/);
assert.match(migration, /grant execute on function public\.portal_submit_teacher_hours_issue/);
assert.doesNotMatch(source.match(/function submitHoursIssueReport\([\s\S]*?\n  }/)[0], /google\.script\.run/);

const identityCompatMigration = fs.readFileSync(new URL('../supabase/migrations/202608260003_teacher_hours_issue_identity_compat.sql', import.meta.url), 'utf8');
assert.match(identityCompatMigration, /r\.reporter_uid = identity_row\.firebase_uid/);
assert.match(identityCompatMigration, /identity_row\.role in \('teacher', 'homeroom'\)/);
assert.match(identityCompatMigration, /normalize_portal_name\(r\.teacher_name\)[\s\S]*normalize_portal_name\(identity_row\.teacher_name\)/);
assert.doesNotMatch(identityCompatMigration, /grant\s+(select|insert|update|delete)\s+on\s+public\.teacher_hours_issue_reports\s+to\s+authenticated/i);

console.log(JSON.stringify({ ok:true, version:'v517', teacherUi:true, adminInbox:true, robustReportMatch:true, visibleStaffReply:true, stableActionLayout:true, directSupabase:true, rlsRpc:true, uidRemapCompatible:true }, null, 2));
