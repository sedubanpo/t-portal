const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function extract(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert(start >= 0);
  return source.slice(start, source.indexOf('\n  function ', start + 4));
}
const context = {studentMetaMap: new Map(), escapeHtml_: value => String(value).replace(/</g, '&lt;')};
vm.createContext(context);
for (const name of ['getTimetableAttendance','getTimetableStudentMeta', 'getTimetableStudentMetaLabel', 'getTimetableDaySummary', 'renderTimetableDaySummary']) vm.runInContext(extract(name), context);
const rows = [
  {status:'출석', studentId:'a', student:'동명', school:'학교고', grade:'2'},
  {status:'출석', studentId:'a', student:'동명', school:'학교고', grade:'2'},
  {status:'출석', studentId:'b', student:'동명', school:'학교중학교', grade:'3'},
  {status:'출석', studentId:'c', student:'학생', school:'학교초등학교', grade:'6'},
  {status:'출석', studentId:'d', student:'졸업생', school:'재수', grade:''},
  {status:'출석', studentId:'e', student:'미입력', school:'', grade:''}
];
const result = context.getTimetableDaySummary(rows);
assert.equal(result.count, 5, 'multiple lessons count once; same names with different IDs stay separate');
assert.equal(result.levels.length, 5);
assert.equal(new Map(result.levels).get('고등'), 1);
assert.equal(new Map(result.grades).get('초등 6학년'), 1);
assert.match(context.getTimetableStudentMetaLabel('미입력', {}), /학교 미입력 · 학년 미입력/);
assert.equal(context.getTimetableDaySummary([]).count, 0);
assert.equal(context.renderTimetableDaySummary([]), '');
assert(!context.renderTimetableDaySummary([{status:'출석',student:'학생',school:'<학교>',grade:'2'}]).includes('<학교>'));
assert.equal(context.getTimetableDaySummary([{status:'출석',student:'학생',school:'학교고',grade:'1'},{status:'출석',student:'학생',school:'학교고',grade:'1'}]).count, 1);
console.log('PASS weekly student deduplication, school levels, missing metadata and escaping');
const attendanceRows=[
 {studentId:'a',student:'출석학생',status:'출석',school:'검증고',grade:'2'},
 {studentId:'b',student:'결석학생',status:'결석예고',school:'검증중',grade:'3'},
 {studentId:'c',student:'취소학생',status:'당일취소',school:'검증초',grade:'6'},
 {studentId:'d',student:'미확인학생',status:'',school:'검증고',grade:'1'},
 {studentId:'e',student:'대체학생',status:'결석예고 · 실제 대체수업',school:'검증고',grade:'3'},
 {studentId:'a',student:'출석학생',status:'당일취소',school:'검증고',grade:'2'}
];
const attended=context.getTimetableDaySummary(attendanceRows);
assert.equal(attended.count,2);assert.equal(attended.schools.length,1);assert.equal(attended.grades.length,2);
for(const status of ['결석예고','당일취소','당취','결석','취소','미확인',''])assert.equal(context.getTimetableAttendance({status}).participates,false);
for(const status of ['출석','지각','조퇴','보강','보충','결석예고 · 실제 대체수업'])assert.equal(context.getTimetableAttendance({status}).participates,true);
assert.match(context.renderTimetableDaySummary( attendanceRows.filter(r=>r.studentId==='b')),/참여 0명/);
console.log('PASS: attendance-only daily statistics, mixed student statuses, replacement lessons and unknown status');
