#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexText = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexText, /const APP_VERSION = 'v514'/);
assert.match(indexText, /function getWeekTimetableMonthRequests\(\)/);
assert.match(indexText, /while \(cursor <= last\)/, 'cross-month weeks must request every touched month');
assert.match(indexText, /function fetchWeekTimetableMonthDirect\(req\)/);
assert.match(indexText, /attendance_logs\?select=\$\{fields\}/);
assert.match(indexText, /teacher_name=eq\.\$\{encodeURIComponent\(req\.teacherName\)\}/);
assert.match(indexText, /getValidatedPortalSupabaseToken_\(config, \{ allowOutsideCanary: true \}\)/);
assert.match(indexText, /Promise\.all\(missing\.map/);
assert.match(indexText, /document\.body\.dataset\.teacherTimetableLoadSource = usedLegacy \? 'apps-script-fallback' : 'supabase-direct'/);
assert.match(indexText, /function fetchWeekTimetableMonthLegacy\(req\)/, 'legacy route must remain as failure recovery only');

const loaderStart = indexText.indexOf('function loadWeekTimetableData(forceRefresh)');
const loaderEnd = indexText.indexOf('function formatWeekRange', loaderStart);
assert.ok(loaderStart > 0 && loaderEnd > loaderStart, 'weekly timetable loader block must exist');
const loaderBlock = indexText.slice(loaderStart, loaderEnd);
assert.match(loaderBlock, /fetchWeekTimetableMonthDirect\(req\)\.catch/);
assert.doesNotMatch(loaderBlock, /ensureTeacherDataScope\(/, 'normal weekly load must not route through Apps Script scope loading');

const scopePrefetchStart = indexText.indexOf('function fetchTeacherScopeToCache(options, extraOptions)');
const scopePrefetchEnd = indexText.indexOf('function applyTeacherDataEntries', scopePrefetchStart);
const scopePrefetchBlock = indexText.slice(scopePrefetchStart, scopePrefetchEnd);
assert.match(scopePrefetchBlock, /google\.script\.run\.withSuccessHandler/);
assert.doesNotMatch(scopePrefetchBlock, /runLoginBootstrapRequest_[\s\S]*?\.withFailureHandler/, 'Promise bootstrap helper must not be chained like google.script.run');

console.log('weekly timetable Supabase-direct safeguards passed');
