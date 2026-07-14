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
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT
  || '/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json');
const FIREBASE_API_KEY = 'AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg';
const SUPABASE_URL = 'https://wfgtqajdkwzuqkwygcft.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8';
const GAS_API_URL = process.env.GAS_API_URL
  || 'https://script.google.com/macros/s/AKfycbyKiyCs2lYmGVAb1XVgqbd0rwkNcIw36gl06juaXNrV-0cxbSx8ZVP8XI9JC1vGViBmLg/exec';
const ADMIN_UID = 'teacher_01089945993';
const TEACHER_UID = 'teacher_01020837308';

function extractFunction(name) {
  const start = indexText.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = indexText.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < indexText.length; index += 1) {
    if (indexText[index] === '{') depth += 1;
    if (indexText[index] === '}') depth -= 1;
    if (depth === 0) return indexText.slice(start, index + 1);
  }
  throw new Error(`${name} closing brace not found`);
}

async function exchangeCustomToken(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const body = await response.json();
  assert.equal(response.ok, true, `${uid} token exchange failed`);
  return body.idToken;
}

async function fetchGas(action, payload = {}) {
  const callback = `__simple_${action}_cb`;
  const params = new URLSearchParams({ action, payload: JSON.stringify(payload), callback });
  const response = await fetch(`${GAS_API_URL}?${params}`);
  const text = await response.text();
  const prefix = `${callback}(`;
  assert.equal(response.ok, true);
  assert.equal(text.startsWith(prefix), true, `${action} JSONP mismatch`);
  return JSON.parse(text.slice(prefix.length).replace(/\);?\s*$/, ''));
}

async function requestRows(config, tablePath, token) {
  const response = await fetch(`${config.url}/rest/v1/${tablePath}`, {
    headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || `HTTP ${response.status}`);
  return body;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (key === 'performance') return result;
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'fir-lms-prod' });

try {
  const [adminToken, teacherToken] = await Promise.all([
    exchangeCustomToken(ADMIN_UID),
    exchangeCustomToken(TEACHER_UID)
  ]);
  const context = {
    Promise,
    console,
    normalizeStudentSubjectChoiceGroup(group) {
      const text = String(group || '').trim();
      return ({ 과탐: '과학', 사탐: '사회' })[text] || text || '기타';
    },
    cleanStudentName(value) { return String(value || '').trim(); },
    requestPortalSupabaseRows_: requestRows,
    makePortalSupabaseError_(message) { return new Error(message); }
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction('getPortalDefaultStudentSubjectCatalogDirect_'),
    extractFunction('mergePortalStudentSubjectCatalogDirect_'),
    extractFunction('getPortalSimpleReadFromSupabase_')
  ].join('\n'), context);
  const config = { url: SUPABASE_URL, publishableKey: SUPABASE_KEY };

  const actions = [
    { action: 'getNotice', payload: {} },
    { action: 'getPortalMasterSupabaseStatus', payload: {} },
    { action: 'getStudentSubjectSelectionData', payload: {} }
  ];
  const results = [];
  for (const item of actions) {
    const startedAt = Date.now();
    const [direct, gas] = await Promise.all([
      context.getPortalSimpleReadFromSupabase_(item.action, item.payload, config, adminToken),
      fetchGas(item.action, item.payload)
    ]);
    assert.deepEqual(
      JSON.parse(JSON.stringify(canonicalize(direct))),
      JSON.parse(JSON.stringify(canonicalize(gas))),
      `${item.action} direct/GAS mismatch`
    );
    results.push({ action: item.action, elapsedMs: Date.now() - startedAt });
  }

  const teacherNotice = await context.getPortalSimpleReadFromSupabase_('getNotice', {}, config, teacherToken);
  assert.ok(Array.isArray(teacherNotice));
  const deniedChecks = await Promise.all([
    requestRows(config, 'portal_master_sync_runs?select=id&limit=1', teacherToken),
    requestRows(config, 'student_subject_choices?select=id&limit=1', teacherToken)
  ]);
  deniedChecks.forEach(rows => assert.deepEqual(rows, []));
  const anonymous = await fetch(`${SUPABASE_URL}/rest/v1/portal_notices?select=id&limit=1`, {
    headers: { apikey: SUPABASE_KEY, Accept: 'application/json' }
  });
  assert.ok([401, 403].includes(anonymous.status));

  console.log(JSON.stringify({
    ok: true,
    results,
    teacherNoticeCount: teacherNotice.length,
    deniedAdminDatasetRows: deniedChecks.map(rows => rows.length),
    anonymousStatus: anonymous.status
  }, null, 2));
} finally {
  await admin.app().delete();
}
