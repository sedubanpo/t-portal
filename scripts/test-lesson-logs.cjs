const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const M=require('../portal-functions/lesson-logs/model');
const {createService}=require('../portal-functions/lesson-logs/service');
const {createWorker}=require('../portal-functions/lesson-logs/worker');
const {pagePayload}=require('../portal-functions/lesson-logs/notion');
const {buildScopedBootstrap}=require('../portal-functions/scope');
function memory(){
 const rows=new Map(),objects=new Map();let lock=Promise.resolve();
 const ref=path=>({path,id:path.split('/').at(-1),collection:name=>collection(path+'/'+name),get:async()=>snap(path)});
 const snap=path=>({id:path.split('/').at(-1),exists:rows.has(path),data:()=>structuredClone(rows.get(path))});
 const collection=(path,filters=[],ordering=[],start=null,max=Infinity)=>({doc:id=>ref(path+'/'+id),
   where:(key,op,value)=>collection(path,[...filters,[key,op,value]],ordering,start,max),
   orderBy:(key,dir)=>collection(path,filters,[...ordering,[key,dir]],start,max),
   startAfter:s=>collection(path,filters,ordering,s.id,max),limit:n=>collection(path,filters,ordering,start,n),
   async get(){let matches=[...rows.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1).map(snap).filter(s=>filters.every(([k,op,v])=>op==='=='?s.data()[k]===v:false));
     matches.sort((a,b)=>{for(const [k,dir]of ordering){const av=k==='__name__'?a.id:a.data()[k],bv=k==='__name__'?b.id:b.data()[k];if(av!==bv)return (av<bv?-1:1)*(dir==='desc'?-1:1);}return 0;});if(start)matches=matches.slice(matches.findIndex(s=>s.id===start)+1);matches=matches.slice(0,max);return {docs:matches,size:matches.length};}
 });
 const db={collection,runTransaction(fn){const task=lock.then(async()=>{const writes=[];const result=await fn({get:r=>r.get(),create:(r,v)=>{if(rows.has(r.path))throw Error('exists');writes.push(()=>rows.set(r.path,structuredClone(v)));},set:(r,v)=>writes.push(()=>rows.set(r.path,structuredClone(v))),update:(r,v)=>writes.push(()=>rows.set(r.path,{...rows.get(r.path),...structuredClone(v)}))});writes.forEach(w=>w());return result;});lock=task.catch(()=>{});return task;}};
 const bucket={file:path=>({async save(bytes,options){if(objects.has(path)){const e=Error();e.code=412;throw e;}objects.set(path,{bytes,metadata:options.metadata});},async getMetadata(){return [objects.get(path).metadata];},async download(){return [objects.get(path).bytes];}})};
 return {db,bucket,rows,objects};
}
const teacher={uid:'teacher-a',name:'테스트 강사',admin:false},other={uid:'teacher-b',name:'다른 강사',admin:false},admin={uid:'admin',name:'관리자',admin:true};
test('recoverable deletion hides content and prevents stale clients from recreating it',async()=>{
 const s=setup(),id=randomUUID();await s.service.create(teacher,id);
 const key=M.COLLECTION+'/'+id,original=s.rows.get(key);
 s.rows.set(key,{...original,status:'archived',deletedAt:123});
 for(const actor of [teacher,admin]){
  await assert.rejects(s.service.load(actor,id),{code:'NOT_FOUND'});
  await assert.rejects(s.service.create(actor,id),{code:'NOT_FOUND'});
  const list=await s.service.list(actor);assert.equal(list.rows.length,0);assert.deepEqual(list.deletedIds,[id]);
 }
 assert.deepEqual(s.rows.get(key).content,original.content);
});
test('verification fixture is user-bound, expiring and prohibited for production destinations',()=>{
 const {verificationFixture}=require('../portal-functions/lesson-logs/http');
 const cfg={enabled:false,environment:'isolated-notion-verification',notionDataSourceId:'2b099db0-0a45-4351-936f-20e8f5c5237a',verificationUids:['pilot'],verificationFixture:{uid:'pilot',expiresAt:2000,studentName:'가상',notionTeacherId:randomUUID(),notionStudentId:randomUUID()}};
 assert.equal(verificationFixture(cfg,'pilot',1000).studentId,'verification-fixture');
 for(const altered of [{...cfg,enabled:true},{...cfg,environment:'production'},{...cfg,notionDataSourceId:'operating-db'},{...cfg,verificationUids:[]}]){
 assert.equal(verificationFixture(altered,'pilot',1000),null);}
 assert.equal(verificationFixture(cfg,'other',1000),null);
 assert.equal(verificationFixture(cfg,'pilot',2001),null);
});
const content=()=>M.clean({studentId:'test-student',lessonDate:'2026-09-27',lessonType:'개별정규',title:'안전한 테스트 일지',content:'테스트 수업 내용',homework:'복습'});
test('administrator can author own journal without proxy authorship',async()=>{
 const s=setup(),id=randomUUID();await s.service.create(admin,id);
 await s.service.save(admin,id,{revision:0,mutationId:randomUUID(),content:content()});
 assert.equal((await s.service.load(admin,id)).ownerUid,admin.uid);
 await s.service.submit(admin,id,1);
 assert.equal((await s.service.load(admin,id)).status,'submitting');
 await assert.rejects(s.service.load(teacher,id),{code:'NOT_FOUND'});
 const archived=randomUUID();await s.service.create(admin,archived);await s.service.archive(admin,archived,0);
 assert.equal((await s.service.load(admin,archived)).status,'archived');
});
test('journal picker includes unassigned active students without changing account role',()=>{
 const {authorStudents}=require('../portal-functions/lesson-logs/http');
 const account={uid:'admin',user:{role:'ADMIN',status:'ACTIVE'},access:{}};
 const collections={students:[{id:'own',name:'담당',active:true},{id:'other',name:'미담당',active:true}],studentPermissions:[{studentId:'own',instructorUid:'admin',permission:'ALLOW'}]};
 assert.deepEqual(authorStudents(account,collections).map(s=>s.studentId),['own','other']);
 assert.equal(account.user.role,'ADMIN');
});
test('Notion destination is frozen at draft creation and rejects config changes',async()=>{
 const s=setup(),target={dataSourceId:'2b099db0-0a45-4351-936f-20e8f5c5237a',bucket:'fir-lms-prod-portal-lesson-files',environment:'test'};
 const opts={...s,destination:target,resolveStudent:async()=>({studentName:'QA'})};
 const service=createService(opts),id=randomUUID();
 await service.create(teacher,id);await service.save(teacher,id,{revision:0,mutationId:randomUUID(),content:content()});
 const changed=createService({...opts,destination:{...target,dataSourceId:'production'}});
 await assert.rejects(changed.submit(teacher,id,1),{code:'DESTINATION_CHANGED'});
 await service.submit(teacher,id,1);const row=await service.load(teacher,id);
 assert.equal(require('../portal-functions/lesson-logs/http').pinnedConfig(row).notionDataSourceId,target.dataSourceId);
 assert.throws(()=>require('../portal-functions/lesson-logs/http').pinnedConfig({...row,destination:null}),{code:'DESTINATION_REVIEW_REQUIRED'});
});
function setup(){const mem=memory(),stamp=()=>123456;
 const service=createService({...mem,stamp,resolveStudent:async(a,s)=>{if(s!=='test-student')M.fail('STUDENT_ACCESS_DENIED',403);return {studentName:'테스트 학생',notionTeacherId:randomUUID(),notionStudentId:randomUUID()};}});
 return {...mem,stamp,service};}
