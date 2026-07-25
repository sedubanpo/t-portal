#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const indexText = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = indexText.indexOf('  function makeSupabaseHoursReviewComparable(row)');
const end = indexText.indexOf('  function submitSupabaseUpload()', start);
assert.ok(start > 0 && end > start, '시수표 대조 검토 함수 블록을 찾을 수 없습니다.');

const context = {
  normalizeTeacherName(value) {
    return String(value || '').normalize('NFKC').replace(/\s*T$/i, '').replace(/\s+/g, '');
  },
  parseFlexibleTimeToMinutes(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  },
  getDisplayTimeRange(row) {
    return [row.start, row.end].filter(Boolean).join('~');
  },
  console
};
vm.createContext(context);
vm.runInContext(indexText.slice(start, end), context, { filename: 'supabase-hours-review.js' });

function makeRow(category) {
  return context.makeSupabaseHoursReviewComparable({
    line: 2,
    classDate: '2026-07-24',
    teacherName: '배유진',
    studentName: '장민우',
    category,
    status: '출석',
    start: '10:00',
    end: '13:00',
    note: '',
    hours: 3
  });
}

const reportedCase = context.compareSupabaseHoursReviewRows(
  [makeRow('국어-개별(배유진)-3h')],
  [makeRow('국어-1:1-배유진')]
);
assert.equal(reportedCase.summary.matchedRows, 1);
assert.equal(reportedCase.summary.lessonTypeMismatch, 1);
assert.equal(reportedCase.summary.critical, 1);
assert.equal(reportedCase.issues[0].type, 'lesson_type_mismatch');
assert.match(reportedCase.issues[0].detail, /시수표 1:1 \/ Access 개별정규/);

const reverseCase = context.compareSupabaseHoursReviewRows(
  [makeRow('국어-1대1(배유진)-3h')],
  [makeRow('국어-개별정규-배유진')]
);
assert.equal(reverseCase.summary.lessonTypeMismatch, 1);

const regularEquivalent = context.compareSupabaseHoursReviewRows(
  [makeRow('국어-개별(배유진)-3h')],
  [makeRow('국어-개별정규-배유진')]
);
assert.equal(regularEquivalent.summary.lessonTypeMismatch, 0);
assert.equal(regularEquivalent.summary.critical, 0);

const oneOnOneEquivalent = context.compareSupabaseHoursReviewRows(
  [makeRow('국어-1:1(배유진)-3h')],
  [makeRow('국어-1대1-배유진')]
);
assert.equal(oneOnOneEquivalent.summary.lessonTypeMismatch, 0);
assert.equal(oneOnOneEquivalent.summary.critical, 0);

console.log(JSON.stringify({
  ok: true,
  reportedCase: reportedCase.issues[0].detail,
  reverseMismatchDetected: reverseCase.summary.lessonTypeMismatch,
  equivalentRegularAccepted: regularEquivalent.summary.lessonTypeMismatch === 0,
  equivalentOneOnOneAccepted: oneOnOneEquivalent.summary.lessonTypeMismatch === 0
}, null, 2));
