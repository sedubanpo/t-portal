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
  getSupabaseConfig_() { return { success: true }; },
  supabaseRequest_(config, pathValue, method, body, options) {
    requests.push({ config, path: pathValue, method, body, options });
    return [];
  }
};
vm.createContext(context);
vm.runInContext([
  extractFunction('getTeacherHoursMonthKeysFromUploadSource_'),
  extractFunction('invalidateTeacherHoursDashboardSummaryMonths_')
].join('\n'), context, { filename: 'teacher-hours-summary-invalidation.js' });

const monthKeys = context.getTeacherHoursMonthKeysFromUploadSource_({
  sourceMonth: '2026-07',
  sourceDates: ['2026-07-01', '2026-08-02', 'invalid', '2026-08-12']
});
assert.deepEqual([...monthKeys], ['2026-07', '2026-08']);

const invalidated = context.invalidateTeacherHoursDashboardSummaryMonths_([
  '2026-07',
  '2026-07',
  '2026-08',
  'invalid'
]);
assert.equal(invalidated, 2);
assert.equal(requests.length, 2);
assert.deepEqual(requests.map(item => item.path), [
  'teacher_hours_monthly_summaries?month_key=eq.2026-07',
  'teacher_hours_monthly_summaries?month_key=eq.2026-08'
]);
assert.ok(requests.every(item => item.method === 'delete'));
assert.ok(requests.every(item => item.options?.Prefer === 'return=minimal'));

requests.length = 0;
assert.equal(context.invalidateTeacherHoursDashboardSummaryMonths_([]), 0);
assert.equal(requests.length, 0);

console.log('Teacher-hours summary invalidation tests passed');
