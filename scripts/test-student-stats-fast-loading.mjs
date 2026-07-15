#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const runtimeText = fs.readFileSync(path.join(root, 'portal-runtime-config.js'), 'utf8');

assert.match(indexText, /const APP_VERSION = 'v482'/);
assert.match(indexText, /const STUDENT_STATS_PREFETCH_MONTHS = 2/);
assert.match(indexText, /const STUDENT_STATS_REQUEST_TIMEOUT_MS = 25 \* 1000/);
assert.match(runtimeText, /maxStudentStatsCurrentMonthHardAgeMs:\s*86400000/);

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

assert.match(indexText, /refreshRecommended:\s*monthKey === currentMonthKey/);
assert.match(indexText, /refreshStudentStatsSnapshotInBackground_/);
assert.match(indexText, /waitForTeacherPortalFirebaseUser_\(state\.auth, 1800\)\.then\(user => \(\{ state, user \}\)\)/);

console.log('student stats fast-loading safeguards passed');
