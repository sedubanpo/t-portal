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
const CANARY = { uid: 'teacher_01089945993', teacherName: '안준성' };
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
  assert.equal(response.ok, true, `Firebase custom-token exchange failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function refreshGasSummary() {
  const callback = '__current_month_canary_cb';
  const params = new URLSearchParams({
    action: 'getTeacherHoursDashboardData',
    payload: JSON.stringify({ year, month, teacherName: CANARY.teacherName, forceRefresh: true }),
    callback
  });
  const startedAt = Date.now();
  const response = await fetch(`${GAS_API_URL}?${params}`);
  const text = await response.text();
  const prefix = `${callback}(`;
  assert.equal(response.ok, true, `Apps Script current-month refresh failed: HTTP ${response.status}`);
  assert.equal(text.startsWith(prefix), true, 'Apps Script JSONP callback prefix mismatch');
  return {
    body: JSON.parse(text.slice(prefix.length).replace(/\);?\s*$/, '')),
    elapsedMs: Date.now() - startedAt
  };
}

async function fetchSupabaseSummary(idToken) {
  const teacherKey = CANARY.teacherName.normalize('NFKC').replace(/\s*T$/i, '').replace(/\s+/g, '');
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
  assert.equal(response.ok, true, `Supabase current-month read failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  assert.equal(Array.isArray(body), true);
  assert.equal(body.length, 1, 'Current-month Supabase summary is missing after GAS refresh');
  return { row: body[0], elapsedMs: Date.now() - startedAt };
}

try {
  const user = await admin.auth().getUser(CANARY.uid);
  assert.equal(user.disabled, false, 'Current-month canary account is disabled');
  assert.equal(user.displayName, CANARY.teacherName, 'Current-month canary display name mismatch');
  assert.equal(user.customClaims?.role, 'authenticated', 'Current-month canary authenticated claim missing');

  const idToken = await exchangeCustomToken(CANARY.uid);
  const gas = await refreshGasSummary();
  assert.equal(gas.body?.success, true, 'GAS current-month summary failed');
  const supabase = await fetchSupabaseSummary(idToken);
  const refreshedAtMs = Date.parse(supabase.row.refreshed_at || '');
  const ageMs = Date.now() - refreshedAtMs;
  assert.equal(Number.isFinite(refreshedAtMs), true, 'Supabase refreshed_at is invalid');
  assert.ok(ageMs >= -5000 && ageMs <= MAX_AGE_MS, `Current-month summary is stale: ${ageMs}ms`);
  assert.deepEqual(canonicalize(supabase.row.state), canonicalize(gas.body.state), 'Current-month GAS/Supabase state mismatch');

  console.log(JSON.stringify({
    ok: true,
    uid: CANARY.uid,
    teacherName: CANARY.teacherName,
    monthKey,
    rowCount: Number(supabase.row.row_count || 0),
    totalHours: Number(supabase.row.state?.stats?.totalHours || 0),
    summaryAgeMs: ageMs,
    gasMs: gas.elapsedMs,
    supabaseMs: supabase.elapsedMs
  }, null, 2));
} finally {
  await admin.app().delete();
}
