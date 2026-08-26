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
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} 함수 범위를 찾지 못했습니다.`);
}

const storage = new Map();
const context = {
  Date,
  Number,
  String,
  Object,
  window: {
    localStorage: {
      setItem(key, value) { storage.set(key, String(value)); },
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      removeItem(key) { storage.delete(key); }
    },
    appState: { teacherHoursAuxCache: {} }
  },
  currentUser: { name: '배유진' },
  viewTeacherName: '배유진',
  signedDateMap: {},
  HOURS_AGREEMENT_CONFIRMATION_GUARD_MS: 10 * 60 * 1000,
  normalizeTeacherName(value) { return String(value || '').replace(/\s*T$/i, '').replace(/\s+/g, ''); },
  getTeacherDataScopeKey({ year, month0, teacherName }) {
    return `${year}-${String(month0 + 1).padStart(2, '0')}|${String(teacherName).replace(/\s*T$/i, '')}`;
  },
  ensureTeacherHoursAuxCacheState() {
    context.window.appState.teacherHoursAuxCache ||= {};
  },
  currentYear: 2026,
  currentMonth: 6
};
vm.createContext(context);
[
  'getSignedStorageKey',
  'markSignedLocal',
  'unmarkSignedLocal',
  'isSignedLocal',
  'isRecentlyConfirmedSignedLocal',
  'confirmHoursAgreementInCaches',
  'applyHoursSignedDateMapForCurrentMonth'
].forEach(name => vm.runInContext(extractFunction(name), context));

const dateKey = '2026-07-24';
context.confirmHoursAgreementInCaches(dateKey, '배유진', '2026-07-24T12:34:56Z');
assert.equal(context.signedDateMap[dateKey], true, '저장 성공 즉시 화면 상태가 동의 완료여야 합니다.');
assert.equal(context.isRecentlyConfirmedSignedLocal(dateKey), true, '서버 확인 성공 시 전파 보호 시각을 기록해야 합니다.');
const scope = '2026-07|배유진';
assert.equal(context.window.appState.teacherHoursAuxCache[scope].auxiliary.signedDateMap[dateKey], true, '재진입용 보조 캐시도 즉시 갱신해야 합니다.');
assert.equal(context.window.appState.teacherHoursAuxCache[scope].auxiliary.signedDateMeta[dateKey].source, 'confirmed-write-response');

context.applyHoursSignedDateMapForCurrentMonth({ [dateKey]: false });
assert.equal(context.signedDateMap[dateKey], true, '짧은 전파 지연 중 도착한 오래된 미동의 응답이 완료 상태를 되돌리면 안 됩니다.');
assert.equal(context.isSignedLocal(dateKey), true, '전파 보호 중 로컬 완료 증거를 삭제하면 안 됩니다.');

assert.match(source, /function requestTeacherHoursDashboardOnce_/, '동일 시수 조회 요청을 병합해야 합니다.');
assert.match(source, /window\.appState\.rawRowsScope === 'full'/, '이미 로드된 전체 데이터를 강사·월 범위로 승격해야 합니다.');
assert.match(source, /if \(Array\.isArray\(cachedEntries\)\)/, '빈 월도 유효한 캐시 결과로 처리해야 합니다.');
assert.match(source, /const APP_VERSION = 'v515'/);

console.log('PASS teacher-hours instant agreement cache and fast-open safeguards');
