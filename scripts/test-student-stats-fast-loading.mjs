#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const runtimeText = fs.readFileSync(path.join(root, 'portal-runtime-config.js'), 'utf8');

assert.match(indexText, /const APP_VERSION = 'v493'/);
assert.match(indexText, /const STUDENT_STATS_PREFETCH_MONTHS = 1/);
assert.match(indexText, /const STUDENT_STATS_REQUEST_TIMEOUT_MS = 25 \* 1000/);
assert.match(runtimeText, /maxStudentStatsCurrentMonthAgeMs:\s*300000/);

const preloadBlock = indexText.match(/function preloadStudentManagementCaches[\s\S]*?\n  }\n\n  function getStudentStatsPrefetchTargets/);
assert.ok(preloadBlock, 'student-management preload block must exist');
assert.doesNotMatch(preloadBlock[0], /preloadMakeupTrackerNearbyMonths/);
assert.doesNotMatch(preloadBlock[0], /preloadTeacherStudentFlowDashboard/);
assert.doesNotMatch(preloadBlock[0], /preloadStudentStopDashboard/);

const requestBlock = indexText.match(/function fetchStudentStatsOverviewCache[\s\S]*?\n  }\n\n  function fetchStudentStatsMonthCache/);
assert.ok(requestBlock, 'student stats request block must exist');
assert.match(requestBlock[0], /studentStatsPendingByMonth\[requestKey\]/);
assert.match(requestBlock[0], /timeoutMs:\s*STUDENT_STATS_REQUEST_TIMEOUT_MS/);
assert.match(requestBlock[0], /retries:\s*0/);
assert.doesNotMatch(requestBlock[0], /google\.script\.run/);

const refreshBlock = indexText.match(/function refreshStudentStats\(forceRefresh\)[\s\S]*?\n  }\n\n  function isStudentStatsModalOpen_/);
assert.ok(refreshBlock, 'student stats refresh block must exist');
assert.match(refreshBlock[0], /readStudentStatsLocalCacheEntry\(selectedMonth, true\)/);
assert.match(refreshBlock[0], /기존 데이터를 표시하고 최신 상태를 확인 중입니다/);

assert.match(indexText, /source:\s*'supabase-student-stats-live'/);
assert.match(indexText, /attendance_logs\?select=\$\{fields\}/);
assert.match(indexText, /order=id\.asc/);
assert.match(indexText, /ignoredOutOfScopeCount/);
assert.match(indexText, /slice\(0, 7\) === monthKey/);
assert.match(indexText, /document\.body\.dataset\.studentStatsLastError/);
assert.match(indexText, /STUDENT_STATS_SCHEMA_MISMATCH/);
assert.match(indexText, /STUDENT_STATS_MONTH_MISMATCH/);
assert.match(indexText, /SUPABASE_ROUTE_FALLBACK/);
assert.match(indexText, /const scopedRawRows = res\.rows\.reduce/);
assert.match(indexText, /buildStudentStatsDataFromRows\(scopedRawRows, monthKey\)/);
assert.match(indexText, /status: 'promoted', selectedRoute: route/);
assert.match(indexText, /isAdminMode === true/);
assert.match(indexText, /function buildStudentStatsDataFromRows/);
assert.doesNotMatch(indexText, /getPortalSupabasePublicConfig_/);
assert.match(indexText, /refreshStudentStatsSnapshotInBackground_/);
assert.match(indexText, /waitForTeacherPortalFirebaseUser_\(state\.auth, 1800\)\.then\(user => \(\{ state, user \}\)\)/);

console.log('student stats fast-loading safeguards passed');
