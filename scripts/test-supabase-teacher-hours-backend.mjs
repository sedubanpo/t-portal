#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const liveRpcMigrationText = fs.readFileSync(path.join(root, 'supabase/migrations/202607180002_teacher_hours_live_rpc.sql'), 'utf8');
const backendMatch = indexText.match(/\/\/ PORTAL_SUPABASE_BACKEND_START[\s\S]*?\/\/ PORTAL_SUPABASE_BACKEND_END/);
assert.ok(backendMatch, 'Supabase backend block must exist');
assert.match(liveRpcMigrationText, /security definer/i);
assert.match(liveRpcMigrationText, /private\.portal_can_access_teacher/);
assert.match(liveRpcMigrationText, /source = 'access-daily'/);
assert.match(liveRpcMigrationText, /fallbackRequired/);
assert.match(liveRpcMigrationText, /revoke all on function public\.portal_get_teacher_hours_live\(jsonb\) from public, anon/i);

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
  directWriteActions: ['saveClassLogRows'],
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
const tokenRefreshRequests = [];
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
  },
  {
    class_date: '2025-12-30',
    category: '수학-개별(테스트강사)-2h',
    student_name: '범위밖학생',
    teacher_name: '테스트강사',
    status: '출석',
    hours: 2
  }
];
let liveFallbackRequired = false;
let liveSignatureRows = [{ class_date: '2026-06-03', teacher_name: '테스트강사', signed: true, signed_at: '2026-06-03T12:00:00.000Z' }];
let liveClassLogRows = [];
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
  window: {
    __TPORTAL_SUPABASE_PUBLIC_CONFIG__: runtimeConfig,
    PortalClassLogOverviewEngine: {
      build(attendance, logs, signatures) {
        const dateKey = '2026-06-03';
        const signature = signatures.some(row => row.signed === true);
        const submitted = logs.some(row => row.status !== '미제출');
        return { dayMap: { [dateKey]: { teachers: [{
          teacher: '테스트강사',
          hoursAgreementSource: signature ? 'signature' : '',
          status: submitted ? '제출 완료' : '기록없음'
        }] } } };
      }
    }
  },
  TEACHER_PORTAL_FIREBASE_CONFIG: { projectId: 'fir-lms-prod' },
  STUDENT_STATS_SCHEMA_VERSION: 'v291',
  currentUser: { uid: 'firebase-user-1', isAdmin: true },
  isAdminMode: true,
  portalApi: {
    registerBackend(route, handler) {
      assert.equal(route, 'supabase');
      backendHandler = handler;
    },
    setRoute(action, route) { routeChanges.push({ action, route }); },
    clearRoute(action) { routeChanges.push({ action, route: 'gas' }); }
  },
  getPortalApiActionMeta(action) {
    return String(action || '') === 'saveClassLogRows' ? { kind: 'write' } : { kind: 'read' };
  },
  recordPortalApiRouteEvent(action, detail) { routeEvents.push({ action, ...detail }); },
  getTeacherPortalFirebaseIdToken_(forceRefresh) {
    tokenRefreshRequests.push(forceRefresh === true);
    return Promise.resolve(token);
  },
  normalizeTeacherName(value) { return String(value || '').normalize('NFKC').replace(/\s*T$/i, '').replace(/\s+/g, ''); },
  buildStudentStatsDataFromRows(rows, monthKey) {
    assert.equal(monthKey, '2026-06');
    assert.equal(rows.length, 1);
    return [{ student: '테스트학생', totalCount: 1, statsSchemaVersion: 'v291' }];
  },
  fetch(url, options) {
    fetchCalls.push({ url, options });
    const rows = String(url).includes('portal_get_teacher_hours_live')
      ? {
          success: true,
          fallbackRequired: liveFallbackRequired,
          incompleteDates: liveFallbackRequired ? ['2026-06-03'] : [],
          attendanceRows,
          classLogRows: liveClassLogRows,
          signatureRows: liveSignatureRows
        }
      : String(url).includes('attendance_logs')
      ? attendanceRows
      : String(url).includes('signatures')
        ? [{ class_date: '2026-06-03', teacher_name: '테스트강사', signed: true, signed_at: '2026-06-03T12:00:00.000Z' }]
      : String(url).includes('portal_login_bootstrap_snapshots')
        ? [loginBootstrapSnapshot]
        : (summaryRow ? [summaryRow] : []);
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
assert.equal(studentStatsResult.ignoredOutOfScopeCount, 1);
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
const staleLiveFallback = await backendHandler('getTeacherHoursDashboardData', {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  teacherName: '김인중'
}, {});
assert.equal(staleLiveFallback.success, true, 'stale summary must switch to the live Supabase rows');
assert.equal(staleLiveFallback.source, 'supabase-teacher-hours-live-rpc');
assert.equal(staleLiveFallback.fallbackReason, 'SUPABASE_SUMMARY_STALE');
assert.ok(fetchCalls.some(call => String(call.url).includes('/rpc/portal_get_teacher_hours_live')));

summaryRow = null;
const missingLiveFallback = await backendHandler('getTeacherHoursDashboardData', {
  year: 2026,
  month: 6,
  teacherName: '테스트강사'
}, {});
assert.equal(missingLiveFallback.source, 'supabase-teacher-hours-live-rpc');
assert.equal(missingLiveFallback.state.rows.length, 1);
assert.equal(missingLiveFallback.state.auxiliary.signedDateMap['2026-06-03'], true);

liveSignatureRows = [];
liveClassLogRows = [{
  class_date: '2026-06-03', teacher_name: '테스트강사', student_name: '테스트학생',
  status: '제출', start_time_text: '오후 5:00', end_time_text: '오후 7:00', class_name: '수학-개별(테스트강사)-2h'
}];

summaryRow = {
  summary_key: 'latest|test',
  month_key: '2026-06',
  teacher_key: '테스트강사',
  teacher_name: '테스트강사',
  state: { rows: [] },
  refreshed_at: new Date().toISOString()
};
const directLiveRefresh = await backendHandler('getTeacherHoursDashboardData', {
  year: 2026,
  month: 6,
  teacherName: '테스트강사',
  preferLive: true
}, {});
assert.equal(directLiveRefresh.source, 'supabase-teacher-hours-live-rpc');
assert.equal(directLiveRefresh.fallbackReason, 'DIRECT_LIVE_REFRESH');
assert.equal(directLiveRefresh.state.auxiliary.signedDateMap['2026-06-03'], true, 'completed legacy class log must preserve agreement');

liveFallbackRequired = true;
await assert.rejects(
  backendHandler('getTeacherHoursDashboardData', {
    year: 2026, month: 6, teacherName: '테스트강사', preferLive: true
  }, {}),
  error => error && error.code === 'SUPABASE_LIVE_BATCH_INCOMPLETE'
);
liveFallbackRequired = false;

summaryRow = {
  summary_key: 'latest|test',
  month_key: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  teacher_key: '김인중',
  teacher_name: '김인중',
  source_cache_version: '1',
  data_source: 'supabase',
  fallback_from: '',
  fallback_reason: '',
  entry_count: 0,
  row_count: 0,
  state: { rows: [], stats: { totalHours: 0 } },
  refreshed_at: new Date().toISOString()
};
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

runtimeConfig = {
  ...runtimeConfig,
  enabled: true,
  directWriteActions: ['saveClassLogRows'],
  writeTimeoutMs: 30000
};
context.window.__TPORTAL_SUPABASE_PUBLIC_CONFIG__ = runtimeConfig;
token = makeToken({ ...validClaims, email: '01037991835@sedu-auth.local' });
context.currentUser.uid = 'firebase-user-1';
tokenRefreshRequests.length = 0;
const writeCalls = [];
let saveAttempt = 0;
context.fetch = (url, options) => {
  writeCalls.push({ url: String(url), options });
  if (String(url).includes('/rpc/portal_save_class_log_rows')) {
    saveAttempt += 1;
    if (saveAttempt === 1) {
      return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve(JSON.stringify({ message: '활성 강사 계정을 확인할 수 없습니다.' })) });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ success: true, supabaseSynced: true, hoursAgreement: { signed: true, date: '2026-07-10' } }))
    });
  }
  if (String(url).includes('/rpc/portal_ensure_own_identity')) {
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ success: true, provisioned: true })) });
  }
  if (String(url).includes('/signatures?')) {
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('[]') });
  }
  throw new Error(`unexpected write test URL: ${url}`);
};
const recoveredWrite = await backendHandler('saveClassLogRows', {
  rows: [{ teacher: '임지우', student: '최현서', date: '2026-07-10', logStatus: '제출', start: '13:30', end: '15:30', className: '1:1' }]
}, {});
assert.equal(recoveredWrite.success, true);
assert.equal(saveAttempt, 2, 'missing identity must retry the idempotent write exactly once');
assert.ok(tokenRefreshRequests.includes(true), '403 recovery must refresh the Firebase token');
assert.ok(writeCalls.some(call => call.url.includes('/rpc/portal_ensure_own_identity')), '403 recovery must repair the exact teacher identity');
const saveCalls = writeCalls.filter(call => call.url.includes('/rpc/portal_save_class_log_rows'));
assert.ok(saveCalls.every(call => call.options.keepalive === true), 'mobile writes must request keepalive');
assert.ok(saveCalls.every(call => call.options.signal), 'mobile writes must retain abort protection');

runtimeConfig = { ...runtimeConfig, enabled: false };
context.window.__TPORTAL_SUPABASE_PUBLIC_CONFIG__ = runtimeConfig;
token = makeToken(validClaims);
context.currentUser.uid = 'firebase-user-1';
await assert.rejects(
  backendHandler('getTeacherHoursDashboardData', { year: 2026, month: 6, teacherName: '김인중' }, {}),
  error => error && error.code === 'SUPABASE_CANARY_DISABLED'
);

console.log('Supabase teacher-hours backend tests passed');
