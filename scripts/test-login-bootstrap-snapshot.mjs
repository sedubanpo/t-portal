#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gasText = fs.readFileSync(path.join(root, 'code.gs'), 'utf8');
const indexText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migrationText = fs.readFileSync(
  path.join(root, 'supabase/migrations/202607140005_login_bootstrap_active_teacher_read.sql'),
  'utf8'
);

function extractFunction(name) {
  const start = gasText.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in code.gs`);
  const bodyStart = gasText.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < gasText.length; index += 1) {
    if (gasText[index] === '{') depth += 1;
    if (gasText[index] === '}') depth -= 1;
    if (depth === 0) return gasText.slice(start, index + 1);
  }
  throw new Error(`${name} closing brace not found`);
}

const requests = [];
const context = {
  console,
  encodeURIComponent,
  PORTAL_LOGIN_BOOTSTRAP_SNAPSHOT_SCHEMA_VERSION: 'v1',
  normalizePortalText_(value) { return String(value || '').trim(); },
  getPortalScopeCacheVersion_() { return '42'; },
  getSupabaseConfig_() { return { success: true }; },
  supabaseRequest_(config, pathValue, method, body, options) {
    requests.push({ config, path: pathValue, method, body, options });
    return [];
  }
};
vm.createContext(context);
vm.runInContext([
  extractFunction('getPortalLoginBootstrapRequestKey_'),
  extractFunction('savePortalLoginBootstrapSnapshot_'),
  extractFunction('invalidateAllPortalLoginBootstrapSnapshots_')
].join('\n'), context, { filename: 'login-bootstrap-snapshot.js' });

const payload = {
  includeCommon: true,
  includeNotices: true,
  includeStudentList: true,
  includeSlms: true,
  includeHomeroom: true,
  includeStudentAliases: true,
  useStudentAliasFixture: false
};
assert.equal(context.getPortalLoginBootstrapRequestKey_(payload), 'C1N1S1L1H1A1F0');

const response = {
  success: true,
  common: [],
  notices: [{ type: '공지', content: '테스트' }],
  studentList: [{ name: '학생1' }, { name: '학생2' }]
};
assert.equal(context.savePortalLoginBootstrapSnapshot_(response, payload, 'teacher_admin'), true);
assert.equal(requests[0].method, 'post');
assert.equal(requests[0].body[0].snapshot_key, 'v1:teacher_admin:C1N1S1L1H1A1F0:42');
assert.equal(requests[0].body[0].student_count, 2);
assert.equal(requests[0].body[0].notice_count, 1);
assert.equal(requests[1].method, 'delete');
assert.match(requests[1].path, /firebase_uid=eq\.teacher_admin/);
assert.match(requests[1].path, /snapshot_key=neq\.v1%3Ateacher_admin/);

requests.length = 0;
assert.equal(context.invalidateAllPortalLoginBootstrapSnapshots_(), true);
assert.equal(requests[0].path, 'portal_login_bootstrap_snapshots?schema_version=eq.v1');
assert.equal(requests[0].method, 'delete');

assert.match(gasText, /getLoginBootstrapData[\s\S]*?savePortalLoginBootstrapSnapshot_\(response, payload/);
assert.match(gasText, /syncPortalMasterDataToSupabase[\s\S]*?invalidateAllPortalLoginBootstrapSnapshots_\(\)/);
assert.match(indexText, /function runLoginBootstrapRequest_\([\s\S]*?portalApi\.call\('getLoginBootstrap'/);
assert.doesNotMatch(indexText, /function runLoginBootstrapRequest_\([\s\S]*?google\.script\.run[\s\S]*?function tryLogin/);
assert.match(indexText, /const portalCanaryReadyPromise = preparePortalSupabaseCanary_\(\)[\s\S]*?Promise\.resolve\(portalCanaryReadyPromise\)[\s\S]*?loadLoginBootstrapData/);

assert.match(migrationText, /revoke all on public\.portal_login_bootstrap_snapshots from anon, authenticated/i);
assert.match(migrationText, /firebase_uid\s*=\s*nullif\(\(select auth\.jwt\(\) ->> 'sub'\)/i);
assert.match(migrationText, /function private\.portal_has_active_identity\(\)/i);
assert.match(migrationText, /identity_row\.active\s*=\s*true/i);
assert.match(migrationText, /private\.portal_has_active_identity\(\)/i);
assert.doesNotMatch(migrationText, /grant\s+(insert|update|delete|all)/i);

console.log('Login bootstrap snapshot tests passed');
