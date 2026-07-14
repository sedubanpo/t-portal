#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = require('/Users/anjongseong/Documents/New project/s-lms/node_modules/firebase-admin');
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT
  || '/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json';
const serviceAccount = require(serviceAccountPath);
const FIREBASE_API_KEY = 'AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg';
const FIRESTORE_REST_ROOT = 'https://firestore.googleapis.com/v1/projects/fir-lms-prod/databases/(default)/documents';
const GAS_API_URL = process.env.GAS_API_URL
  || 'https://script.google.com/macros/s/AKfycbyKiyCs2lYmGVAb1XVgqbd0rwkNcIw36gl06juaXNrV-0cxbSx8ZVP8XI9JC1vGViBmLg/exec';
const USERS = Object.freeze([
  { uid: 'teacher_01089945993', loginId: '01089945993', name: '안준성', admin: true },
  { uid: 'teacher_01020837308', loginId: '01020837308', name: '박은채', admin: false },
  { uid: 'teacher_01051434540', loginId: '01051434540', name: '김인중', admin: false }
]);
const DENIED_USER = { uid: 'teacher_01086262428', loginId: '01086262428', name: '안종성' };

function extractFunction(name) {
  const start = indexText.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in index.html`);
  const bodyStart = indexText.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < indexText.length; index += 1) {
    if (indexText[index] === '{') depth += 1;
    if (indexText[index] === '}') depth -= 1;
    if (depth === 0) return indexText.slice(start, index + 1);
  }
  throw new Error(`${name} closing brace not found`);
}

const routeEvents = [];
let serverFallbackCalls = 0;
const context = {
  console,
  Promise,
  Set,
  Date,
  window: {
    __TPORTAL_SUPABASE_PUBLIC_CONFIG__: {
      directFirebaseLoginProfile: true,
      loginProfileFirebaseUids: USERS.map(user => user.uid)
    }
  },
  recordPortalApiRouteEvent(action, detail) { routeEvents.push({ action, ...detail }); },
  callFirebaseAuthLoginServer_() {
    serverFallbackCalls += 1;
    return Promise.resolve({ success: true, authSource: 'firebase-auth', profileSource: 'gas-fallback' });
  }
};
vm.createContext(context);
vm.runInContext([
  extractFunction('normalizeTeacherPortalLoginText_'),
  extractFunction('buildTeacherPortalFirebaseLoginLinksDirect_'),
  extractFunction('buildTeacherPortalFirebaseAccountDirect_'),
  extractFunction('isTeacherPortalFirebaseAccountActiveDirect_'),
  extractFunction('buildTeacherPortalFirebaseTeacherListDirect_'),
  extractFunction('mapTeacherPortalFirestoreSnapshotById_'),
  extractFunction('shouldUseTeacherPortalFirebaseProfileDirect_'),
  extractFunction('getTeacherPortalFirebaseLoginProfileDirect_'),
  extractFunction('resolveTeacherPortalFirebaseLogin_')
].join('\n'), context, { filename: 'firebase-login-profile-direct.js' });

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
  assert.equal(response.ok, true, `${uid} token exchange failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function fetchGasProfile(user, idToken) {
  const callback = `__firebase_profile_${user.loginId}_cb`;
  const params = new URLSearchParams({
    action: 'loginFirebaseAuth',
    payload: JSON.stringify({ idToken, loginId: user.loginId }),
    callback
  });
  const startedAt = Date.now();
  const response = await fetch(`${GAS_API_URL}?${params}`);
  const bodyText = await response.text();
  const prefix = `${callback}(`;
  assert.equal(response.ok, true, `${user.name} GAS profile failed: HTTP ${response.status}`);
  assert.equal(bodyText.startsWith(prefix), true, `${user.name} GAS JSONP mismatch: ${bodyText.slice(0, 200)}`);
  return {
    body: JSON.parse(bodyText.slice(prefix.length).replace(/\);?\s*$/, '')),
    elapsedMs: Date.now() - startedAt
  };
}

