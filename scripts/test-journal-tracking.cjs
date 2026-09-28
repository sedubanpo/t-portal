const test=require('node:test'),assert=require('node:assert/strict');
const {tracking}=require('../portal-functions/lesson-logs/tracking');
function fixture(fresh=true){
 const lesson=(id,uid)=>({id,teacherUid:uid,teacher:uid,date:'2026-09-27',kind:'regular',payMinutes:60,start:'17:00',end:'18:00'});
 const data={
  intranetStudentPeriods:{period:{month:'2026-09',studentId:'student',status:'sent',lessons:[lesson('a','teacher-a'),lesson('b','teacher-b')]}},
  students:{student:{name:'가상 학생'}},
  lessonLogSyncState:{notion:{lastSuccessAt:{toDate:()=>new Date(Date.now()-(fresh?0:3*3600000))}}},
  portalLessonNotionMappings:{'teacher:teacher-a':{pageId:'teacher-page-a'},'teacher:teacher-b':{pageId:'teacher-page-b'}},
  lessonLogNotionPages:{older:{id:'older',classDate:'2026-09-20',teacherRelationIds:['teacher-page-a'],teacherName:'teacher-a',title:'이전 일지',url:'https://notion.so/example'},foreign:{id:'foreign',classDate:'2026-09-20',teacherRelationIds:['teacher-page-b'],teacherName:'teacher-b'}}
 };
 const snap=(id,d)=>({id,exists:!!d,data:()=>d});
 const collection=(name,filters=[])=>({doc:id=>({get:async()=>snap(id,data[name]?.[id])}),where:(k,op,v)=>collection(name,[...filters,[k,op,v]]),limit:()=>collection(name,filters),get:async()=>{const docs=Object.entries(data[name]||{}).filter(([id,d])=>filters.every(([k,op,v])=>op==='=='?d[k]===v:op==='>='?d[k]>=v:d[k]<=v)).map(([id,d])=>snap(id,d));return {docs,size:docs.length};}});
 return {collection,getAll:async(...refs)=>Promise.all(refs.map(r=>r.get()))};
}
const input={start:'2026-09-01',end:'2026-09-28'};
test('teacher tracking ignores requested foreign UID, includes own unmatched historical Notion pages',async()=>{
 const r=await tracking(fixture(),{uid:'teacher-a',admin:false},{...input,ownerUid:'teacher-b'});
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].teacherUid,'teacher-a');assert.equal(r.rows[0].status,'missing');assert.deepEqual(r.history.map(x=>x.id),['older']);
});
test('administrator can view all or a selected teacher',async()=>{
 const all=await tracking(fixture(),{uid:'admin',admin:true},input);assert.equal(all.rows.length,2);assert.equal(all.history.length,2);
 const selected=await tracking(fixture(),{uid:'admin',admin:true},{...input,ownerUid:'teacher-b'});assert.equal(selected.rows.length,1);assert.deepEqual(selected.history.map(x=>x.id),['foreign']);
});
test('history tab stays own-only even for an administrator requesting another teacher',async()=>{
 const r=await tracking(fixture(),{uid:'teacher-a',admin:true},{...input,view:'history',ownerUid:'teacher-b'});
 assert.deepEqual(r.history.map(x=>x.id),['older']);assert.equal(r.rows[0].teacherUid,'teacher-a');assert.equal(r.rows.length,1);
});
test('stale sync never mislabels a lesson as missing',async()=>{
 const r=await tracking(fixture(false),{uid:'teacher-a',admin:false},input);assert.equal(r.source,'stale');assert.equal(r.rows[0].status,'unknown');assert.equal(r.history.length,0);
});
test('personal overview remains own-only; missing view rejects a regular teacher UID override',async()=>{
 const own=await tracking(fixture(),{uid:'teacher-a',admin:true},{...input,view:'overview',ownerUid:'teacher-b'});
 assert.equal(own.rows.length,1);assert.equal(own.rows[0].teacherUid,'teacher-a');
 const missing=await tracking(fixture(),{uid:'teacher-a',admin:false},{...input,view:'missing',ownerUid:'teacher-b'});
 assert.equal(missing.rows.length,1);assert.equal(missing.rows[0].teacherUid,'teacher-a');
});
test('date ranges remain bounded',async()=>{
 await assert.rejects(tracking(fixture(),{uid:'teacher-a',admin:false},{start:'2025-01-01',end:'2026-09-28'}));
});
