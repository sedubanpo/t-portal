// Explicit allowlist: live/database mutation tests must never run here.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const tests = [
  'access-upload-direct', 'access-dashboard-direct', 'class-log-overview-direct',
  'flow-stop-direct', 'homeroom-loading-repair', 'hours-monthly-students',
  'login-bootstrap-snapshot', 'monthly-enrollment-dashboard', 'portal-api-router',
  'portal-favicon', 'student-calendar-instant-open', 'student-slms-tab',
  'student-stats-fast-loading', 'student-stats-snapshot-invalidation',
  'student-weekly-timetable', 'supabase-hours-review', 'supabase-teacher-hours-backend',
  'teacher-hours-instant-agreement', 'teacher-hours-issue-reports',
  'teacher-hours-summary-invalidation', 'weekly-timetable-direct',
  'network-failures', 'login-admin-state', 'access-input-races', 'student-request-races'
];
let failed = 0;
for (const name of tests) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`test-${name}.mjs`, import.meta.url))], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024
  });
  // fileURLToPath is necessary for Korean and space-containing workspace paths.
  if (result.status !== 0) failed++;
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${name}`);
  if (result.status !== 0) console.log((result.stderr || result.stdout || String(result.error)).slice(0, 3000));
}
console.log(`${tests.length - failed}/${tests.length} offline suites passed`);
process.exitCode = failed ? 1 : 0;
