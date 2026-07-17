#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexText = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexText, /id="sc-detail-tab-weekly"[^>]*onclick="setStudentDetailTab\('weekly'\)"/);
assert.match(indexText, /id="sc-weekly-mini-calendar"/);
assert.match(indexText, /id="sc-weekly-grid"/);
assert.match(indexText, /\['lessons', 'weekly', 'slms'\]/);
assert.match(indexText, /function renderStudentWeeklySchedule\(\)/);
assert.match(indexText, /function renderStudentWeeklyMiniCalendar\(\)/);
assert.match(indexText, /function changeStudentWeeklyWeek\(offset\)/);
assert.match(indexText, /function changeStudentWeeklyMonth\(offset\)/);
assert.match(indexText, /function getStudentWeeklyRows\(\)/);
assert.match(indexText, /getStudentCalendarScopedCache\(cursor\.getFullYear\(\), cursor\.getMonth\(\), scStudentName\)/);
assert.match(indexText, /if \(scDetailTab === 'weekly'\) renderStudentWeeklySchedule\(\)/);
assert.match(indexText, /\.sc-weekly-shell \{ display:grid; grid-template-columns:224px minmax\(0,1fr\)/);
assert.match(indexText, /@media \(max-width: 767px\)[\s\S]*?\.sc-weekly-shell \{ grid-template-columns:1fr/);

console.log('student weekly timetable safeguards passed');
