#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexText = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(indexText, /const APP_VERSION = 'v498'/);
assert.match(indexText, /function primeStudentCalendarFromStatsOverview/);
assert.match(indexText, /Array\.isArray\(allStatsData\)/);
assert.match(indexText, /window\.appState\.studentStatsByMonth\[monthKey\]/);
assert.match(indexText, /setStudentCalendarScopedCache\(year, month0, targetName, scopedRows, \[\]\)/);
assert.match(indexText, /studentCalendarLoadSource = 'stats-overview'/);
assert.match(indexText, /target\.rows\.push\.apply\(target\.rows, row\.rows\)/);
assert.match(indexText, /const itemMonthKey = String\(item && item\.dateKey \|\| ''\)\.slice\(0, 7\)/);
assert.match(indexText, /year: year,[\s\S]*?month: month,[\s\S]*?day: Number\(dateKey\.slice\(-2\)\)/);

const openStart = indexText.indexOf('function openStudentCalendar(studentName)');
const openEnd = indexText.indexOf('function closeStudentCalendarModal()', openStart);
assert.ok(openStart > 0 && openEnd > openStart, 'student calendar open block must exist');
const openBlock = indexText.slice(openStart, openEnd);
const primeAt = openBlock.indexOf('primeStudentCalendarFromStatsOverview');
const loadAt = openBlock.indexOf('loadStudentCalendarScopeAndRender');
assert.ok(primeAt > 0 && loadAt > primeAt, 'overview rows must be primed before the calendar loader runs');

console.log('student calendar instant-open safeguards passed');