async function fetchFirestoreRest(idToken, pathValue) {
  const startedAt = Date.now();
  const response = await fetch(`${FIRESTORE_REST_ROOT}/${pathValue}`, {
    headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json' }
  });
  const bodyText = await response.text();
  return { ok: response.ok, status: response.status, bodyText, elapsedMs: Date.now() - startedAt };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (key === 'profileSource' || key === 'firebaseIdToken' || key === 'performance') return result;
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

try {
  const firestore = admin.firestore();
  const firebaseUsers = await Promise.all(USERS.map(user => admin.auth().getUser(user.uid)));
  const tokens = await Promise.all(USERS.map(user => exchangeCustomToken(user.uid)));
  const gasResults = await Promise.all(USERS.map((user, index) => fetchGasProfile(user, tokens[index])));
  const directResults = [];

  for (let index = 0; index < USERS.length; index += 1) {
    const user = USERS[index];
    const firebaseUser = firebaseUsers[index];
    const startedAt = Date.now();
    const direct = await context.getTeacherPortalFirebaseLoginProfileDirect_(
      { firestore },
      { uid: firebaseUser.uid, email: firebaseUser.email },
      user.loginId
    );
    const directMs = Date.now() - startedAt;
    assert.equal(direct.success, true);
    assert.equal(direct.isAdmin, user.admin);
    assert.deepEqual(
      JSON.parse(JSON.stringify(canonicalize(direct))),
      JSON.parse(JSON.stringify(canonicalize(gasResults[index].body))),
      `${user.name} direct/GAS profile mismatch`
    );

    const ownReads = await Promise.all([
      fetchFirestoreRest(tokens[index], `users/${user.uid}`),
      fetchFirestoreRest(tokens[index], `userProfiles/${user.uid}`),
      fetchFirestoreRest(tokens[index], `userAppAccess/${user.uid}`)
    ]);
    ownReads.forEach(result => assert.equal(result.status, 200, `${user.name} own profile read failed`));
    if (!user.admin) {
      const [crossRead, listRead] = await Promise.all([
        fetchFirestoreRest(tokens[index], `users/${USERS[0].uid}`),
        fetchFirestoreRest(tokens[index], 'users?pageSize=100')
      ]);
      assert.equal(crossRead.status, 403, `${user.name} cross-account read must be denied`);
      assert.equal(listRead.status, 403, `${user.name} account-list read must be denied`);
    }

    directResults.push({
      uid: user.uid,
      name: user.name,
      isAdmin: direct.isAdmin,
      teacherListCount: direct.teacherList.length,
      gasMs: gasResults[index].elapsedMs,
      directMs,
      ownReadMaxMs: Math.max(...ownReads.map(result => result.elapsedMs))
    });
  }

  const deniedFirebaseUser = await admin.auth().getUser(DENIED_USER.uid);
  await assert.rejects(
    context.getTeacherPortalFirebaseLoginProfileDirect_(
      { firestore },
      { uid: deniedFirebaseUser.uid, email: deniedFirebaseUser.email },
      DENIED_USER.loginId
    ),
    error => error && /접근 권한이 없는 계정/.test(error.message)
  );

  const originalDirectResolver = context.getTeacherPortalFirebaseLoginProfileDirect_;
  context.getTeacherPortalFirebaseLoginProfileDirect_ = () => Promise.reject(new Error('simulated Firestore outage'));
  const fallbackResult = await context.resolveTeacherPortalFirebaseLogin_(
    { firestore },
    { uid: USERS[1].uid, email: firebaseUsers[1].email },
    USERS[1].loginId,
    'test-id-token'
  );
  assert.equal(fallbackResult.success, true);
  assert.equal(fallbackResult.profileSource, 'gas-fallback');
  assert.equal(fallbackResult.firebaseUid, USERS[1].uid);
  assert.equal(serverFallbackCalls, 1);
  assert.ok(routeEvents.some(event => event.action === 'loginFirebaseAuth' && event.status === 'fallback'));
  context.getTeacherPortalFirebaseLoginProfileDirect_ = originalDirectResolver;

  console.log(JSON.stringify({
    ok: true,
    gasApiUrl: GAS_API_URL,
    users: directResults,
    deniedUser: DENIED_USER.uid,
    deniedReasonMatched: true,
    fallbackVerified: true
  }, null, 2));
} finally {
  await admin.app().delete();
}
