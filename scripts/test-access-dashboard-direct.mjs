#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../access-dashboard-direct.js',import.meta.url),'utf8');
const context={window:{}};vm.createContext(context);vm.runInContext(source,context);const engine=context.window.PortalAccessDashboardEngine;assert.ok(engine);
const rows=[
  {class_date:'2026-07-01',teacher_name:'박규연',student_name:'학생A',status:'출석',hours:2,start_time_text:'오후 1:00',end_time_text:'오후 3:00',import_batch_id:'batch-1',updated_at:'2026-07-01T06:00:00Z'},
  {class_date:'2026-07-02',teacher_name:'안준성',student_name:'학생B',status:'당일취소',hours:1,start_time_text:'오후 3:00',end_time_text:'오후 4:00',import_batch_id:'batch-1',updated_at:'2026-07-02T07:00:00Z'}
];
const batches=[{id:'batch-1',source:'access-daily',source_file:'access.tsv',imported_by:'admin',imported_at:'2026-07-02T08:00:00Z',row_count:2,status:'completed',metadata:{sourceMonth:'2026-07',sourceDates:['2026-07-01','2026-07-02'],uploadSummary:{addedRows:2,changedRows:0}}}];
const dashboard=engine.buildDashboard(rows,batches,2026,7);assert.equal(dashboard.monthSummary.rows,2);assert.equal(dashboard.monthSummary.hours,3);
const overview=engine.buildOverview(rows,batches,2026,7,'2026-07-01');assert.equal(overview.summary.coverageDays,2);assert.equal(overview.selectedRows.length,1);assert.equal(overview.versions.length,1);
const preview=engine.buildPreview(rows,2026,7,'박규연','',80);assert.equal(preview.summary.rows,1);
const version=engine.buildVersion(batches[0],rows,'2026-07-02','2026-07');assert.equal(version.rows.length,1);
console.log(JSON.stringify({ok:true,dashboardRows:2,coverageDays:2,filteredRows:1,versionRows:1},null,2));
