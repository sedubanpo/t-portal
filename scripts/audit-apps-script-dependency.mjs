#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEACHER_HOURS_CANARY_USERS } from './teacher-hours-canary-users.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const gasPath = path.join(root, 'code.gs');
const gasSourceAvailable = fs.existsSync(gasPath);
const gasText = gasSourceAvailable ? fs.readFileSync(gasPath, 'utf8') : '';
const migrationsDir = path.join(root, 'supabase', 'migrations');
const migrationNames = fs.readdirSync(migrationsDir)
  .filter(name => name.endsWith('.sql'))
  .sort();
const migrationText = migrationNames
  .map(name => fs.readFileSync(path.join(migrationsDir, name), 'utf8'))
  .join('\n');
const identityMigrationName = '202607130001_firebase_portal_identity_scopes.sql';
const identityMigrationPath = path.join(migrationsDir, identityMigrationName);
const identityMigrationText = fs.existsSync(identityMigrationPath)
  ? fs.readFileSync(identityMigrationPath, 'utf8')
  : '';
const canaryMigrationName = '202607130002_teacher_hours_firebase_read_canary.sql';
const canaryMigrationPath = path.join(migrationsDir, canaryMigrationName);
const canaryMigrationText = fs.existsSync(canaryMigrationPath)
  ? fs.readFileSync(canaryMigrationPath, 'utf8')
  : '';
const runtimeConfigPath = path.join(root, 'portal-runtime-config.js');
const runtimeConfigText = fs.existsSync(runtimeConfigPath) ? fs.readFileSync(runtimeConfigPath, 'utf8') : '';

function unique(values) {
  return [...new Set(values)].sort();
}

const dispatcherBlock = (gasText.match(/function handleApiAction_\(action, payload\) \{[\s\S]*?\n\}/) || [''])[0];
const dispatcherActions = unique([...dispatcherBlock.matchAll(/case\s+['"]([^'"]+)['"]/g)].map(match => match[1]));
const bridgeMappings = [...indexText.matchAll(/runner\.([A-Za-z0-9_]+)\s*=\s*function[^}]*?invoke\(['"]([^'"]+)['"]/g)]
  .map(match => ({ method: match[1], action: match[2] }));
