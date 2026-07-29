import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없습니다.`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} 함수 범위를 찾지 못했습니다.`);
}

const canonicalMeta = new Map([
  ['최시영b', { school: '동작고', grade: '2' }]
]);
const context = {
  Map,
  Set,
  Array,
  Object,
  String,
  Number,
  Boolean,
  RegExp,
  Date,
  console,
  studentMetaMap: canonicalMeta,
  cleanStudentName(raw) {
    let value = String(raw || '').trim().replace(/^\/+|\/+$/g, '').replace(/^1:1\s*/, '');
    if (value.includes('/')) value = value.split('/')[0];
    return value.trim();
  },
  getCalculatedHours(item) {
    return Number(item?.hours || 0);
  },
  getStudentSlmsTimestampMs_(value) {
    const parsed = new Date(value || '').getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  },
  getStudentMetaForItem(item) {
    return item?.canonicalMeta || {};
  },
  normalizeStatsMetaValue(primary, fallback) {
    const primaryText = String(primary || '').trim();
    if (primaryText && !['-', '확인필요', '정보없음'].includes(primaryText)) return primaryText;
    const fallbackText = String(fallback || '').trim();
    if (fallbackText && !['-', '확인필요', '정보없음'].includes(fallbackText)) return fallbackText;
    return '';
  },
  resolveCanonicalStudentId(value) {
    return String(value || '').trim();
  }
};
vm.createContext(context);
[
  'isValidHoursStudentMetaValue',
  'sanitizeHoursStudentSchool',
  'getHoursStudentName',
  'getHoursStudentSchoolLevel',
  'getHoursStudentGradeNumber',
  'getHoursStudentRegistrationMs',
  'isHoursRecentStudent',
  'isHoursStudentParticipation',
  'buildHoursMonthlyStudentRows'
].forEach(name => vm.runInContext(extractFunction(name), context));

const rows = context.buildHoursMonthlyStudentRows([
  { student: '정승원', school: '서초고', grade: '2', day: 3, hours: 2, status: '출석' },
  { student: '정승원', school: '정승원', grade: '확인필요', day: 8, hours: 3, status: '출석' },
  { student: '정준우', school: '반포고', grade: '3', day: 4, hours: 2, status: '출석' },
  { student: '정준우', school: '정준우', grade: '확인필요', day: 10, hours: 2, status: '당일취소' },
  { student: '최시영b', school: '최시영b', grade: '확인필요', canonicalMeta: { school: '동작고', grade: '2' }, day: 9, hours: 2, status: '출석' },
  { student: '강중학생', school: '서일중', grade: '1', day: 7, hours: 2, status: '출석' },
  { student: '김초학생', school: '반포초', grade: '5', day: 6, hours: 1, status: '출석' },
  { student: '학교명축약', school: '신반포', grade: '3', day: 11, hours: 2, status: '출석' },
  { student: '가나다', school: '', grade: '', day: 5, hours: 1, status: '출석' }
]);

assert.equal(rows.filter(row => row.name === '정승원').length, 1, '정승원은 한 번만 표시되어야 합니다.');
assert.equal(rows.find(row => row.name === '정승원').school, '서초고', '학생명과 같은 잘못된 학교 값은 정상 학교를 덮으면 안 됩니다.');
assert.deepEqual(Array.from(rows.find(row => row.name === '정승원').days), [3, 8], '중복 행의 실제 수업일은 합쳐야 합니다.');
assert.equal(rows.filter(row => row.name === '정준우').length, 1, '정준우는 한 번만 표시되어야 합니다.');
assert.deepEqual(Array.from(rows.find(row => row.name === '정준우').days), [4], '당일취소는 참여일 강조에서 제외해야 합니다.');
assert.equal(rows.find(row => row.name === '최시영b').school, '동작고', 'canonical 메타데이터를 원본의 잘못된 학교보다 우선해야 합니다.');
assert.deepEqual(Array.from(new Set(rows.map(row => row.group))), ['고등', '중등', '초등', '기타'], '학교급 그룹 순서가 고정되어야 합니다.');

const highSchoolNames = rows.filter(row => row.group === '고등').map(row => row.name);
assert.deepEqual(highSchoolNames, ['정준우', '정승원', '최시영b'], '같은 학교급에서는 학년 내림차순 후 이름 가나다순이어야 합니다.');
const middleSchoolNames = rows.filter(row => row.group === '중등').map(row => row.name);
assert.deepEqual(middleSchoolNames, ['학교명축약', '강중학생'], '중등 그룹도 3학년에서 1학년 순으로 정렬해야 합니다.');
assert.equal(context.getHoursStudentGradeNumber('3학년'), 3, '표시 형식의 학년 숫자를 읽어야 합니다.');
assert.equal(context.getHoursStudentGradeNumber('학년 확인'), 0, '미확인 학년은 정렬 마지막 값이어야 합니다.');
const now = Date.now();
context.hoursStudentRegistrationCache = new Map([['신규학생', now - 3 * 24 * 60 * 60 * 1000]]);
assert.equal(context.isHoursRecentStudent({ student: '신규학생' }), true, '등록 후 14일 이내 학생만 신규생이어야 합니다.');
context.hoursStudentRegistrationCache.set('기존학생', now - 30 * 24 * 60 * 60 * 1000);
assert.equal(context.isHoursRecentStudent({ student: '기존학생' }), false, '등록 후 14일이 지난 학생은 신규생이 아니어야 합니다.');

assert.match(source, /studentId:\s*item\.studentId \|\| item\.student_id/, '시수 정규화 과정에서 studentId를 보존해야 합니다.');
assert.match(source, /canonicalStudentId:\s*resolveCanonicalStudentId/, '파싱 과정에서 canonicalStudentId를 보존해야 합니다.');
assert.match(source, /class="hours-student-row \$\{gradeClass\}/, '학생 목록은 학년별 셀 배경 클래스를 가진 선택 버튼이어야 합니다.');
assert.match(source, /hours-student-line/, '이름·학교·학년은 한 줄 레이아웃으로 표시해야 합니다.');
assert.doesNotMatch(source, /hours-student-grade \$\{gradeClass\}/, '학년 색상은 배지가 아니라 학생 셀에 적용해야 합니다.');
assert.match(source, /new-student/, '최근 14일 등록 학생은 금장 신규생 상태로 표시해야 합니다.');
assert.match(source, /student-focused/, '선택 학생의 수업일 강조 클래스가 있어야 합니다.');

console.log('PASS hours monthly student grouping, deduplication, metadata preference, and focus-day rules');
