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
const USERS = Object.freeze([
  { uid: 'teacher_01089945993', phone: '01089945993', teacherName: '안준성', access: 'admin' },
  { uid: 'teacher_01020837308', phone: '01020837308', teacherName: '박은채', access: 'self' },
  { uid: 'teacher_01051434540', phone: '01051434540', teacherName: '김인중', access: 'self' }
]);
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

async function fetchGasBootstrap(user, idToken) {
  const callback = `__login_bootstrap_${user.phone}_cb`;
  const payload = {
    phoneInput: user.phone,
    teacherName: user.teacherName,
    includeCommon: true,
    includeNotices: true,
    includeStudentList: true,
    includeStudentAliases: true,
    useStudentAliasFixture: false,
    includeSlms: true,
    includeHomeroom: true,
    firebaseIdToken: idToken,
    firebaseUid: user.uid,
    forceRefresh: true
  };
  const params = new URLSearchParams({ action: 'getLoginBootstrap', payload: JSON.stringify(payload), callback });
  const startedAt = Date.now();
  const response = await fetch(`${GAS_API_URL}?${params}`);
  const bodyText = await response.text();
  const prefix = `${callback}(`;
  assert.equal(response.ok, true, `${user.teacherName} GAS bootstrap failed: HTTP ${response.status}`);
  assert.equal(bodyText.startsWith(prefix), true, `${user.teacherName} GAS bootstrap JSONP mismatch: ${bodyText.slice(0, 200)}`);
  return {
    body: JSON.parse(bodyText.slice(prefix.length).replace(/\);?\s*$/, '')),
    elapsedMs: Date.now() - startedAt
  };
}

async function fetchSnapshot(idToken, firebaseUid) {
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
  const bodyText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: bodyText ? JSON.parse(bodyText) : null,
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
  const firebaseUsers = await Promise.all(USERS.map(user => admin.auth().getUser(user.uid)));
  firebaseUsers.forEach((firebaseUser, index) => {
    assert.equal(firebaseUser.customClaims?.role, 'authenticated', `${USERS[index].teacherName} authenticated claim missing`);
  });

  const tokens = await Promise.all(USERS.map(user => exchangeCustomToken(user.uid)));
  const gasResults = await Promise.all(USERS.map((user, index) => fetchGasBootstrap(user, tokens[index])));
  const directResults = await Promise.all(USERS.map((user, index) => fetchSnapshot(tokens[index], user.uid)));
  const results = [];

  for (let index = 0; index < USERS.length; index += 1) {
    const user = USERS[index];
    const gas = gasResults[index];
    const direct = directResults[index];
    assert.equal(gas.body?.success, true, `${user.teacherName} GAS bootstrap failed: ${JSON.stringify(gas.body)}`);
    assert.equal(Array.isArray(gas.body.studentList), true);
    assert.equal(Array.isArray(gas.body.notices), true);
    assert.equal(direct.ok, true, `${user.teacherName} Supabase bootstrap failed: HTTP ${direct.status} ${JSON.stringify(direct.body)}`);
    assert.equal(direct.body.length, 1, `${user.teacherName} bootstrap snapshot is missing`);

    const snapshot = direct.body[0];
    assert.equal(snapshot.firebase_uid, user.uid);
    assert.equal(snapshot.request_key, REQUEST_KEY);
    assert.equal(snapshot.schema_version, SCHEMA_VERSION);
    assert.equal(Number(snapshot.student_count || 0), gas.body.studentList.length);
    assert.equal(Number(snapshot.notice_count || 0), gas.body.notices.length);
    assert.deepEqual(canonicalize(snapshot.response_json), canonicalize(gas.body), `${user.teacherName} GAS and Supabase payloads differ`);
    const snapshotAgeMs = Math.max(0, Date.now() - Date.parse(snapshot.refreshed_at || ''));
    assert.ok(snapshotAgeMs <= 300000, `${user.teacherName} bootstrap snapshot is stale: ${snapshotAgeMs}ms`);

    const otherUser = USERS[(index + 1) % USERS.length];
    const crossAccess = await fetchSnapshot(tokens[index], otherUser.uid);
    assert.equal(crossAccess.ok, true, `${user.teacherName} cross-access request failed unexpectedly`);
    assert.deepEqual(crossAccess.body, [], `${user.teacherName} must not read ${otherUser.teacherName} snapshot`);

    results.push({
      uid: user.uid,
      teacherName: user.teacherName,
      access: user.access,
      studentCount: snapshot.student_count,
      noticeCount: snapshot.notice_count,
      gasMs: gas.elapsedMs,
      supabaseMs: direct.elapsedMs,
      snapshotAgeMs,
      crossAccessRows: crossAccess.body.length
    });
  }

  const anonymous = await fetchAnonymousSnapshot();
  assert.equal(anonymous.ok, false, 'Anonymous bootstrap snapshot read must be rejected');
  assert.ok([401, 403].includes(anonymous.status), `Unexpected anonymous status: ${anonymous.status}`);

  console.log(JSON.stringify({
    ok: true,
    gasApiUrl: GAS_API_URL,
    requestKey: REQUEST_KEY,
    users: results,
    anonymousStatus: anonymous.status
  }, null, 2));
} finally {
  await admin.app().delete();
}
