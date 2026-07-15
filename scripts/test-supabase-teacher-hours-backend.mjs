#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backendMatch = indexText.match(/\/\/ PORTAL_SUPABASE_BACKEND_START[\s\S]*?\/\/ PORTAL_SUPABASE_BACKEND_END/);
assert.ok(backendMatch, 'Supabase backend block must exist');

function makeToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature`;
}

const validClaims = {
  sub: 'firebase-user-1',
  aud: 'fir-lms-prod',
  iss: 'https://securetoken.google.com/fir-lms-prod',
  role: 'authenticated'
};
let token = makeToken(validClaims);
let runtimeConfig = {
  enabled: true,
  url: 'https://example.supabase.co',
  publishableKey: 'sb_publishable_test',
  firebaseProjectId: 'fir-lms-prod',
  canaryFirebaseUids: ['firebase-user-1'],
  pastMonthsDirect: true,
  currentMonthDirectFirebaseUids: ['firebase-user-1'],
  directActions: ['getStudentStatsMonthlyOverview', 'getLoginBootstrap'],
  shadowActions: ['getTeacherHoursDashboardData', 'getStudentStatsMonthlyOverview', 'getLoginBootstrap'],
  actionFirebaseUids: {
    getStudentStatsMonthlyOverview: ['firebase-user-1'],
    getLoginBootstrap: ['firebase-user-1']
  },
  timeoutMs: 7000,
  maxCurrentMonthAgeMs: 300000,
  maxStudentStatsCurrentMonthAgeMs: 300000,
  maxLoginBootstrapAgeMs: 300000
};
const routeChanges = [];
const routeEvents = [];
const fetchCalls = [];
let backendHandler = null;
let summaryRow = {
  summary_key: 'latest|test',
  month_key: '2026-06',
  teacher_key: '김인중',
  teacher_name: '김인중',
  source_cache_version: '1',
  data_source: 'supabase',
  fallback_from: '',
  fallback_reason: '',
  entry_count: 3,
  row_count: 2,
  state: { rows: [{ teacher: '김인중', hours: 2 }], stats: { totalHours: 2 } },
  refreshed_at: '2026-07-13T00:00:00.000Z'
};
const attendanceRows = [
  {
    class_date: '2026-06-03',
    category: '수학-개별(테스트강사)-2h',
    subject: '수학',
    lesson_type: '개별',
    student_id: 'student-1',
    student_name: '테스트학생',
    student_school: '테스트고',
    student_grade: '1',
    teacher_name: '테스트강사',
    status: '출석',
    start_time_text: '오후 5:00',
    end_time_text: '오후 7:00',
    hours: 2,
    raw_student: '테스트학생'
  }
];
const loginBootstrapSnapshot = {
  snapshot_key: 'v1:firebase-user-1:C1N1S1L1H1A1F0:test',
  firebase_uid: 'firebase-user-1',
  request_key: 'C1N1S1L1H1A1F0',
  schema_version: 'v1',
  source_cache_version: 'test',
  response_json: {
    success: true,
    common: [{ label: '성적', value: 'https://example.test' }],
    notices: [{ type: '공지', content: '테스트' }],
    studentList: [{ name: '테스트학생', school: '테스트고', grade: '1' }],
    slmsTeacherMap: {},
    homeroomStudents: []
  },
  student_count: 1,
  notice_count: 1,
  refreshed_at: new Date().toISOString()
};

const context = {
  window: { __TPORTAL_SUPABASE_PUBLIC_CONFIG__: runtimeConfig },
  TEACHER_PORTAL_FIREBASE_CONFIG: { projectId: 'fir-lms-prod' },
  STUDENT_STATS_SCHEMA_VERSION: 'v291',
  currentUser: { uid: 'firebase-user-1', isAdmin: true },
  portalApi: {
    registerBackend(route, handler) {
      assert.equal(route, 'supabase');
      backendHandler = handler;
    },
    setRoute(action, route) { routeChanges.push({ action, route }); },
    clearRoute(action) { routeChanges.push({ action, route: 'gas' }); }
  },
  recordPortalApiRouteEvent(action, detail) { routeEvents.push({ action, ...detail }); },
  getTeacherPortalFirebaseIdToken_() { return Promise.resolve(token); },
  normalizeTeacherName(value) { return String(value || '').normalize('NFKC').replace(/\s*T$/i, '').replace(/\s+/g, ''); },
  buildStudentStatsDataFromRows(rows, monthKey) {
    assert.equal(monthKey, '2026-06');
    assert.equal(rows.length, attendanceRows.length);
    return [{ student: '테스트학생', totalCount: 1, statsSchemaVersion: 'v291' }];
  },
  fetch(url, options) {
    fetchCalls.push({ url, options });
    const rows = String(url).includes('attendance_logs')
      ? attendanceRows
      : String(url).includes('portal_login_bootstrap_snapshots')
        ? [loginBootstrapSnapshot]
        : [summaryRow];
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(rows))
    });
  },
  AbortController,
  setTimeout,
  clearTimeout,
  atob
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(backendMatch[0], context, { filename: 'portal-supabase-backend.js' });

assert.equal(typeof backendHandler, 'function', 'Supabase backend must register itself');

const canary = await context.preparePortalSupabaseCanary_();
assert.equal(canary.enabled, true);
assert.ok(routeChanges.some(item => item.action === 'getTeacherHoursDashboardData' && item.route === 'canary'));
assert.ok(routeChanges.some(item => item.action === 'getStudentStatsMonthlyOverview' && item.route === 'canary'));
assert.ok(routeChanges.some(item => item.action === 'getLoginBootstrap' && item.route === 'canary'));

const result = await backendHandler('getTeacherHoursDashboardData', {
  year: 2026,
  month: 6,
  teacherName: '김인중'
}, { shadow: true });
assert.equal(result.success, true);
assert.equal(result.state.stats.totalHours, 2);
assert.equal(result.teacherKey, '김인중');
assert.equal(fetchCalls.length, 1);
assert.match(fetchCalls[0].url, /teacher_hours_monthly_summaries/);
assert.match(fetchCalls[0].url, /month_key=eq\.2026-06/);
assert.equal(fetchCalls[0].options.headers.Authorization, `Bearer ${token}`);
assert.equal(fetchCalls[0].options.headers.apikey, 'sb_publishable_test');

const studentStatsResult = await backendHandler('getStudentStatsMonthlyOverview', {
  year: 2026,
  month: 6,
  forceRefresh: false
}, { shadow: true });
assert.equal(studentStatsResult.success, true);
assert.equal(studentStatsResult.monthKey, '2026-06');
assert.equal(studentStatsResult.entryCount, 1);
assert.equal(studentStatsResult.rows[0].statsSchemaVersion, 'v291');
assert.match(fetchCalls[1].url, /attendance_logs/);
assert.match(fetchCalls[1].url, /class_date=gte\.2026-06-01/);
assert.match(fetchCalls[1].url, /class_date=lt\.2026-07-01/);

token = makeToken({ ...validClaims, role: undefined });
routeChanges.length = 0;
const rejectedCanary = await context.preparePortalSupabaseCanary_();
assert.equal(rejectedCanary.enabled, false);
assert.ok(routeChanges.every(item => item.route === 'gas'));
assert.ok(routeEvents.some(item => item.action === 'supabase-canary' && item.status === 'rejected'));

token = makeToken({ ...validClaims, sub: 'firebase-user-2' });
context.currentUser.uid = 'firebase-user-2';
routeChanges.length = 0;
const wrongCanaryUser = await context.preparePortalSupabaseCanary_();
assert.equal(wrongCanaryUser.enabled, false);
assert.ok(routeChanges.every(item => item.route === 'gas'));

token = makeToken(validClaims);
context.currentUser.uid = 'firebase-user-1';
await assert.rejects(
  backendHandler('getTeacherHoursDashboardData', {
    year: 2026,
    month: 6,
    teacherName: '다른강사',
    forceRefresh: false
  }, { shadow: true }),
  error => error && error.code === 'SUPABASE_SCOPE_MISMATCH'
);

await assert.rejects(
  backendHandler('getTeacherHoursDashboardData', {
    year: 2026,
    month: 6,
    teacherName: '김인중',
    forceRefresh: true
  }, {}),
  error => error && error.code === 'SUPABASE_FORCE_REFRESH_UNSUPPORTED'
);

const now = new Date();
summaryRow = {
  ...summaryRow,
  month_key: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  refreshed_at: new Date(Date.now() - 301000).toISOString()
};
await assert.rejects(
  backendHandler('getTeacherHoursDashboardData', {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    teacherName: '김인중'
  }, {}),
  error => error && error.code === 'SUPABASE_SUMMARY_STALE'
);

summaryRow = { ...summaryRow, refreshed_at: new Date().toISOString() };
const freshCurrentMonth = await backendHandler('getTeacherHoursDashboardData', {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  teacherName: '김인중'
}, {});
assert.equal(freshCurrentMonth.success, true, 'fresh current-month summary must be accepted');

await assert.rejects(
  backendHandler('getStudentStatsMonthlyOverview', {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    forceRefresh: true
  }, {}),
  error => error && error.code === 'SUPABASE_FORCE_REFRESH_UNSUPPORTED'
);

const loginBootstrapResult = await backendHandler('getLoginBootstrap', {
  includeCommon: true,
  includeNotices: true,
  includeStudentList: true,
  includeSlms: true,
  includeHomeroom: true,
  includeStudentAliases: true
}, {});
assert.equal(loginBootstrapResult.success, true);
assert.equal(loginBootstrapResult.studentList.length, 1);
assert.match(fetchCalls.at(-1).url, /portal_login_bootstrap_snapshots/);

loginBootstrapSnapshot.refreshed_at = new Date(Date.now() - 301000).toISOString();
await assert.rejects(
  backendHandler('getLoginBootstrap', {
    includeCommon: true,
    includeNotices: true,
    includeStudentList: true,
    includeSlms: true,
    includeHomeroom: true,
    includeStudentAliases: true
  }, {}),
  error => error && error.code === 'SUPABASE_SUMMARY_STALE'
);
loginBootstrapSnapshot.refreshed_at = new Date().toISOString();

runtimeConfig = {
  ...runtimeConfig,
  canaryFirebaseUids: ['firebase-user-1', 'firebase-user-2']
};
context.window.__TPORTAL_SUPABASE_PUBLIC_CONFIG__ = runtimeConfig;
token = makeToken({ ...validClaims, sub: 'firebase-user-2' });
context.currentUser.uid = 'firebase-user-2';
routeChanges.length = 0;
const restrictedCanary = await context.preparePortalSupabaseCanary_();
assert.equal(restrictedCanary.enabled, true);
assert.deepEqual(Array.from(restrictedCanary.actions), ['getTeacherHoursDashboardData']);
assert.ok(!routeChanges.some(item => item.action === 'getStudentStatsMonthlyOverview' && item.route === 'shadow'));
await assert.rejects(
  backendHandler('getStudentStatsMonthlyOverview', { year: 2026, month: 6 }, { shadow: true }),
  error => error && error.code === 'SUPABASE_ACTION_NOT_ALLOWED'
);

runtimeConfig = { ...runtimeConfig, enabled: false };
context.window.__TPORTAL_SUPABASE_PUBLIC_CONFIG__ = runtimeConfig;
token = makeToken(validClaims);
context.currentUser.uid = 'firebase-user-1';
await assert.rejects(
  backendHandler('getTeacherHoursDashboardData', { year: 2026, month: 6, teacherName: '김인중' }, {}),
  error => error && error.code === 'SUPABASE_CANARY_DISABLED'
);

console.log('Supabase teacher-hours backend tests passed');
