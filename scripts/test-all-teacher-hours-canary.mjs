#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { TEACHER_HOURS_CANARY_USERS } from './teacher-hours-canary-users.mjs';

const require = createRequire(import.meta.url);
const admin = require('/Users/anjongseong/Documents/New project/s-lms/node_modules/firebase-admin');
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT
  || '/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json';
const serviceAccount = require(serviceAccountPath);
const FIREBASE_API_KEY = 'AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg';
const SUPABASE_URL = 'https://wfgtqajdkwzuqkwygcft.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8';
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyKiyCs2lYmGVAb1XVgqbd0rwkNcIw36gl06juaXNrV-0cxbSx8ZVP8XI9JC1vGViBmLg/exec';
const DENIED_UID = 'codex-rule-instructor';
const TARGET_MONTH = String(process.env.CANARY_TEST_MONTH || '2026-06');
const [targetYear, targetMonth] = TARGET_MONTH.split('-').map(Number);
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CANARY_TEST_CONCURRENCY || 4), 6));

assert.ok(targetYear >= 2020 && targetMonth >= 1 && targetMonth <= 12, `잘못된 CANARY_TEST_MONTH: ${TARGET_MONTH}`);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'fir-lms-prod'
});

async function exchangeCustomToken(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const body = await response.json();
  assert.equal(response.ok, true, `${uid} Firebase custom-token exchange failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function fetchSupabaseSummary(idToken, teacherName) {
  const teacherKey = String(teacherName || '').normalize('NFKC').replace(/\s*T$/i, '').replace(/\s+/g, '');
  const params = new URLSearchParams({
    select: 'summary_key,month_key,teacher_key,teacher_name,entry_count,row_count,state,refreshed_at',
    month_key: `eq.${TARGET_MONTH}`,
    teacher_key: `eq.${teacherKey}`,
    order: 'refreshed_at.desc',
    limit: '1'
  });
  const startedAt = Date.now();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/teacher_hours_monthly_summaries?${params}`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${idToken}`,
      Accept: 'application/json'
    }
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: text ? JSON.parse(text) : null,
    elapsedMs: Date.now() - startedAt
  };
}

async function fetchGasSummary(teacherName) {
  const callback = '__all_canary_test_cb';
  const params = new URLSearchParams({
    action: 'getTeacherHoursDashboardData',
    payload: JSON.stringify({ year: targetYear, month: targetMonth, teacherName, forceRefresh: false }),
    callback
  });
  const startedAt = Date.now();
  const response = await fetch(`${GAS_API_URL}?${params}`);
  const text = await response.text();
  assert.equal(response.ok, true, `${teacherName} Apps Script request failed: HTTP ${response.status}`);
  const prefix = `${callback}(`;
  assert.equal(text.startsWith(prefix), true, `${teacherName} Apps Script JSONP callback prefix mismatch`);
  return {
    body: JSON.parse(text.slice(prefix.length).replace(/\);?\s*$/, '')),
    elapsedMs: Date.now() - startedAt
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (key === 'fetchedAt') return result;
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

try {
  const firebaseUsers = await Promise.all(TEACHER_HOURS_CANARY_USERS.map(item => admin.auth().getUser(item.uid)));
  firebaseUsers.forEach((user, index) => {
    const expected = TEACHER_HOURS_CANARY_USERS[index];
    assert.equal(user.disabled, false, `${expected.teacherName} Firebase account is disabled`);
    assert.equal(user.displayName, expected.teacherName, `${expected.uid} display name mismatch`);
    assert.equal(user.customClaims?.role, 'authenticated', `${expected.uid} authenticated claim missing`);
  });

  const tokens = await Promise.all(TEACHER_HOURS_CANARY_USERS.map(item => exchangeCustomToken(item.uid)));
  const results = await mapWithConcurrency(TEACHER_HOURS_CANARY_USERS, CONCURRENCY, async (canary, index) => {
    const [gas, supabase] = await Promise.all([
      fetchGasSummary(canary.teacherName),
      fetchSupabaseSummary(tokens[index], canary.teacherName)
    ]);
    assert.equal(gas.body?.success, true, `${canary.teacherName} ${TARGET_MONTH} GAS summary failed`);
    const summaryRow = supabase.ok && Array.isArray(supabase.body) ? supabase.body[0] : null;
    const comparableSupabase = summaryRow ? JSON.stringify(canonicalize(summaryRow.state)) : '';
    const comparableGas = JSON.stringify(canonicalize(gas.body.state));
    const match = Boolean(summaryRow) && comparableSupabase === comparableGas;

    let crossScopeBlocked = null;
    if (canary.access === 'self') {
      const crossScope = await fetchSupabaseSummary(tokens[index], '안준성');
      assert.equal(crossScope.ok, true, `${canary.teacherName} cross-scope request failed unexpectedly`);
      assert.equal(crossScope.body.length, 0, `${canary.teacherName} must not read another teacher's summary`);
      crossScopeBlocked = true;
    }

    return {
      uid: canary.uid,
      teacherName: canary.teacherName,
      access: canary.access,
      match,
      issue: !supabase.ok
        ? `supabase-http-${supabase.status}`
        : (!summaryRow ? 'summary-missing' : (match ? '' : 'state-mismatch')),
      crossScopeBlocked,
      supabaseRowCount: Number(summaryRow?.row_count || 0),
      gasRowCount: Number(gas.body.state?.rows?.length || 0),
      supabaseTotalHours: Number(summaryRow?.state?.stats?.totalHours || 0),
      gasTotalHours: Number(gas.body.state?.stats?.totalHours || 0),
      refreshedAt: summaryRow?.refreshed_at || '',
      supabaseMs: supabase.elapsedMs,
      gasMs: gas.elapsedMs
    };
  });

  const deniedToken = await exchangeCustomToken(DENIED_UID);
  const denied = await fetchSupabaseSummary(deniedToken, '안준성');
  assert.equal(denied.ok, false, 'Firebase user without authenticated claim must be rejected');
  assert.ok([401, 403].includes(denied.status), `Unexpected denied status: ${denied.status}`);

  const anonymous = await fetch(`${SUPABASE_URL}/rest/v1/teacher_hours_monthly_summaries?select=summary_key&limit=1`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' }
  });
  assert.equal(anonymous.ok, false, 'Anonymous summary read must be rejected');
  assert.ok([401, 403].includes(anonymous.status), `Unexpected anonymous status: ${anonymous.status}`);

  const report = {
    ok: true,
    monthKey: TARGET_MONTH,
    canaryCount: results.length,
    matchedCount: results.filter(item => item.match).length,
    crossScopeBlockedCount: results.filter(item => item.crossScopeBlocked).length,
    deniedStatus: denied.status,
    anonymousStatus: anonymous.status,
    results
  };
  report.ok = report.matchedCount === report.canaryCount;
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.matchedCount, report.canaryCount, `${report.canaryCount - report.matchedCount}개 강사 요약이 GAS와 일치하지 않습니다.`);
} finally {
  await admin.app().delete();
}
