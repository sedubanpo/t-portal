import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let admin;
try {
  admin = require('firebase-admin');
} catch {
  admin = require('/Users/anjongseong/Documents/New project/s-lms/node_modules/firebase-admin');
}
const service = require(process.env.FIREBASE_SERVICE_ACCOUNT || '/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json');
const firebaseApiKey = 'AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg';
const supabaseUrl = 'https://wfgtqajdkwzuqkwygcft.supabase.co';
const supabaseKey = 'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8';

admin.initializeApp({ credential: admin.credential.cert(service), projectId: 'fir-lms-prod' });

async function getToken(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${firebaseApiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.idToken;
}

async function list(token, payload) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/portal_list_teacher_hours_issues`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ payload })
  });
  const body = await response.json().catch(() => null);
  assert.equal(response.ok, true, JSON.stringify(body));
  const rows = Array.isArray(body) ? body : (body && Array.isArray(body.rows) ? body.rows : null);
  assert.ok(Array.isArray(rows), JSON.stringify(body));
  return rows;
}

try {
  const [teacherToken, adminToken] = await Promise.all([
    getToken('teacher_01020837308'),
    getToken('teacher_01089945993')
  ]);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const [teacherRows, adminRows] = await Promise.all([
    list(teacherToken, { year: 2026, month: 8 }),
    list(adminToken, { year: 2026, month: 8 })
  ]);
  const anonymous = await fetch(`${supabaseUrl}/rest/v1/rpc/portal_list_teacher_hours_issues`, {
    method: 'POST',
    headers: { apikey: supabaseKey, 'content-type': 'application/json' },
    body: JSON.stringify({ payload: { year: 2026, month: 8 } })
  });
  assert.ok([401, 403].includes(anonymous.status));
  console.log(JSON.stringify({ ok: true, teacherRows: teacherRows.length, adminRows: adminRows.length, anonymousStatus: anonymous.status }, null, 2));
} finally {
  await admin.app().delete();
}
