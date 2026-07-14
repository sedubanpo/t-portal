#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../class-log-overview-direct.js', import.meta.url), 'utf8'), context);
const engine = context.window.PortalClassLogOverviewEngine;
assert.ok(engine);

const attendance = [
  { class_date: '2026-07-03', category: '수학-개별(안준성)-2h', student_name: '학생A', teacher_name: '안준성', status: '출석', start_time_text: '오후 5:00', end_time_text: '오후 7:00', hours: 2 },
  { class_date: '2026-07-03', category: '수학-개별(안준성)-2h', student_name: '학생B', teacher_name: '안준성', status: '출석', start_time_text: '오후 7:00', end_time_text: '오후 9:00', hours: 2 },
  { class_date: '2026-07-03', category: '영어-개별(김다인)-1h', student_name: '학생C', teacher_name: '김다인 T', status: '당일취소', start_time_text: '오후 4:00', end_time_text: '오후 5:00', hours: 1 }
];
const logs = [
  { class_date: '2026-07-03', teacher_name: '안준성', student_name: '학생A', status: '제출 완료', reason: '', start_time_text: '17:00', end_time_text: '19:00', class_name: '수학-개별(안준성)-2h' },
  { class_date: '2026-07-03', teacher_name: '안준성', student_name: '학생B', status: '미제출', reason: '추후 작성', start_time_text: '19:00', end_time_text: '21:00', class_name: '수학-개별(안준성)-2h' }
];
const signatures = [{ class_date: '2026-07-03', teacher_name: '안준성', signed: true, signed_at: '2026-07-03T14:00:00Z', signed_by: '안준성' }];
const full = engine.build(attendance, logs, signatures, 2026, 7, { compact: false });
const day = full.dayMap['2026-07-03'];
const teacher = day.teachers.find(row => row.teacher === '안준성');
assert.equal(teacher.taughtCount, 2);
assert.equal(teacher.taughtHours, 4);
assert.equal(teacher.submittedCount, 1);
assert.equal(teacher.missingCount, 1);
assert.equal(teacher.status, '부분 미제출');
assert.equal(teacher.hoursAgreementSigned, true);
assert.equal(day.partialTeacherCount, 1);
assert.equal(day.taughtTeacherCount, 1);
assert.equal(day.teachers.some(row => row.teacher === '김다인'), false);

const compact = engine.build(attendance, logs, signatures, 2026, 7, { compact: true });
assert.equal(compact.compact, true);
assert.equal(Object.hasOwn(compact.dayMap['2026-07-03'].teachers[0], 'taughtLessons'), false);
assert.equal(Object.hasOwn(compact.dayMap['2026-07-03'].teachers[0], 'logEntries'), false);
console.log(JSON.stringify({ ok: true, taughtCount: teacher.taughtCount, status: teacher.status, compact: compact.compact }, null, 2));
