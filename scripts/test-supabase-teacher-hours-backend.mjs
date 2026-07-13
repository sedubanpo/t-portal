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
  shadowActions: ['getTeacherHoursDashboardData'],
  timeoutMs: 7000,
  maxCurrentMonthAgeMs: 900000
};
const routeChanges = [];
const routeEvents = [];
const fetchCalls = [];
let backendHandler = null;
const summaryRow = {
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

const context = {
  window: { __TPORTAL_SUPABASE_PUBLIC_CONFIG__: runtimeConfig },
  TEACHER_PORTAL_FIREBASE_CONFIG: { projectId: 'fir-lms-prod' },
  currentUser: { uid: 'firebase-user-1' },
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
  fetch(url, options) {
    fetchCalls.push({ url, options });
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify([summaryRow]))
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
assert.ok(routeChanges.some(item => item.action === 'getTeacherHoursDashboardData' && item.route === 'shadow'));

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

token = makeToken({ ...validClaims, role: undefined });
routeChanges.length = 0;
const rejectedCanary = await context.preparePortalSupabaseCanary_();
assert.equal(rejectedCanary.enabled, false);
assert.ok(routeChanges.every(item => item.route === 'gas'));
assert.ok(routeEvents.some(item => item.action === 'supabase-canary' && item.status === 'rejected'));

token = makeToken({ ...validClaims, sub: 'firebase-user-2' });
routeChanges.length = 0;
const wrongCanaryUser = await context.preparePortalSupabaseCanary_();
assert.equal(wrongCanaryUser.enabled, false);
assert.ok(routeChanges.every(item => item.route === 'gas'));

token = makeToken(validClaims);
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

runtimeConfig = { ...runtimeConfig, enabled: false };
context.window.__TPORTAL_SUPABASE_PUBLIC_CONFIG__ = runtimeConfig;
await assert.rejects(
  backendHandler('getTeacherHoursDashboardData', { year: 2026, month: 6, teacherName: '김인중' }, {}),
  error => error && error.code === 'SUPABASE_CANARY_DISABLED'
);

console.log('Supabase teacher-hours backend tests passed');
