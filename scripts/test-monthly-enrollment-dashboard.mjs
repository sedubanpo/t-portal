import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} 함수가 있어야 합니다.`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = bodyStart; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

const helpers = [
  'getMonthlyEnrollmentIdentity_',
  'isMonthlyEnrollmentActiveStudent_',
  'getMonthlyEnrollmentTeachers_',
  'buildMonthlyEnrollmentDashboardModel'
].map(extractFunction).join('\n');

const factory = new Function(`
  const normalizeStudentIdValue = value => String(value || '').trim();
  const resolveCanonicalStudentId = value => String(value || '').trim();
  const cleanStudentName = value => String(value || '').trim();
  const normalizeTeacherName = value => String(value || '').replace(/\\s*T$/i, '').trim();
  const getCalculatedHours = item => Number(item && item.hours || 0);
  const getStatsMonthKey = (year, month0) => String(year) + '-' + String(month0 + 1).padStart(2, '0');
  ${helpers}
  return { isActive: isMonthlyEnrollmentActiveStudent_, build: buildMonthlyEnrollmentDashboardModel };
`);
const { isActive, build } = factory();

const lesson = (teacher, hours = 2, status = '출석') => ({ teacher, hours, status });
const student = (id, name, teacher, lessons = [lesson(teacher)]) => ({
  statsSchemaVersion: 'v291', key: `id:${id}`, canonicalStudentId: id, student: name,
  school: '반포고', grade: '3', totalCount: lessons.length, attendedCount: lessons.filter(row => row.status === '출석' && row.hours > 0).length,
  teachers: { [teacher]: 1 }, rows: lessons
});

assert.equal(isActive(student('a', '계속생', '김강사')), true);
assert.equal(isActive(student('x', '결석생', '김강사', [lesson('김강사', 2, '결석예고')])), false);
assert.equal(isActive(student('y', '영시수', '김강사', [lesson('김강사', 0, '출석')])), false);

const entries = [];
for (let month = 8; month <= 12; month++) entries.push({ monthKey: `2025-${String(month).padStart(2, '0')}`, loaded: true, rows: [] });
for (let month = 1; month <= 6; month++) entries.push({ monthKey: `2026-${String(month).padStart(2, '0')}`, loaded: true, rows: [] });
entries.push({ monthKey: '2026-07', loaded: true, rows: [student('a', '계속생', '김강사'), student('c', '해제생', '이강사')] });
entries.push({ monthKey: '2026-08', loaded: true, rows: [student('a', '계속생', '김강사'), student('b', '신규생', '김강사')] });

const model = build(entries, '2026-08');
assert.equal(model.currentCount, 2);
assert.equal(model.previousCount, 2);
assert.equal(model.delta, 0);
assert.deepEqual(model.newStudents.map(row => row.student), ['신규생']);
assert.deepEqual(model.inactiveStudents.map(row => row.student), ['해제생']);
assert.equal(model.newReliable, true);
assert.equal(model.trend.length, 12);
assert.deepEqual(model.teacherStats.find(row => row.teacher === '김강사'), { teacher: '김강사', active: 2, continuing: 1, newCount: 1, inactive: 0 });
assert.deepEqual(model.teacherStats.find(row => row.teacher === '이강사'), { teacher: '이강사', active: 0, continuing: 0, newCount: 0, inactive: 1 });

assert.match(source, /openAdminStudentManagement\('monthly'\)/);
assert.match(source, /id="student-monthly-stats-modal"/);
assert.match(source, /const workers = Math\.min\(3, targets\.length\)/);
assert.match(source, /진행 중인 달은 아직 예정 수업이 남아 있어 활성 해제 수치가 잠정치/);
assert.match(source, /const APP_VERSION = 'v[0-9]+'/);

console.log(JSON.stringify({ ok: true, active: model.currentCount, newlyActive: model.newStudents.length, inactive: model.inactiveStudents.length, teachers: model.teacherStats.length }, null, 2));