async function draft(s){const id=randomUUID();await s.service.create(teacher,id);await s.service.save(teacher,id,{revision:0,mutationId:randomUUID(),content:content()});return id;}
test('draft creation is idempotent; new fields, multiline content survive reload',async()=>{const s=setup(),id=await draft(s);await s.service.create(teacher,id);const d=await s.service.load(teacher,id);assert.deepEqual(d.content,content());assert.equal(d.revision,1);assert.equal(d.createdAt,123456);});
test('reordered requests and stale tabs cannot overwrite; mutation retry returns same revision',async()=>{const s=setup(),id=await draft(s),mutationId=randomUUID();const body={revision:1,mutationId,content:{...content(),content:'최신 내용'}};await s.service.save(teacher,id,body);await s.service.save(teacher,id,body);await assert.rejects(s.service.save(teacher,id,{...body,mutationId:randomUUID()}),{code:'REVISION_CONFLICT'});assert.equal((await s.service.load(teacher,id)).revision,2);await assert.rejects(s.service.save(teacher,id,{...body,content:content()}),{code:'MUTATION_REUSED'});});
test('owner isolation and admin cannot edit, submit or archive on behalf',async()=>{const s=setup(),id=await draft(s);await assert.rejects(s.service.load(other,id),{code:'NOT_FOUND'});assert.equal((await s.service.load(admin,id)).ownerUid,teacher.uid);for(const action of [()=>s.service.submit(admin,id,1),()=>s.service.save(admin,id,{revision:1,mutationId:randomUUID(),content:content()}),()=>s.service.archive(admin,id,1)])await assert.rejects(action(),{code:'OWNER_ONLY'});assert.throws(()=>M.actor({uid:'staff',user:{role:'STAFF'}}),{code:'PRIVATE_DRAFT_ACCESS_DENIED'});});
test('concurrent double submit freezes exactly one immutable source',async()=>{const s=setup(),id=await draft(s);await Promise.all([s.service.submit(teacher,id,1),s.service.submit(teacher,id,1)]);const d=await s.service.load(teacher,id);assert.equal(d.status,'submitting');assert.deepEqual(d.snapshot.content,content());await assert.rejects(s.service.save(teacher,id,{revision:1,mutationId:randomUUID(),content:content()}),{code:'NOT_EDITABLE'});});
test('missing attachments block submission; immutable upload and private download',async()=>{const s=setup(),id=await draft(s),fileId=randomUUID(),body={fileId,name:'test.pdf',base64:Buffer.from('%PDF-1.7\nfixture').toString('base64')};await s.service.save(teacher,id,{revision:1,mutationId:randomUUID(),content:{...content(),attachmentIds:[fileId]}});await assert.rejects(s.service.submit(teacher,id,2),{code:'FILE_UPLOAD_PENDING'});await s.service.upload(teacher,id,body);await s.service.upload(teacher,id,body);await assert.rejects(s.service.upload(teacher,id,{...body,base64:Buffer.from('%PDF-other').toString('base64')}),{code:'FILE_ID_REUSED'});await assert.rejects(s.service.download(other,id,fileId),{code:'NOT_FOUND'});assert.equal((await s.service.download(teacher,id,fileId)).mime,'application/pdf');await s.service.submit(teacher,id,2);assert.equal((await s.service.load(teacher,id)).snapshot.files.length,1);});
test('archive preserves content; no deletes are used',async()=>{const s=setup(),id=await draft(s);await s.service.archive(teacher,id,1);const d=await s.service.load(teacher,id);assert.equal(d.status,'archived');assert.deepEqual(d.content,content());});
test('failed storage write reserves hash but never becomes a submitted attachment',async()=>{
 const s=setup(),id=await draft(s),fileId=randomUUID();
 await s.service.save(teacher,id,{revision:1,mutationId:randomUUID(),content:{...content(),attachmentIds:[fileId]}});
 const failing=createService({...s,bucket:{file:()=>({save:async()=>{throw Error('storage unavailable');}})},resolveStudent:async()=>({studentName:'테스트 학생'})});
 await assert.rejects(failing.upload(teacher,id,{fileId,name:'fixture.pdf',base64:Buffer.from('%PDF-test').toString('base64')}));
 await assert.rejects(s.service.submit(teacher,id,2),{code:'FILE_UPLOAD_PENDING'});
 await assert.rejects(s.service.download(teacher,id,fileId),{code:'FILE_UPLOAD_PENDING'});
 await assert.rejects(s.service.upload(teacher,id,{fileId,name:'fixture.pdf',base64:Buffer.from('%PDF-different').toString('base64')}),{code:'FILE_ID_REUSED'});
 await s.service.upload(teacher,id,{fileId,name:'fixture.pdf',base64:Buffer.from('%PDF-test').toString('base64')});
 await s.service.submit(teacher,id,2);assert.equal((await s.service.load(teacher,id)).snapshot.files.length,1);
});
test('unknown and malformed fields, dates and executable uploads rejected',()=>{assert.throws(()=>M.complete({...content(),lessonDate:'2026-99-99'}),{code:'INVALID_DATE'});assert.throws(()=>M.fileBytes({fileId:randomUUID(),base64:Buffer.from('<svg onload=alert(1)>').toString('base64')}),{code:'FILE_TYPE_UNSUPPORTED'});assert.throws(()=>M.clean({content:'x'.repeat(12001)}),{code:'CONTENT_TOO_LONG'});assert.equal(M.clean({ownerUid:'attacker'}).ownerUid,undefined);});
test('Notion fails before create: source retained, admin retry creates one page',async()=>{const s=setup(),id=await draft(s);await s.service.submit(teacher,id,1);let failing=true,creates=0;const notion={preflight:async()=>{if(failing)throw Error('secret external error');},find:async()=>null,create:async()=>{creates++;return {id:'page-1'};}};const run=createWorker({...s,notion});await run(id);let d=await s.service.load(teacher,id);assert.equal(d.status,'sync_failed');assert.equal(d.lastError,'NOTION_SYNC_FAILED');assert.deepEqual(d.snapshot.content,content());failing=false;await s.service.retry(admin,id);await Promise.all([run(id),run(id)]);await run(id);d=await s.service.load(teacher,id);assert.equal(d.status,'submitted');assert.equal(creates,1);});
test('Notion accepted create but response lost: retry reconciles existing page, never duplicates',async()=>{const s=setup(),id=await draft(s);await s.service.submit(teacher,id,1);let page=null,creates=0;const notion={preflight:async()=>{},find:async()=>page,create:async()=>{page='accepted-page';creates++;throw Error('timeout');}};const run=createWorker({...s,notion});await run(id);assert.equal((await s.service.load(teacher,id)).sync.phase,'creating');await s.service.retry(teacher,id);await run(id);assert.equal((await s.service.load(teacher,id)).notionPageId,'accepted-page');assert.equal(creates,1);});
test('uncertain create with temporarily invisible page is quarantined, not recreated',async()=>{const s=setup(),id=await draft(s);await s.service.submit(teacher,id,1);let creates=0;const run=createWorker({...s,notion:{preflight:async()=>{},find:async()=>null,create:async()=>{creates++;throw Error('timeout');}}});await run(id);await s.service.retry(admin,id);await run(id);const d=await s.service.load(teacher,id);assert.equal(d.lastError,'NOTION_RESULT_UNCERTAIN');assert.equal(creates,1);});
test('attachments checkpoint before a single page creation',async()=>{const s=setup(),id=await draft(s),fileId=randomUUID();await s.service.save(teacher,id,{revision:1,mutationId:randomUUID(),content:{...content(),attachmentIds:[fileId]}});await s.service.upload(teacher,id,{fileId,name:'fixture.pdf',base64:Buffer.from('%PDF-test').toString('base64')});await s.service.submit(teacher,id,2);let count=0;const run=createWorker({...s,notion:{preflight:async()=>{},find:async()=>null,upload:async()=>({id:'upload-1',expiresAt:Date.now()+3600000}),create:async(_,snapshot,uploads)=>{count++;assert.equal(snapshot.files.length,1);assert.equal(uploads[fileId],'upload-1');return {id:'page'};}}});await run(id);assert.equal(count,0);await run(id);assert.equal(count,1);});
test('Notion payload writes new page only, fields and body preserved',()=>{const snapshot={content:{...content(),assessment:'평가',materials:'https://example.com'},studentName:'가상 학생',notionTeacherId:randomUUID(),notionStudentId:randomUUID(),files:[]};const p=pagePayload(randomUUID(),snapshot,'test-data-source',{});assert.equal(p.parent.data_source_id,'test-data-source');assert.equal(p.properties[' 숙제'].rich_text[0].text.content,'복습');assert.ok(p.children.some(b=>b.paragraph?.rich_text[0]?.text.content==='평가'));assert.equal(p.archived,undefined);});
test('existing student scope does not grant an unassigned teacher access',()=>{const result=buildScopedBootstrap({uid:'teacher-a',user:{role:'INSTRUCTOR'},access:{apps:{teacherPortal:true}}},{students:[{id:'test-student',name:'가상 학생',active:true}],studentPermissions:[{studentId:'test-student',instructorUid:'teacher-b',permission:'ALLOW'}]});assert.equal(result.studentList.length,0);});
test('list ignores a teacher-supplied owner UID; administrator status filtering works',async()=>{const s=setup(),a=await draft(s),b=randomUUID();await s.service.create(other,b);const mine=await s.service.list(teacher,{ownerUid:other.uid});assert.deepEqual(mine.rows.map(r=>r.id),[a]);assert.equal((await s.service.list(admin)).rows.length,2);await s.service.archive(teacher,a,1);assert.equal((await s.service.list(admin,{status:'archived'})).rows.length,1);});
test('legacy studentLogs and external Fillout records are never touched',async()=>{const s=setup();const legacy={content:'legacy unchanged',pageId:'existing'};s.rows.set('studentLogs/legacy',legacy);const id=await draft(s);await s.service.submit(teacher,id,1);assert.deepEqual(s.rows.get('studentLogs/legacy'),legacy);assert.ok([...s.rows.keys()].filter(k=>k!=='studentLogs/legacy').every(k=>k.startsWith(M.COLLECTION+'/')));});
test('HTTP rejects unauthenticated, inactive and STAFF accounts before private reads',async()=>{
 const {makeHandler}=require('../portal-functions/lesson-logs/http');
 for(const role of ['STAFF','INSTRUCTOR','ADMIN']){
  const s=setup();s.rows.set('users/u',{role,status:role==='STAFF'?'ACTIVE':'INACTIVE',name:'가상 계정'});s.rows.set('userAppAccess/u',{apps:{teacherPortal:true}});
  const fake={firestore:()=>s.db,auth:()=>({verifyIdToken:async()=>({uid:'u'})})};const handler=makeHandler(fake);
  const response={set(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'POST',headers:{authorization:'Bearer test'},body:{action:'list',isAdmin:true}},response);assert.equal(response.code,403);
 }
 const response={set(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await makeHandler({})({method:'POST',headers:{},body:{}},response);assert.equal(response.code,401);
});
test('disabled public feature permits only server-configured verification UIDs; pilot gate includes admins',async()=>{
 const {makeHandler}=require('../portal-functions/lesson-logs/http'),s=setup();
 for(const [uid,role] of [['qa','INSTRUCTOR'],['regular','INSTRUCTOR'],['boss','ADMIN']]){s.rows.set('users/'+uid,{role,status:'ACTIVE',name:uid});s.rows.set('userAppAccess/'+uid,{apps:{teacherPortal:true}});}
 const firestore=Object.assign(()=>s.db,{FieldValue:{serverTimestamp:()=>123}});
 const handler=makeHandler({firestore,storage:()=>({bucket:()=>s.bucket}),auth:()=>({verifyIdToken:async token=>({uid:token})})});
 const request=async uid=>{const r={code:200,set(){},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};await handler({method:'POST',headers:{authorization:'Bearer '+uid},body:{action:'list',verificationUids:[uid]}},r);return r.code;};
 s.rows.set('portalLessonLogConfig/runtime',{enabled:false,verificationUids:['qa']});
 assert.equal(await request('qa'),200);assert.equal(await request('regular'),503);assert.equal(await request('boss'),503);
 s.rows.set('portalLessonLogConfig/runtime',{enabled:true,pilotUids:['qa']});
 assert.equal(await request('qa'),200);assert.equal(await request('boss'),503);
 s.rows.set('portalLessonLogConfig/runtime',{enabled:false,verificationUids:[]});assert.equal(await request('qa'),503);
});
