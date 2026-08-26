import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(source, /const APP_VERSION = 'v516'/);
assert.match(source, /function applyHomeroomBootstrapResult_\(res\)/);
assert.match(source, /if \(homeroomBootstrapLoaded\) \{[\s\S]*?cached: true/,
  'empty homeroom assignments must be treated as a valid loaded result');
assert.match(source, /homeroomBootstrapCallbacks\.push\(callback\);[\s\S]*?if \(homeroomBootstrapPending\) return/,
  'concurrent homeroom opens must share one bootstrap request');
assert.match(source, /runLoginBootstrapRequest_\(\{[\s\S]*?includeHomeroom: true/,
  'homeroom fallback must invoke the real portal API');
const ensureBlock = source.slice(
  source.indexOf('function ensureHomeroomBootstrapData'),
  source.indexOf('function fetchAllDataForSmartFill')
);
assert.doesNotMatch(ensureBlock, /google\.script\.run\.withSuccessHandler/,
  'homeroom bootstrap must not use the broken uninvoked Apps Script runner chain');
assert.match(ensureBlock, /담임 배정 정보 조회 시간이 초과되었습니다\.[\s\S]*?16000/,
  'homeroom bootstrap must have a bounded loading state');
assert.match(source, /const overallTimeout = setTimeout\(function\(\) \{ finishOpen\(true\); \}, 20000\)/,
  'the modal open journey must never leave the global loader indefinitely');
assert.match(source, /homeroomBootstrapLoaded = Object\.prototype\.hasOwnProperty\.call\(r, 'slmsTeacherMap'\)/,
  'login responses with an empty assignment list must still mark bootstrap complete');
assert.match(source, /if \(opts\.includeHomeroom !== false\) \{[\s\S]*?applyHomeroomBootstrapResult_\(res\)/,
  'background login bootstrap must refresh homeroom data');
assert.match(source, /onclick="refreshHomeroomData\(\)"/,
  'the visible refresh button must perform a real data refresh');
assert.match(source, /function refreshHomeroomData\(\) \{[\s\S]*?homeroomBootstrapLoaded = false;[\s\S]*?openHomeroomModal\(\)/,
  'manual recovery must invalidate the bootstrap cache and retry the open journey');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function: ${name}`);
}

const runtime = {
  homeroomBootstrapLoaded: false,
  homeroomBootstrapPending: false,
  homeroomBootstrapCallbacks: [],
  slmsTeacherMap: {},
  homeroomStudentsData: [],
  currentUser: { phone: '01000000000', name: '신규강사', teacherId: '' },
  isAdminMode: false,
  teacherList: [],
  applyStudentAliasBootstrap() {},
  mergeStudentMetaList() {},
  normalizeTeacherName(value) { return String(value || '').replace(/\s+/g, ''); },
  isStudentAliasFixtureMode() { return false; },
  document: { getElementById() { return null; } },
  renderHomeroomDashboard() {},
  clearTimeout() {},
  setTimeout(fn) { runtime.timeoutCallback = fn; return 1; },
  requestCount: 0,
  runLoginBootstrapRequest_(payload, success) {
    runtime.requestCount += 1;
    runtime.successHandler = success;
  }
};
vm.createContext(runtime);
vm.runInContext(`${extractFunction('applyHomeroomBootstrapResult_')}\n${extractFunction('ensureHomeroomBootstrapData')}`, runtime);

const results = [];
runtime.ensureHomeroomBootstrapData(result => results.push(result));
runtime.ensureHomeroomBootstrapData(result => results.push(result));
assert.equal(runtime.requestCount, 1, 'pending requests should coalesce');
runtime.successHandler({ success: true, slmsTeacherMap: {}, homeroomStudents: [], studentList: [] });
assert.equal(results.length, 2, 'all pending callers should finish');
assert.ok(results.every(result => result.success === true));
runtime.ensureHomeroomBootstrapData(result => results.push(result));
assert.equal(runtime.requestCount, 1, 'a valid empty result should remain cached');
assert.equal(results.at(-1).cached, true);

runtime.homeroomBootstrapLoaded = false;
runtime.homeroomBootstrapPending = false;
runtime.homeroomBootstrapCallbacks = [];
runtime.runLoginBootstrapRequest_ = () => { runtime.requestCount += 1; };
let timeoutResult = null;
runtime.ensureHomeroomBootstrapData(result => { timeoutResult = result; });
runtime.timeoutCallback();
assert.equal(timeoutResult.success, false);
assert.equal(timeoutResult.timeout, true, 'timeout must release the caller');
assert.equal(runtime.homeroomBootstrapPending, false);

console.log('PASS homeroom loading repair safeguards');
