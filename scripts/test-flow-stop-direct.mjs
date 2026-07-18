import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexText = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migrationText = fs.readFileSync(new URL('../supabase/migrations/202607180004_student_flow_stop_direct_reads.sql', import.meta.url), 'utf8');
const preserveText = fs.readFileSync(new URL('../supabase/migrations/202607180003_teacher_hours_preserved_rows.sql', import.meta.url), 'utf8');

assert.match(indexText, /portal_get_teacher_student_flow_dashboard_v2/);
assert.match(indexText, /portal_get_student_stop_dashboard/);
assert.match(indexText, /teacher_student_flow_exclusions\?select=/);
assert.match(indexText, /class="hours-students-panel"/);
assert.match(indexText, /function renderHoursMonthlyStudents\(\)/);
assert.match(indexText, /@media \(min-width: 1200px\)/);
assert.match(indexText, /"summary calendar students"/);
assert.match(indexText, /source: 'supabase-direct-rpc-v2'/);
assert.match(indexText, /source: 'apps-script-fallback'/);
assert.match(indexText, /studentStopDashboardState\.source = 'supabase-direct-rpc'/);
assert.match(indexText, /studentStopDashboardState\.source = 'apps-script-fallback'/);
const exclusionsFunction = indexText.slice(
  indexText.indexOf('function fetchTeacherStudentFlowExclusions'),
  indexText.indexOf('function getTeacherStudentFlowRecordKey')
);
assert.doesNotMatch(exclusionsFunction, /const localMap = loadTeacherStudentFlowExclusionsFromLocal\(\)/);
assert.match(migrationText, /private\.portal_can_read_all_student_stats\(\)/);
assert.match(migrationText, /revoke all on function public\.portal_get_student_stop_dashboard\(jsonb\) from public, anon/i);
assert.match(migrationText, /latest_rotated/);
assert.match(migrationText, /previous_rotated/);
assert.match(preserveText, /uploadPlanSummary/);
assert.match(preserveText, /b\.preserve_mode or a\.import_batch_id = b\.id/);

console.log(JSON.stringify({ ok: true, directDashboards: 2, desktopStudentRail: true, preserveMode: true }));
