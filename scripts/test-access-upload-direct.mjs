#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../access-upload-direct.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);
const engine = context.window.PortalAccessUploadEngine;
assert.ok(engine);

const csv = [
  '수업일\t반명\t이름\t출결\tTR\t시작\t종료\t시간\t비고',
  '7/14(화)\t영어-개별(박규연)-2h\t김학생/서울고/1\t출석\t박규연\t오후 1:00\t오후 3:00\t2\t정상',
  '7/14(화)\t수학-1:1(안준성)-1h\t이학생/세화고/2\t당일취소\t안준성\t오후 3:00\t오후 4:00\t1\t변경'
].join('\n');
const parsed = engine.parse(csv, 'access-paste-2026-07-14.tsv');
assert.equal(parsed.rows.length, 2);
assert.equal(parsed.sourceFormat, 'access-daily');
assert.deepEqual([...parsed.sourceDates], ['2026-07-14']);
assert.match(parsed.rows[0].legacy_key, /^attendance\|2026-07-14\|/);

const existing = [
  { ...parsed.rows[0], id: '00000000-0000-0000-0000-000000000001', status: '결석예고', updated_at: '2026-07-14T00:00:00Z' },
  { ...parsed.rows[1], id: '00000000-0000-0000-0000-000000000002', note: '이전', updated_at: '2026-07-14T00:00:00Z' }
];
const plan = engine.buildPlan(parsed.rows, existing);
assert.equal(plan.summary.update, 2);
const resolutions = Object.fromEntries(plan.candidates.map(item => [item.id, 'overwrite']));
const resolved = engine.resolve(plan, resolutions);
assert.equal(resolved.rowsToUpsert.length, 2);
assert.equal(resolved.summary.overwritten, 2);
assert.equal(resolved.finalRows.length, 2);

const partial = engine.buildPlan(parsed.rows.slice(0, 1), existing);
const deletion = partial.candidates.find(item => item.type === 'delete');
assert.equal(deletion.recommendedAction, 'preserve');
assert.ok(deletion.coverage < 0.7);

const monthlyCsv = [
  '수업일\t반명\t이름\t출결\tTR\t시간',
  '7/1(수)\t영어-개별(박규연)-2h\t월간학생/서울고/1\t출석\t박규연\t2'
].join('\n');
const monthlyParsed = engine.parse(monthlyCsv, '2026년 7월 출결.csv');
assert.equal(monthlyParsed.sourceFormat, 'access-monthly');
assert.equal(monthlyParsed.isMonthlySource, true);
const monthlyExisting = {
  ...monthlyParsed.rows[0],
  id: '00000000-0000-0000-0000-000000000004'
};
const missingDateExisting = {
  ...monthlyParsed.rows[0],
  id: '00000000-0000-0000-0000-000000000003',
  legacy_key: monthlyParsed.rows[0].legacy_key.replace('2026-07-01', '2026-07-02'),
  class_date: '2026-07-02'
};
const monthlyPlan = engine.buildPlan(monthlyParsed.rows, [monthlyExisting, missingDateExisting]);
assert.equal(monthlyPlan.summary.delete, 1);

console.log(JSON.stringify({ ok:true, parsedRows:parsed.rows.length, updates:plan.summary.update, partialDeleteRecommendation:deletion.recommendedAction, monthlyMissingDateCandidates:monthlyPlan.summary.delete }, null, 2));