const bridgeActions = unique(bridgeMappings.map(item => item.action));
const routerBlock = (indexText.match(/\/\/ PORTAL_API_ROUTER_START[\s\S]*?\/\/ PORTAL_API_ROUTER_END/) || [''])[0];
const metaBlock = (routerBlock.match(/const PORTAL_API_ACTION_META = Object\.freeze\(\{[\s\S]*?\n  \}\);/) || [''])[0];
const metadataActions = unique([...metaBlock.matchAll(/^\s{4}([A-Za-z0-9_]+):\s*\{\s*kind:\s*['"](read|write)['"]/gm)].map(match => match[1]));
const metadataKinds = Object.fromEntries([...metaBlock.matchAll(/^\s{4}([A-Za-z0-9_]+):\s*\{\s*kind:\s*['"](read|write)['"]/gm)].map(match => [match[1], match[2]]));

const missingDispatcherActions = bridgeActions.filter(action => !dispatcherActions.includes(action));
const missingMetadataActions = bridgeActions.filter(action => !metadataActions.includes(action));
const unusedMetadataActions = metadataActions.filter(action => !bridgeActions.includes(action));
const duplicateBridgeActions = unique(bridgeMappings
  .map(item => item.action)
  .filter((action, index, all) => all.indexOf(action) !== index));
const bridgeUsesPortalApi = /function invoke\(action, payload, options\) \{\s*const req = portalApi\.call\(action, payload, options\);/.test(indexText);
const identityMigrationOperationalPolicyTargets = unique([
  ...identityMigrationText.matchAll(/create\s+policy\s+[^\s]+\s+on\s+public\.([a-z0-9_]+)/gi)
].map(match => match[1]).filter(tableName => ![
  'portal_identities',
  'portal_identity_teacher_scopes',
  'portal_identity_student_scopes'
].includes(tableName)));
const identityMigrationGrantsAnon = /grant\s+[^;]+\s+to\s+[^;]*\banon\b/i.test(identityMigrationText);
const identityMigrationContainsServiceKey = /service[_-]?role[_-]?key|service[_-]?key/i.test(identityMigrationText);
const canaryPolicyTargets = unique([
  ...canaryMigrationText.matchAll(/create\s+policy\s+[^\s]+\s+on\s+public\.([a-z0-9_]+)/gi)
].map(match => match[1]));
const canaryGrantsAnon = /grant\s+[^;]+\s+to\s+[^;]*\banon\b/i.test(canaryMigrationText);
const canaryGrantsWrite = /grant\s+(?:insert|update|delete|all)(?:\s+privileges)?\b/i.test(canaryMigrationText);
const canaryHasFirebaseGuards = [
  /auth\.jwt\(\)\s*->>\s*'iss'/i,
  /auth\.jwt\(\)\s*->>\s*'aud'/i,
  /auth\.jwt\(\)\s*->>\s*'role'/i,
  /private\.portal_can_access_teacher/i
].every(pattern => pattern.test(canaryMigrationText));
const canaryUsesTeacherLookupDefiner = /function\s+private\.portal_teacher_id_by_name[\s\S]*?security\s+definer/i.test(canaryMigrationText)
  && /private\.portal_teacher_id_by_name\(teacher_name\)/i.test(canaryMigrationText);
const canaryGrantsTeachersTable = /grant\s+select\s+on\s+public\.teachers\s+to\s+authenticated/i.test(canaryMigrationText);
const runtimeCanaryEnabled = /enabled:\s*true\b/.test(runtimeConfigText);
const runtimePastMonthsDirect = /pastMonthsDirect:\s*true\b/.test(runtimeConfigText);
const runtimeCurrentMonthUidBlock = (runtimeConfigText.match(/currentMonthDirectFirebaseUids:\s*\[([^\]]*)\]/) || [])[1] || '';
const runtimeCurrentMonthDirectUids = unique([...runtimeCurrentMonthUidBlock.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1].trim()).filter(Boolean));
const runtimeMaxCurrentMonthAgeMs = Number((runtimeConfigText.match(/maxCurrentMonthAgeMs:\s*(\d+)/) || [])[1] || 0);
const runtimePublishableKey = (runtimeConfigText.match(/publishableKey:\s*['"]([^'"]*)['"]/) || [])[1] || '';
const runtimeCanaryUidBlock = (runtimeConfigText.match(/canaryFirebaseUids:\s*\[([^\]]*)\]/) || [])[1] || '';
const runtimeCanaryUids = unique([...runtimeCanaryUidBlock.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1].trim()).filter(Boolean));
const approvedCanaryUids = unique(TEACHER_HOURS_CANARY_USERS.map(user => user.uid));
const expectedCurrentMonthDirectUids = approvedCanaryUids;
const runtimeCanaryUidAllowlist = new Set(approvedCanaryUids);
const unexpectedRuntimeCanaryUids = runtimeCanaryUids.filter(uid => !runtimeCanaryUidAllowlist.has(uid));
const missingRuntimeCanaryUids = approvedCanaryUids.filter(uid => !runtimeCanaryUids.includes(uid));
const runtimeHasSafePublishableKey = !runtimePublishableKey || runtimePublishableKey.startsWith('sb_publishable_');
const runtimeContainsSecretKey = /\bsb_secret_[A-Za-z0-9_-]+/.test(runtimeConfigText);
const gasHasTeacherHoursMonthInvalidation = /function\s+invalidateTeacherHoursDashboardSummaryMonths_\s*\(/.test(gasText)
  && /uploadSupabaseAttendanceCsv[\s\S]*?invalidateTeacherHoursDashboardSummaryMonths_\(getTeacherHoursMonthKeysFromUploadSource_\(parsed\)\)/.test(gasText)
  && /syncToFirebaseLocked_[\s\S]*?invalidateTeacherHoursDashboardSummaryMonths_\(Object\.keys\(affectedMonthKeys\)\)/.test(gasText);

const summary = {
  generatedAt: new Date().toISOString(),
  gasSourceAvailable,
  dispatcherActionCount: dispatcherActions.length,
  browserBridgeActionCount: bridgeActions.length,
  browserBridgeReadCount: bridgeActions.filter(action => metadataKinds[action] === 'read').length,
  browserBridgeWriteCount: bridgeActions.filter(action => metadataKinds[action] === 'write').length,
  googleScriptRunReferenceCount: (indexText.match(/google\.script\.run/g) || []).length,
  directSupabaseCreateClientCount: (indexText.match(/createClient\s*\(/g) || []).length,
  spreadsheetAppReferenceCount: (gasText.match(/SpreadsheetApp/g) || []).length,
  urlFetchAppReferenceCount: (gasText.match(/UrlFetchApp/g) || []).length,
  rlsEnabledTableCount: (migrationText.match(/enable row level security/gi) || []).length,
  rlsPolicyCount: (migrationText.match(/create\s+policy/gi) || []).length,
  bridgeUsesPortalApi,
  identityMigrationPresent: Boolean(identityMigrationText),
  identityMigrationOperationalPolicyTargets,
  identityMigrationGrantsAnon,
  identityMigrationContainsServiceKey,
  canaryMigrationPresent: Boolean(canaryMigrationText),
  canaryPolicyTargets,
  canaryGrantsAnon,
  canaryGrantsWrite,
  canaryHasFirebaseGuards,
  canaryUsesTeacherLookupDefiner,
  canaryGrantsTeachersTable,
  runtimeCanaryEnabled,
  runtimePastMonthsDirect,
  runtimeCurrentMonthDirectUids,
  runtimeMaxCurrentMonthAgeMs,
  runtimeCanaryUids,
  unexpectedRuntimeCanaryUids,
  missingRuntimeCanaryUids,
  runtimeHasSafePublishableKey,
  runtimeContainsSecretKey,
  gasHasTeacherHoursMonthInvalidation,
  missingDispatcherActions,
  missingMetadataActions,
  unusedMetadataActions,
  duplicateBridgeActions
};

const issues = [];
if (!bridgeUsesPortalApi) issues.push('브라우저 호환 브리지가 portalApi.call을 사용하지 않습니다.');
if (gasSourceAvailable && missingDispatcherActions.length) issues.push(`Apps Script dispatcher 누락: ${missingDispatcherActions.join(', ')}`);
if (missingMetadataActions.length) issues.push(`portalApi metadata 누락: ${missingMetadataActions.join(', ')}`);
if (duplicateBridgeActions.length) issues.push(`중복 bridge action: ${duplicateBridgeActions.join(', ')}`);
if (!identityMigrationText) issues.push(`${identityMigrationName} 파일이 없습니다.`);
if (identityMigrationOperationalPolicyTargets.length) {
  issues.push(`identity migration이 운영 테이블 policy를 생성합니다: ${identityMigrationOperationalPolicyTargets.join(', ')}`);
}
if (identityMigrationGrantsAnon) issues.push('identity migration에 anon 권한 부여가 포함되어 있습니다.');
if (identityMigrationContainsServiceKey) issues.push('identity migration에 service key 문자열이 포함되어 있습니다.');
if (!canaryMigrationText) issues.push(`${canaryMigrationName} 파일이 없습니다.`);
if (canaryPolicyTargets.length !== 1 || canaryPolicyTargets[0] !== 'teacher_hours_monthly_summaries') {
  issues.push(`canary policy 대상이 시수 요약 테이블 하나로 제한되지 않았습니다: ${canaryPolicyTargets.join(', ') || '없음'}`);
}
if (canaryGrantsAnon) issues.push('canary migration에 anon 권한 부여가 포함되어 있습니다.');
if (canaryGrantsWrite) issues.push('canary migration에 쓰기 권한 부여가 포함되어 있습니다.');
if (!canaryHasFirebaseGuards) issues.push('canary migration의 Firebase issuer/audience/role/scope 검증이 불완전합니다.');
if (!canaryUsesTeacherLookupDefiner) issues.push('canary migration이 강사 UUID 조회를 제한된 security definer 함수로 처리하지 않습니다.');
if (canaryGrantsTeachersTable) issues.push('canary migration이 authenticated 역할에 teachers 테이블 직접 조회 권한을 부여합니다.');
if (runtimeContainsSecretKey || !runtimeHasSafePublishableKey) issues.push('runtime config에 브라우저 사용이 금지된 Supabase secret key가 포함되어 있습니다.');
if (runtimeCanaryEnabled && !runtimePublishableKey) issues.push('활성 Supabase canary에 publishable key가 없습니다.');
if (runtimeCanaryEnabled && unexpectedRuntimeCanaryUids.length) {
  issues.push(`승인되지 않은 canary UID가 설정되어 있습니다: ${unexpectedRuntimeCanaryUids.join(', ')}`);
}
if (runtimeCanaryEnabled && missingRuntimeCanaryUids.length) {
  issues.push(`검증된 활성 강사 UID가 runtime canary에서 누락되었습니다: ${missingRuntimeCanaryUids.join(', ')}`);
}
if (runtimePastMonthsDirect && !runtimeCanaryEnabled) issues.push('과거 월 직접 읽기가 canary 비활성 상태에서 설정되어 있습니다.');
if (runtimePastMonthsDirect && runtimeCanaryUids.length !== approvedCanaryUids.length) {
  issues.push(`과거 월 직접 읽기 대상이 검증된 활성 강사 ${approvedCanaryUids.length}명과 일치하지 않습니다.`);
}
const missingCurrentMonthDirectUids = expectedCurrentMonthDirectUids.filter(uid => !runtimeCurrentMonthDirectUids.includes(uid));
const unexpectedCurrentMonthDirectUids = runtimeCurrentMonthDirectUids.filter(uid => !expectedCurrentMonthDirectUids.includes(uid));
if (missingCurrentMonthDirectUids.length || unexpectedCurrentMonthDirectUids.length) {
  issues.push(`현재 월 직접 읽기는 검증된 활성 강사 ${expectedCurrentMonthDirectUids.length}명과 일치해야 합니다. 누락: ${missingCurrentMonthDirectUids.join(', ') || '없음'}, 미승인: ${unexpectedCurrentMonthDirectUids.join(', ') || '없음'}`);
}
if (runtimeMaxCurrentMonthAgeMs < 60000 || runtimeMaxCurrentMonthAgeMs > 300000) {
  issues.push(`현재 월 Supabase 최신성 허용값이 안전 범위(1~5분)를 벗어났습니다: ${runtimeMaxCurrentMonthAgeMs}ms`);
}
if (gasSourceAvailable && !gasHasTeacherHoursMonthInvalidation) {
  issues.push('Access 업로드·Firebase 동기화 후 현재 월 시수 요약을 무효화하는 경로가 불완전합니다.');
}

console.log(JSON.stringify({ ok: issues.length === 0, summary, issues }, null, 2));
if (process.argv.includes('--check') && issues.length) process.exitCode = 1;
