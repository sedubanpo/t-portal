#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('/Users/anjongseong/Documents/New project/s-lms/node_modules/firebase-admin');
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT
  || '/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json';
const serviceAccount = require(serviceAccountPath);
const FIREBASE_API_KEY = 'AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg';
const SUPABASE_URL = 'https://wfgtqajdkwzuqkwygcft.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8';
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyKiyCs2lYmGVAb1XVgqbd0rwkNcIw36gl06juaXNrV-0cxbSx8ZVP8XI9JC1vGViBmLg/exec';
const CANARIES = [
  { uid: 'teacher_01089945993', teacherName: '안준성', access: 'admin' },
  { uid: 'teacher_01020837308', teacherName: '박은채', access: 'self' },
  { uid: 'teacher_01051434540', teacherName: '김인중', access: 'self' }
];
const MAX_AGE_MS = 300000;
const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;
const monthKey = `${year}-${String(month).padStart(2, '0')}`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'fir-lms-prod'
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (key === 'fetchedAt') return result;
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

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

async function refreshGasSummary(canary) {
  const callback = '__current_month_canary_cb';
  const params = new URLSearchParams({
    action: 'getTeacherHoursDashboardData',
    payload: JSON.stringify({ year, month, teacherName: canary.teacherName, forceRefresh: true }),
    callback
  });
  const startedAt = Date.now();
  const response = await fetch(`${GAS_API_URL}?${params}`);
  const text = await response.text();
  const prefix = `${callback}(`;
  assert.equal(response.ok, true, `${canary.teacherName} Apps Script current-month refresh failed: HTTP ${response.status}`);
  assert.equal(text.startsWith(prefix), true, `${canary.teacherName} Apps Script JSONP callback prefix mismatch`);
  return {
    body: JSON.parse(text.slice(prefix.length).replace(/\);?\s*$/, '')),
    elapsedMs: Date.now() - startedAt
  };
}

async function fetchSupabaseSummary(idToken, teacherName) {
  const teacherKey = teacherName.normalize('NFKC').replace(/\s*T$/i, '').replace(/\s+/g, '');
  const params = new URLSearchParams({
    select: 'summary_key,month_key,teacher_key,teacher_name,entry_count,row_count,state,refreshed_at',
    month_key: `eq.${monthKey}`,
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
  const body = await response.json();
  return { ok: response.ok, status: response.status, body, elapsedMs: Date.now() - startedAt };
}

try {
  const users = await Promise.all(CANARIES.map(canary => admin.auth().getUser(canary.uid)));
  users.forEach((user, index) => {
    const canary = CANARIES[index];
    assert.equal(user.disabled, false, `${canary.teacherName} current-month canary account is disabled`);
    assert.equal(user.displayName, canary.teacherName, `${canary.teacherName} display name mismatch`);
    assert.equal(user.customClaims?.role, 'authenticated', `${canary.teacherName} authenticated claim missing`);
  });
  const tokens = await Promise.all(CANARIES.map(canary => exchangeCustomToken(canary.uid)));
  const results = [];

  for (let index = 0; index < CANARIES.length; index += 1) {
    const canary = CANARIES[index];
    const gas = await refreshGasSummary(canary);
    assert.equal(gas.body?.success, true, `${canary.teacherName} GAS current-month summary failed`);
    const supabase = await fetchSupabaseSummary(tokens[index], canary.teacherName);
    assert.equal(supabase.ok, true, `${canary.teacherName} Supabase current-month read failed: HTTP ${supabase.status} ${JSON.stringify(supabase.body)}`);
    assert.equal(Array.isArray(supabase.body), true);
    assert.equal(supabase.body.length, 1, `${canary.teacherName} current-month Supabase summary is missing after GAS refresh`);
    const summaryRow = supabase.body[0];
    const refreshedAtMs = Date.parse(summaryRow.refreshed_at || '');
    const ageMs = Date.now() - refreshedAtMs;
    assert.equal(Number.isFinite(refreshedAtMs), true, `${canary.teacherName} Supabase refreshed_at is invalid`);
    assert.ok(ageMs >= -5000 && ageMs <= MAX_AGE_MS, `${canary.teacherName} current-month summary is stale: ${ageMs}ms`);
    assert.deepEqual(canonicalize(summaryRow.state), canonicalize(gas.body.state), `${canary.teacherName} current-month GAS/Supabase state mismatch`);

    let crossScopeBlocked = null;
    if (canary.access === 'self') {
      const crossScope = await fetchSupabaseSummary(tokens[index], '안준성');
      assert.equal(crossScope.ok, true, `${canary.teacherName} cross-scope request failed unexpectedly`);
      assert.equal(Array.isArray(crossScope.body), true);
      assert.equal(crossScope.body.length, 0, `${canary.teacherName} must not read another teacher's current-month summary`);
      crossScopeBlocked = true;
    }

    results.push({
      uid: canary.uid,
      teacherName: canary.teacherName,
      access: canary.access,
      crossScopeBlocked,
      rowCount: Number(summaryRow.row_count || 0),
      totalHours: Number(summaryRow.state?.stats?.totalHours || 0),
      summaryAgeMs: ageMs,
      gasMs: gas.elapsedMs,
      supabaseMs: supabase.elapsedMs
    });
  }

  console.log(JSON.stringify({
    ok: true,
    monthKey,
    canaryCount: results.length,
    matchedCount: results.length,
    crossScopeBlockedCount: results.filter(result => result.crossScopeBlocked).length,
    results
  }, null, 2));
} finally {
  await admin.app().delete();
}
