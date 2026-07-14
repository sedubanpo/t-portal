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
const GAS_API_URL = process.env.GAS_API_URL
  || 'https://script.google.com/macros/s/AKfycbyKiyCs2lYmGVAb1XVgqbd0rwkNcIw36gl06juaXNrV-0cxbSx8ZVP8XI9JC1vGViBmLg/exec';
const ADMIN = { uid: 'teacher_01089945993', phone: '01089945993', teacherName: '안준성' };
const DENIED_TEACHER = { uid: 'teacher_01020837308', teacherName: '박은채' };
const SCHEMA_VERSION = 'v1';
const REQUEST_KEY = 'C1N1S1L1H1A1F0';

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

async function fetchGasBootstrap(idToken) {
  const callback = '__login_bootstrap_canary_cb';
  const payload = {
    phoneInput: ADMIN.phone,
    teacherName: ADMIN.teacherName,
    includeCommon: true,
    includeNotices: true,
    includeStudentList: true,
    includeStudentAliases: true,
    useStudentAliasFixture: false,
    includeSlms: true,
    includeHomeroom: true,
    firebaseIdToken: idToken,
    firebaseUid: ADMIN.uid,
    forceRefresh: true
  };
  const params = new URLSearchParams({ action: 'getLoginBootstrap', payload: JSON.stringify(payload), callback });
  const startedAt = Date.now();
  const response = await fetch(`${GAS_API_URL}?${params}`);
  const text = await response.text();
  const prefix = `${callback}(`;
  assert.equal(response.ok, true, `GAS bootstrap failed: HTTP ${response.status}`);
  assert.equal(text.startsWith(prefix), true, `GAS bootstrap JSONP mismatch: ${text.slice(0, 200)}`);
  return {
    body: JSON.parse(text.slice(prefix.length).replace(/\);?\s*$/, '')),
    elapsedMs: Date.now() - startedAt
  };
}

async function fetchSnapshot(idToken, firebaseUid = ADMIN.uid) {
  const params = new URLSearchParams({
    select: 'snapshot_key,firebase_uid,request_key,schema_version,source_cache_version,response_json,student_count,notice_count,refreshed_at',
    firebase_uid: `eq.${firebaseUid}`,
    request_key: `eq.${REQUEST_KEY}`,
    schema_version: `eq.${SCHEMA_VERSION}`,
    order: 'refreshed_at.desc',
    limit: '1'
  });
  const startedAt = Date.now();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/portal_login_bootstrap_snapshots?${params}`, {
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

function fetchAnonymousSnapshot() {
  return fetch(`${SUPABASE_URL}/rest/v1/portal_login_bootstrap_snapshots?select=snapshot_key&limit=1`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' }
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (key === 'performance' || key === 'fetchedAt') return result;
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

  const gas = await fetchGasBootstrap(adminToken);
  assert.equal(gas.body?.success, true, `GAS bootstrap failed: ${JSON.stringify(gas.body)}`);
  assert.equal(Array.isArray(gas.body.studentList), true);
  assert.equal(Array.isArray(gas.body.notices), true);

  const direct = await fetchSnapshot(adminToken);
  assert.equal(direct.ok, true, `Supabase bootstrap failed: HTTP ${direct.status} ${JSON.stringify(direct.body)}`);
  assert.equal(Array.isArray(direct.body), true);
  assert.equal(direct.body.length, 1, 'Admin bootstrap snapshot is missing');
  const snapshot = direct.body[0];
  assert.equal(snapshot.firebase_uid, ADMIN.uid);
  assert.equal(snapshot.request_key, REQUEST_KEY);
  assert.equal(snapshot.schema_version, SCHEMA_VERSION);
  assert.equal(Number(snapshot.student_count || 0), gas.body.studentList.length);
  assert.equal(Number(snapshot.notice_count || 0), gas.body.notices.length);
  assert.deepEqual(canonicalize(snapshot.response_json), canonicalize(gas.body), 'GAS and Supabase bootstrap payloads differ');
  const snapshotAgeMs = Math.max(0, Date.now() - Date.parse(snapshot.refreshed_at || ''));
  assert.ok(snapshotAgeMs <= 300000, `Bootstrap snapshot is stale: ${snapshotAgeMs}ms`);

  const denied = await fetchSnapshot(deniedToken);
  assert.equal(denied.ok, true, 'RLS-denied teacher request should return an empty result');
  assert.deepEqual(denied.body, [], 'Non-admin teacher must not read admin bootstrap snapshots');
  const anonymous = await fetchAnonymousSnapshot();
  assert.equal(anonymous.ok, false, 'Anonymous bootstrap snapshot read must be rejected');
  assert.ok([401, 403].includes(anonymous.status), `Unexpected anonymous status: ${anonymous.status}`);

  console.log(JSON.stringify({
    ok: true,
    gasApiUrl: GAS_API_URL,
    adminUid: ADMIN.uid,
    requestKey: REQUEST_KEY,
    studentCount: snapshot.student_count,
    noticeCount: snapshot.notice_count,
    gasMs: gas.elapsedMs,
    supabaseMs: direct.elapsedMs,
    snapshotAgeMs,
    deniedTeacherUid: DENIED_TEACHER.uid,
    deniedTeacherRows: denied.body.length,
    anonymousStatus: anonymous.status
  }, null, 2));
} finally {
  await admin.app().delete();
}
