import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const c={window:{}}; vm.createContext(c);
vm.runInContext(fs.readFileSync(new URL('../access-dashboard-direct.js',import.meta.url),'utf8'),c);
const e=c.window.PortalAccessDashboardEngine;
const r={class_date:'2026-09-11',student_name:'테스트',teacher_name:'강사',status:'지각',hours:2,start_time_text:'16:00',end_time_text:'18:00',import_batch_id:'old'};
const old={id:'old',source:'intranet',status:'completed',imported_at:'2026-09-11T10:00:00Z',row_count:1,metadata:{revision:1}};
const access={...old,id:'access',source:'access-daily',metadata:{sourceDates:['2026-09-11']}};
const o=e.buildOverview([r],[old,access,{...old,id:'pending',status:'pending'}],2026,9,'2026-09-11');
assert.equal(o.versions.length,2);assert.equal(o.selectedRows.length,1);
assert.equal(o.versions.find(x=>x.id==='old').sourceLabel,'인트라넷');
assert.equal(e.buildVersion(old,[r],'2026-09-11','2026-09').snapshotAvailable,false);
const snap={...old,id:'snap',metadata:{sourceDates:['2026-09-11'],accessRowsSnapshot:[r],revision:2}};
const v=e.buildVersion(snap,[],'2026-09-11','2026-09');
assert.equal(v.rows.length,1);assert.equal(v.rows[0].status,'지각');assert.equal(v.rows[0].importBatchId,'snap');
assert.equal(v.snapshotAvailable,true);assert.equal(v.rows[0].hours,2);
const del={...snap,metadata:{sourceDates:['2026-09-11'],accessRowsSnapshot:[],deletedRowsSnapshot:[r],snapshotFormatVersion:1}};
assert.equal(e.buildVersion(del,[r],'2026-09-11','2026-09').rows[0].action,'삭제');
assert.equal(e.buildVersion({...del,metadata:{accessRowsSnapshot:[],snapshotFormatVersion:1}},[r],'','').rows.length,0);
assert.equal(e.buildOverview([], [del],2026,9,'2026-09-11').versions.length,1);
assert.equal(e.buildOverview([], [old],2026,9,'2026-09-11').versions.length,0);
assert.equal(e.buildVersion(snap,[],'2026-09-12','2026-09').rows.length,0);
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const combined=e.combinedIntranetRows({allRows:[
 {...r,date:r.class_date,importBatchId:'old',student:'동명이인',hours:3},
 {date:r.class_date,sourceSystem:'intranet',importBatchId:'outside-list',student:'동명이인',hours:2},
 {date:r.class_date,sourceSystem:'access',importBatchId:'access'},
 {date:'2026-09-12',sourceSystem:'intranet'}
],versionsByDate:{'2026-09-11':[{id:'old',source:'intranet'},{id:'previous-revision',source:'intranet'}]}},'2026-09-11');
assert.equal(combined.length,2,'Combine partial sends without duplicating historical revisions or dropping namesakes');
assert.equal(combined.reduce((n,r)=>n+r.hours,0),5);
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
 if(match[1].trim()&&!match[0].includes('type="module"'))new vm.Script(match[1]);
}
console.log('PASS intranet/Access histories, legacy fallback, immutable snapshot, deletion-only, date isolation, inline syntax');
