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
const CANARY_UID = 'teacher_01089945993';
const DENIED_UID = 'teacher_01033934700';
const TEACHER_NAME = '안준성';
const MONTHS = [
  { year: 2026, month: 4 },
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
  { year: 2026, month: 7 }
];

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
  assert.equal(response.ok, true, `Firebase custom-token exchange failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function fetchSupabaseSummary(idToken, year, month, teacherName) {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const teacherKey = String(teacherName || '').normalize('NFKC').replace(/\s*T$/i, '').replace(/\s+/g, '');
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
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { ok: response.ok, status: response.status, body, elapsedMs: Date.now() - startedAt };
}

async function fetchGasSummary(year, month, teacherName) {
  const callback = '__shadow_test_cb';
  const params = new URLSearchParams({
    action: 'getTeacherHoursDashboardData',
    payload: JSON.stringify({ year, month, teacherName, forceRefresh: false }),
    callback
  });
  const startedAt = Date.now();
  const response = await fetch(`${GAS_API_URL}?${params}`);
  const text = await response.text();
  assert.equal(response.ok, true, `Apps Script request failed: HTTP ${response.status}`);
  const prefix = `${callback}(`;
  assert.equal(text.startsWith(prefix), true, 'Apps Script JSONP callback prefix mismatch');
  const json = text.slice(prefix.length).replace(/\);?\s*$/, '');
  return { body: JSON.parse(json), elapsedMs: Date.now() - startedAt };
}

async function fetchWithoutFirebaseToken() {
  return fetch(`${SUPABASE_URL}/rest/v1/teacher_hours_monthly_summaries?select=summary_key&limit=1`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' }
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

try {
  const [canaryUser, deniedUser] = await Promise.all([
    admin.auth().getUser(CANARY_UID),
    admin.auth().getUser(DENIED_UID)
  ]);
  assert.equal(canaryUser.customClaims?.role, 'authenticated', 'Canary user must have the authenticated claim');
  assert.notEqual(deniedUser.customClaims?.role, 'authenticated', 'Denied user unexpectedly has the authenticated claim');

  const [canaryToken, deniedToken] = await Promise.all([
    exchangeCustomToken(CANARY_UID),
    exchangeCustomToken(DENIED_UID)
  ]);

  const comparisons = [];
  for (const target of MONTHS) {
    // Match the browser shadow order: the GAS primary result completes first,
    // then the Supabase snapshot is read in the background.
    const gas = await fetchGasSummary(target.year, target.month, TEACHER_NAME);
    const supabase = await fetchSupabaseSummary(canaryToken, target.year, target.month, TEACHER_NAME);
    assert.equal(supabase.ok, true, `Supabase canary read failed: HTTP ${supabase.status} ${JSON.stringify(supabase.body)}`);
    assert.equal(Array.isArray(supabase.body), true);
    assert.equal(supabase.body.length, 1, `${target.year}-${target.month} Supabase summary missing`);
    assert.equal(gas.body?.success, true, `${target.year}-${target.month} GAS summary failed`);
    const supabaseStateJson = JSON.stringify(canonicalize(supabase.body[0].state));
    const gasStateJson = JSON.stringify(canonicalize(gas.body.state));
    assert.equal(supabaseStateJson, gasStateJson, JSON.stringify({
      error: 'GAS/Supabase state mismatch',
      monthKey: `${target.year}-${String(target.month).padStart(2, '0')}`,
      supabase: {
        refreshedAt: supabase.body[0].refreshed_at,
        rows: supabase.body[0].state?.rows?.length || 0,
        totalHours: supabase.body[0].state?.stats?.totalHours || 0
      },
      gas: {
        rows: gas.body.state?.rows?.length || 0,
        totalHours: gas.body.state?.stats?.totalHours || 0
      }
    }));
    comparisons.push({
      monthKey: `${target.year}-${String(target.month).padStart(2, '0')}`,
      match: true,
      rowCount: Number(supabase.body[0].row_count || 0),
      entryCount: Number(supabase.body[0].entry_count || 0),
      supabaseMs: supabase.elapsedMs,
      gasMs: gas.elapsedMs
    });
  }

  const denied = await fetchSupabaseSummary(deniedToken, 2026, 6, TEACHER_NAME);
  assert.equal(denied.ok, false, 'Firebase user without authenticated claim must be rejected');
  assert.ok([401, 403].includes(denied.status), `Unexpected denied-user status: ${denied.status}`);

  const anon = await fetchWithoutFirebaseToken();
  assert.equal(anon.ok, false, 'Anonymous summary read must be rejected');
  assert.ok([401, 403].includes(anon.status), `Unexpected anonymous status: ${anon.status}`);

  console.log(JSON.stringify({
    ok: true,
    canaryUid: CANARY_UID,
    teacherName: TEACHER_NAME,
    comparisons,
    deniedUserStatus: denied.status,
    anonymousStatus: anon.status
  }, null, 2));
} finally {
  await admin.app().delete();
}
