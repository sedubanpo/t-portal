#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { TEACHER_HOURS_CANARY_USERS } from './teacher-hours-canary-users.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const routerMatch = indexText.match(/\/\/ PORTAL_API_ROUTER_START[\s\S]*?\/\/ PORTAL_API_ROUTER_END/);
assert.ok(routerMatch, 'portalApi router block must exist');
const approvedCurrentMonthUids = TEACHER_HOURS_CANARY_USERS.map(user => user.uid);

const gasCalls = [];
const postCalls = [];
const context = {
  window: {
    __TPORTAL_SUPABASE_PUBLIC_CONFIG__: {
      currentMonthDirectFirebaseUids: approvedCurrentMonthUids,
      directActions: ['getStudentStatsMonthlyOverview', 'getLoginBootstrap']
    }
  },
  currentUser: { uid: 'teacher_01089945993' },
  console,
  API_PERFORMANCE_LOG_LIMIT: 80,
  getPortalSupabasePublicConfig_() {
    return { directActions: ['getStudentStatsMonthlyOverview', 'getLoginBootstrap'] };
  },
  gasJsonpRequestWithRetry(action, payload, options) {
    gasCalls.push({ action, payload, options });
    if (action === 'getTeacherHoursDashboardData') {
      return Promise.resolve({
        success: true,
        source: 'gas',
        monthKey: `${payload.year}-${String(payload.month).padStart(2, '0')}`,
        state: { rows: [], stats: { totalHours: 0 }, auxiliary: { fetchedAt: '2026-07-14T00:00:00.000Z' } }
      });
    }
    return Promise.resolve({ success: true, action, payload });
  },
  gasPostMessageRequestWithRetry(action, payload, options) {
    postCalls.push({ action, payload, options });
    return Promise.resolve({ success: true, action, payload, transport: 'postMessage' });
  }
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(routerMatch[0], context, { filename: 'portal-api-router.js' });

const api = context.window.portalApi;
assert.ok(api, 'portalApi must be exposed on window');
assert.equal(api.getRoute('getTeacherHoursDashboardData'), 'gas');

const gasResult = await api.call('getTeacherHoursDashboardData', { year: 2026, month: 7 }, { retries: 1 });
assert.equal(gasResult.success, true);
assert.equal(gasCalls.length, 1);
assert.equal(gasCalls[0].action, 'getTeacherHoursDashboardData');

await api.call('saveClassLogRows', { rows: [{}] }, { transport: 'postMessage' });
assert.equal(postCalls.length, 1);
assert.equal(postCalls[0].action, 'saveClassLogRows');

api.registerBackend('supabase', async (action, payload) => ({
  success: true,
  action,
  payload,
  backend: 'supabase',
  source: 'supabase',
  monthKey: `${payload.year}-${String(payload.month).padStart(2, '0')}`,
  state: { stats: { totalHours: 0 }, rows: [], auxiliary: { fetchedAt: '2026-07-13T00:00:00.000Z' } }
}));
api.setRoute('getTeacherHoursDashboardData', 'supabase');
const supabaseResult = await api.call('getTeacherHoursDashboardData', { year: 2026, month: 6 });
assert.equal(supabaseResult.backend, 'supabase');

api.setRoute('getTeacherHoursDashboardData', 'shadow');
const shadowPrimary = await api.call('getTeacherHoursDashboardData', { year: 2026, month: 6 });
assert.equal(shadowPrimary.success, true);
await new Promise(resolve => setTimeout(resolve, 0));
const shadowLog = (context.window.appState.apiRouteLog || []).find(item => (
  item.action === 'getTeacherHoursDashboardData'
  && item.route === 'shadow'
  && item.status === 'compared'
));
assert.ok(shadowLog, 'shadow comparison must be recorded');
assert.equal(shadowLog.status, 'compared');
assert.equal(shadowLog.match, true, 'teacher-hours comparison must ignore transport metadata, fetchedAt, and object-key order');

api.registerBackend('supabase', async () => {
  throw new Error('simulated Supabase outage');
});
api.setRoute('getStudentStatsMonthlyOverview', 'shadow');
const outagePrimary = await api.call('getStudentStatsMonthlyOverview', { year: 2026, month: 6 });
assert.equal(outagePrimary.success, true, 'shadow backend failure must not fail the GAS result');
await new Promise(resolve => setTimeout(resolve, 0));
const outageLog = (context.window.appState.apiRouteLog || []).find(item => (
  item.action === 'getStudentStatsMonthlyOverview'
  && item.route === 'shadow'
  && item.status === 'failed'
));
assert.ok(outageLog, 'shadow backend failure must be recorded');

const now = new Date();
const past = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const pastPayload = { year: past.getFullYear(), month: past.getMonth() + 1 };
const currentPayload = { year: now.getFullYear(), month: now.getMonth() + 1 };

api.registerBackend('supabase', async (action, payload) => ({
  success: true,
  backend: 'supabase',
  monthKey: `${payload.year}-${String(payload.month).padStart(2, '0')}`,
  state: { stats: { totalHours: 0 }, rows: [] }
}));
api.setRoute('getTeacherHoursDashboardData', 'canary');
const gasCountBeforeDirect = gasCalls.length;
const pastDirect = await api.call('getTeacherHoursDashboardData', pastPayload);
assert.equal(pastDirect.backend, 'supabase', 'past month must use Supabase directly for the canary user');
assert.equal(gasCalls.length, gasCountBeforeDirect, 'successful past-month direct read must not call GAS');

api.registerBackend('supabase', async () => { throw new Error('simulated direct-read outage'); });
const fallbackResult = await api.call('getTeacherHoursDashboardData', pastPayload);
assert.equal(fallbackResult.success, true, 'past-month Supabase outage must fall back to GAS');
assert.equal(gasCalls.length, gasCountBeforeDirect + 1);
assert.ok((context.window.appState.apiRouteLog || []).some(item => item.route === 'supabase' && item.status === 'fallback'));

api.registerBackend('supabase', async (action, payload) => ({
  success: true,
  backend: 'supabase',
  monthKey: `${payload.year}-${String(payload.month).padStart(2, '0')}`,
  state: { stats: { totalHours: 0 }, rows: [] }
}));
for (const approvedUid of approvedCurrentMonthUids) {
  context.currentUser.uid = approvedUid;
  const currentDirectGasCount = gasCalls.length;
  const currentDirect = await api.call('getTeacherHoursDashboardData', currentPayload);
  assert.equal(currentDirect.backend, 'supabase', `approved current-month canary ${approvedUid} must use Supabase directly`);
  assert.equal(gasCalls.length, currentDirectGasCount, 'successful current-month direct read must not call GAS');
}

context.currentUser.uid = 'teacher_not_approved';
const currentPrimary = await api.call('getTeacherHoursDashboardData', currentPayload);
assert.equal(currentPrimary.success, true, 'non-approved current-month users must keep the GAS primary result');
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok((context.window.appState.apiRouteLog || []).some(item => (
  item.action === 'getTeacherHoursDashboardData'
  && item.route === 'canary'
  && item.status === 'selected'
  && item.selectedRoute === 'shadow'
)));
context.currentUser.uid = 'teacher_01089945993';

api.registerBackend('supabase', async (action, payload) => ({
  success: true,
  backend: 'supabase',
  source: 'supabase-student-stats-snapshot',
  monthKey: `${payload.year}-${String(payload.month).padStart(2, '0')}`,
  entryCount: 0,
  rows: []
}));
api.setRoute('getStudentStatsMonthlyOverview', 'canary');
const studentDirectGasCount = gasCalls.length;
const studentDirect = await api.call('getStudentStatsMonthlyOverview', currentPayload);
assert.equal(studentDirect.backend, 'supabase', 'approved admin student stats must use Supabase directly');
assert.equal(gasCalls.length, studentDirectGasCount, 'successful student stats direct read must not call GAS');

api.registerBackend('supabase', async () => {
  const error = new Error('stale student stats snapshot');
  error.code = 'SUPABASE_SUMMARY_STALE';
  throw error;
});
const staleStudentFallback = await api.call('getStudentStatsMonthlyOverview', currentPayload);
assert.equal(staleStudentFallback.success, true, 'stale student stats snapshot must fall back to GAS');
assert.equal(gasCalls.at(-1).action, 'getStudentStatsMonthlyOverview');
assert.equal(gasCalls.at(-1).payload.forceRefresh, true, 'stale snapshot fallback must force GAS snapshot regeneration');

api.registerBackend('supabase', async () => {
  const error = new Error('missing student stats snapshot');
  error.code = 'SUPABASE_SUMMARY_MISSING';
  throw error;
});
await api.call('getStudentStatsMonthlyOverview', pastPayload);
assert.equal(gasCalls.at(-1).payload.forceRefresh, true, 'missing snapshot fallback must force GAS snapshot regeneration');

const studentForceGasCount = gasCalls.length;
await api.call('getStudentStatsMonthlyOverview', { ...currentPayload, forceRefresh: true });
assert.equal(gasCalls.length, studentForceGasCount + 1, 'student stats force refresh must use GAS');

api.registerBackend('supabase', async (action, payload) => ({ success: true, backend: 'supabase', action, payload }));
api.setRoute('getLoginBootstrap', 'canary');
const bootstrapDirectGasCount = gasCalls.length;
const bootstrapDirect = await api.call('getLoginBootstrap', { includeStudentList: true });
assert.equal(bootstrapDirect.backend, 'supabase', 'approved admin login bootstrap must use Supabase directly');
assert.equal(gasCalls.length, bootstrapDirectGasCount, 'successful bootstrap direct read must not call GAS');
assert.match(indexText, /key === 'fetchedAt' \|\| key === 'performance'/, 'shadow comparison must ignore transport-only performance metadata');

api.registerBackend('supabase', async () => {
  const error = new Error('missing login bootstrap snapshot');
  error.code = 'SUPABASE_SUMMARY_MISSING';
  throw error;
});
await api.call('getLoginBootstrap', { includeStudentList: true });
assert.equal(gasCalls.at(-1).action, 'getLoginBootstrap');
assert.equal(gasCalls.at(-1).payload.forceRefresh, true, 'missing bootstrap snapshot must force GAS regeneration');

const forceRefreshGasCount = gasCalls.length;
await api.call('getTeacherHoursDashboardData', { ...pastPayload, forceRefresh: true });
assert.equal(gasCalls.length, forceRefreshGasCount + 1, 'force refresh must use GAS');

assert.throws(() => api.setRoute('saveClassLogRows', 'shadow'), /쓰기 API/);
assert.throws(() => api.setRoute('saveClassLogRows', 'canary'), /쓰기 API/);
assert.throws(() => api.setRoute('unknownAction', 'supabase'), /등록되지 않은 API action/);

api.clearRoute('getTeacherHoursDashboardData');
assert.equal(api.getRoute('getTeacherHoursDashboardData'), 'gas');
assert.equal(api.getActionMeta('saveClassLogRows').kind, 'write');
assert.equal(api.getSnapshot().length, 33, 'Access 분석·업로드 제거 후 라우터 metadata 수가 감사 기준과 일치해야 합니다.');

console.log('portalApi router tests passed');
