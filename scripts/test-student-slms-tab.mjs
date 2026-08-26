import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexText = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexText, /const APP_VERSION = 'v513'/);
assert.match(indexText, /id="sc-detail-tab-weekly"/);
assert.match(indexText, /id="sc-detail-tab-lessons" class="sc-detail-tab active"/);
assert.match(indexText, /id="sc-detail-panel-lessons" class="sc-detail-panel active"/);
assert.match(indexText, /id="sc-detail-panel-slms" class="sc-detail-panel"[^>]*hidden/);
assert.match(indexText, /setStudentDetailTab\('lessons', \{ skipLoad: true \}\)/);
assert.match(indexText, /if \(nextTab === 'slms' && !opts\.skipLoad\)/);

assert.match(indexText, /collection\('studentLogs'\)/);
assert.match(indexText, /collection\('students'\)/);
assert.match(indexText, /students\.where\('studentName', '==', identity\.name\)/);
assert.match(indexText, /data\.studentIdAliases/);
assert.match(indexText, /where\('studentId', 'in', idChunk\)/);
assert.match(indexText, /where\('studentName', '==', identity\.name\)/);
assert.match(indexText, /getStudentIdAliases\(canonicalId\)/);
assert.match(indexText, /Promise\.allSettled\(queries\)/);
assert.match(indexText, /validIds\.has\(log\.studentId\)/);
assert.match(indexText, /STUDENT_SLMS_LOG_CACHE_TTL_MS = 5 \* 60 \* 1000/);

const loaderStart = indexText.indexOf('function loadStudentSlmsLogs(options)');
const loaderEnd = indexText.indexOf('function openStudentCalendar(studentName)', loaderStart);
assert.ok(loaderStart > 0 && loaderEnd > loaderStart, 'S-LMS loader block must exist');
const loaderBlock = indexText.slice(loaderStart, loaderEnd);
assert.doesNotMatch(loaderBlock, /collection\.add\(|\.doc\([^)]*\)\.(?:set|update|delete)\(/, 'S-LMS panel must remain read-only');
assert.match(loaderBlock, /status: 'loading'/);
assert.match(loaderBlock, /status: 'ready'/);
assert.match(loaderBlock, /status: 'error'/);

assert.match(indexText, /createdAtMs \|\| data\.updatedAtMs/);
assert.match(indexText, /white-space:pre-wrap/);
assert.match(indexText, /@media \(max-width: 767px\)[\s\S]*?\.sc-slms-card \{ grid-template-columns:1fr/);
assert.match(indexText, /@media \(prefers-reduced-motion: reduce\)/);

console.log('student S-LMS tab safeguards passed');
