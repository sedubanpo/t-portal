#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gasText = fs.readFileSync(path.join(root, 'code.gs'), 'utf8');

function extractFunction(name) {
  const start = gasText.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in code.gs`);
  const bodyStart = gasText.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < gasText.length; index += 1) {
    if (gasText[index] === '{') depth += 1;
    if (gasText[index] === '}') depth -= 1;
    if (depth === 0) return gasText.slice(start, index + 1);
  }
  throw new Error(`${name} closing brace not found`);
}

const requests = [];
const context = {
  console,
  encodeURIComponent,
  STUDENT_STATS_OVERVIEW_SCHEMA_VERSION: 'v291',
  getSupabaseConfig_() { return { success: true }; },
  supabaseRequest_(config, pathValue, method, body, options) {
    requests.push({ config, path: pathValue, method, body, options });
    return [];
  }
};
vm.createContext(context);
vm.runInContext([
  extractFunction('invalidateStudentStatsOverviewSnapshotMonths_'),
  extractFunction('invalidateAllStudentStatsOverviewSnapshots_')
].join('\n'), context, { filename: 'student-stats-snapshot-invalidation.js' });

assert.equal(context.invalidateStudentStatsOverviewSnapshotMonths_(['2026-07', '2026-07', 'invalid', '2026-08']), 2);
assert.deepEqual(requests.map(item => item.path), [
  'student_stats_monthly_snapshots?month_key=eq.2026-07&schema_version=eq.v291',
  'student_stats_monthly_snapshots?month_key=eq.2026-08&schema_version=eq.v291'
]);
assert.ok(requests.every(item => item.method === 'delete' && item.options?.Prefer === 'return=minimal'));

requests.length = 0;
assert.equal(context.invalidateAllStudentStatsOverviewSnapshots_(), true);
assert.equal(requests[0].path, 'student_stats_monthly_snapshots?schema_version=eq.v291');
assert.equal(requests[0].method, 'delete');

assert.match(gasText, /syncToFirebaseLocked_[\s\S]*?invalidateStudentStatsOverviewSnapshotMonths_\(Object\.keys\(affectedMonthKeys\)\)/);
assert.match(gasText, /uploadSupabaseAttendanceCsv[\s\S]*?invalidateStudentStatsOverviewSnapshotMonths_\(getTeacherHoursMonthKeysFromUploadSource_\(parsed\)\)/);
assert.match(gasText, /repairSupabaseAccessAttendanceBatch[\s\S]*?invalidateStudentStatsOverviewSnapshotMonths_/);
assert.match(gasText, /syncPortalMasterDataToSupabase[\s\S]*?invalidateAllStudentStatsOverviewSnapshots_\(\)/);

console.log('Student-stats snapshot invalidation tests passed');
