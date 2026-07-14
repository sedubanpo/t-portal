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
const SCHEMA_VERSION = 'v291';
const ADMIN = { uid: 'teacher_01089945993', teacherName: '안준성' };
const DENIED_TEACHER = { uid: 'teacher_01020837308', teacherName: '박은채' };
const now = new Date();
const MONTHS = Array.from({ length: 3 }, (_, index) => {
  const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
});

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
  assert.equal(response.ok, true, `${uid} Firebase token exchange failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function fetchGasOverview(year, month) {
  const callback = '__student_stats_shadow_cb';
  const params = new URLSearchParams({
    action: 'getStudentStatsMonthlyOverview',
    payload: JSON.stringify({ year, month, forceRefresh: false }),
    callback
  });
  const startedAt = Date.now();
  const response = await fetch(`${GAS_API_URL}?${params}`);
  const text = await response.text();
  const prefix = `${callback}(`;
  assert.equal(response.ok, true, `GAS student stats failed: HTTP ${response.status}`);
  assert.equal(text.startsWith(prefix), true, 'GAS student stats JSONP callback mismatch');
  return {
    body: JSON.parse(text.slice(prefix.length).replace(/\);?\s*$/, '')),
    elapsedMs: Date.now() - startedAt
  };
}

async function fetchSupabaseSnapshot(idToken, year, month) {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const params = new URLSearchParams({
    select: 'snapshot_key,month_key,schema_version,entry_count,row_count,rows_json,refreshed_at',
    month_key: `eq.${monthKey}`,
    schema_version: `eq.${SCHEMA_VERSION}`,
    order: 'refreshed_at.desc',
    limit: '1'
  });
  const startedAt = Date.now();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/student_stats_monthly_snapshots?${params}`, {
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

async function fetchAnonymousSnapshot() {
  return fetch(`${SUPABASE_URL}/rest/v1/student_stats_monthly_snapshots?select=snapshot_key&limit=1`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' }
  });
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

try {
  const [adminUser, deniedUser] = await Promise.all([
    admin.auth().getUser(ADMIN.uid),
    admin.auth().getUser(DENIED_TEACHER.uid)
  ]);
  assert.equal(adminUser.customClaims?.role, 'authenticated');
  assert.equal(deniedUser.customClaims?.role, 'authenticated');
  const [adminToken, deniedToken] = await Promise.all([
    exchangeCustomToken(ADMIN.uid),
    exchangeCustomToken(DENIED_TEACHER.uid)
  ]);

  const results = [];
  for (const target of MONTHS) {
    const gas = await fetchGasOverview(target.year, target.month);
    assert.equal(gas.body?.success, true, `${target.year}-${target.month} GAS overview failed`);
    const supabase = await fetchSupabaseSnapshot(adminToken, target.year, target.month);
    assert.equal(supabase.ok, true, `${target.year}-${target.month} Supabase snapshot failed: HTTP ${supabase.status} ${JSON.stringify(supabase.body)}`);
    assert.equal(Array.isArray(supabase.body), true);
    assert.equal(supabase.body.length, 1, `${target.year}-${target.month} Supabase snapshot missing`);
    const snapshot = supabase.body[0];
    assert.equal(snapshot.schema_version, SCHEMA_VERSION);
    assert.equal(Number(snapshot.entry_count || 0), Number(gas.body.entryCount || 0));
    assert.deepEqual(canonicalize(snapshot.rows_json), canonicalize(gas.body.rows), `${target.year}-${target.month} GAS/Supabase student rows mismatch`);
    results.push({
      monthKey: snapshot.month_key,
      rowCount: Number(snapshot.row_count || 0),
      entryCount: Number(snapshot.entry_count || 0),
      gasMs: gas.elapsedMs,
      supabaseMs: supabase.elapsedMs,
      refreshedAt: snapshot.refreshed_at
    });
  }

  const denied = await fetchSupabaseSnapshot(deniedToken, MONTHS[0].year, MONTHS[0].month);
  assert.equal(denied.ok, true, 'RLS-denied teacher request should return an empty result');
  assert.deepEqual(denied.body, [], 'Non-admin teacher must not read all-student snapshots');
  const anonymous = await fetchAnonymousSnapshot();
  assert.equal(anonymous.ok, false, 'Anonymous student snapshot read must be rejected');
  assert.ok([401, 403].includes(anonymous.status), `Unexpected anonymous status: ${anonymous.status}`);

  console.log(JSON.stringify({
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    adminUid: ADMIN.uid,
    matchedMonths: results.length,
    deniedTeacherUid: DENIED_TEACHER.uid,
    deniedTeacherRows: denied.body.length,
    anonymousStatus: anonymous.status,
    results
  }, null, 2));
} finally {
  await admin.app().delete();
}
