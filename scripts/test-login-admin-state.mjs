import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const assignment = source.match(/currentUser=\{name:r\.name[^\n]+;/)[0];
const start = source.indexOf('  function isPortalSupabaseActionAllowedForClaims_(');
const gate = source.slice(start, source.indexOf('\n  function ', start + 1));
const context = vm.createContext({ currentUser: {}, isAdminMode: false, document: { getElementById: () => ({ value: 'test' }) } });
vm.runInContext(gate, context);
for (const isAdmin of [true, false, undefined, 'true']) {
  context.r = { success: true, name: 'test', isAdmin };
  vm.runInContext(assignment, context);
  for (const action of ['getClassLogMonthlyOverview', 'getClassCheckoutDashboardData', 'getStudentSubjectSelectionData', 'getPortalMasterSupabaseStatus']) {
    assert.equal(context.isPortalSupabaseActionAllowedForClaims_(action, { sub: 'test' }, {}), isAdmin === true);
  }
}
assert.match(source, /id="inputId"[^>]+aria-label="휴대폰 번호"[^>]+autocomplete="username"/);
assert.match(source, /id="inputPw"[^>]+aria-label="비밀번호"[^>]+autocomplete="current-password"/);
console.log('login admin-state and accessible field contracts passed');
