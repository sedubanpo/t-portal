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
for (const name of ['getTimetableStudentMeta', 'getTimetableStudentMetaLabel', 'getTimetableDaySummary', 'renderTimetableDaySummary']) vm.runInContext(extract(name), context);
const rows = [
  {studentId:'a', student:'동명', school:'학교고', grade:'2'},
  {studentId:'a', student:'동명', school:'학교고', grade:'2'},
  {studentId:'b', student:'동명', school:'학교중학교', grade:'3'},
  {studentId:'c', student:'학생', school:'학교초등학교', grade:'6'},
  {studentId:'d', student:'졸업생', school:'재수', grade:''},
  {studentId:'e', student:'미입력', school:'', grade:''}
];
const result = context.getTimetableDaySummary(rows);
assert.equal(result.count, 5, 'multiple lessons count once; same names with different IDs stay separate');
assert.equal(result.levels.length, 5);
assert.equal(new Map(result.levels).get('고등'), 1);
assert.equal(new Map(result.grades).get('초등 6학년'), 1);
assert.match(context.getTimetableStudentMetaLabel('미입력', {}), /학교 미입력 · 학년 미입력/);
assert.equal(context.getTimetableDaySummary([]).count, 0);
assert.equal(context.renderTimetableDaySummary([]), '');
assert(!context.renderTimetableDaySummary([{student:'학생',school:'<학교>',grade:'2'}]).includes('<학교>'));
assert.equal(context.getTimetableDaySummary([{student:'학생',school:'학교고',grade:'1'},{student:'학생',school:'학교고',grade:'1'}]).count, 1);
console.log('PASS weekly student deduplication, school levels, missing metadata and escaping');
