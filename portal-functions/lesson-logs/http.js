'use strict';
const {inactive}=require('../staff-access');
const {buildScopedBootstrap}=require('../scope');
const M=require('./model');
const {createService,retryBatch}=require('./service');
const {createWorker}=require('./worker');
const {createNotion}=require('./notion');
const API_MESSAGES={FEATURE_DISABLED:'새 수업일지는 준비 중입니다. 기존 수업일지를 이용해 주세요.',PRIVATE_DRAFT_ACCESS_DENIED:'초안 열람 권한이 없습니다.',OWNER_ONLY:'작성자만 수정·제출할 수 있습니다.',NOT_FOUND:'일지를 찾을 수 없습니다.',REVISION_CONFLICT:'다른 창에서 내용이 변경됐습니다. 복구본을 확인해 주세요.',REQUIRED_FIELDS:'학생, 수업일, 제목과 수업 내용을 확인해 주세요.',NOTION_MAPPING_REQUIRED:'학생·강사 Notion 연결을 관리자가 확인해야 합니다. 초안은 보관됩니다.',FILE_UPLOAD_PENDING:'첨부 파일 전송을 먼저 완료해 주세요.',NOT_EDITABLE:'제출 또는 보관한 내용은 수정할 수 없습니다.'};
function wire(v){if(v&&typeof v.toDate==='function')return v.toDate().toISOString();if(Array.isArray(v))return v.map(wire);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,wire(x)]));return v;}
API_MESSAGES.DESTINATION_CHANGED='이 초안은 이전 전송 환경에서 작성됐습니다. 원본은 보관되며, 현재 환경에서 새 일지를 작성해 주세요.';
API_MESSAGES.DESTINATION_REVIEW_REQUIRED='전송 대상 확인이 필요합니다. 원본을 보관하고 자동 전송을 중단했습니다.';
async function students(db,account){
  const collections={};
  await Promise.all(['students','studentAliases','canonicalStudentMap'].map(async name=>{const snap=await db.collection(name).limit(20001).get();if(snap.size>20000)M.fail('SOURCE_LIMIT',503);collections[name]=snap.docs.map(d=>({...d.data(),id:d.id}));}));
  return authorStudents(account,collections);
}
// Approved all-active-student picker only; never changes actor or draft access.
function authorStudents(account,collections){
  return buildScopedBootstrap({...account,user:{...account.user,role:'ADMIN'}},collections,{includeHomeroom:false,includeSlms:false}).studentList.map(({studentId,name,school,grade})=>({studentId,name,school,grade}));
}
function verificationFixture(cfg,uid,now=Date.now()){
  const f=cfg.verificationFixture;
  if(!f||cfg.enabled!==false||cfg.environment!=='isolated-notion-verification'||
    cfg.notionDataSourceId!=='2b099db0-0a45-4351-936f-20e8f5c5237a'||
    !cfg.verificationUids?.includes(uid)||f.uid!==uid||!(f.expiresAt>now))return null;
  return {studentId:'verification-fixture',name:String(f.studentName)+' · 테스트',school:'운영 연결 변경 없음',grade:'',
    notionTeacherId:M.uuid(f.notionTeacherId),notionStudentId:M.uuid(f.notionStudentId)};
}
async function settings(db,uid){const s=await db.collection('portalLessonLogConfig').doc('runtime').get();const cfg=s.data()||{};if(cfg.enabled!==true&&!(uid&&Array.isArray(cfg.verificationUids)&&cfg.verificationUids.includes(uid)))M.fail('FEATURE_DISABLED',503);return cfg;}
function worker(admin,cfg){return createWorker({db:admin.firestore(),bucket:admin.storage().bucket(cfg.bucket),stamp:()=>admin.firestore.FieldValue.serverTimestamp(),notion:createNotion({token:process.env.TEACHER_PORTAL_NOTION_TOKEN,dataSourceId:cfg.notionDataSourceId})});}
function makeHandler(admin){return async(req,res)=>{
  res.set('Cache-Control','private, no-store');res.set('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  try{
    const token=String(req.headers.authorization||'').match(/^Bearer (\S+)$/)?.[1];if(!token)M.fail('UNAUTHENTICATED',401);
    const claims=await admin.auth().verifyIdToken(token,true),db=admin.firestore();
    const [u,p,x]=await Promise.all(['users','userProfiles','userAppAccess'].map(c=>db.collection(c).doc(claims.uid).get()));
    const account={uid:claims.uid,user:u.data()||{},profile:p.data()||{},access:x.data()||{}};
    const active=String(account.user.status||'').toUpperCase()==='ACTIVE'||account.user.active===true||account.user.isActive===true;
    if(!u.exists||!active||[account.user,account.profile,account.access].some(r=>inactive(r)||r.disabled===true))M.fail('PRIVATE_DRAFT_ACCESS_DENIED',403);
    const a=M.actor(account);if(!a.admin&&account.access.apps?.teacherPortal!==true)M.fail('PRIVATE_DRAFT_ACCESS_DENIED',403);
    const cfg=await settings(db,a.uid);
    if(cfg.enabled===true&&Array.isArray(cfg.pilotUids)&&!cfg.pilotUids.includes(a.uid))M.fail('FEATURE_DISABLED',503);
    const body=req.body||{};
    const fixture=verificationFixture(cfg,a.uid);
    if(cfg.verificationFixture?.uid===a.uid&&!fixture)M.fail('FEATURE_DISABLED',503);
    const destination={dataSourceId:cfg.notionDataSourceId,bucket:cfg.bucket,environment:cfg.environment||'production'};
    const service=createService({db,destination,bucket:admin.storage().bucket(cfg.bucket),stamp:()=>admin.firestore.FieldValue.serverTimestamp(),resolveStudent:async(actor,studentId,mapping=true)=>{
      if(fixture){if(studentId!==fixture.studentId)M.fail('STUDENT_ACCESS_DENIED',403);return {studentName:fixture.name,...(mapping?{notionTeacherId:fixture.notionTeacherId,notionStudentId:fixture.notionStudentId}:{})};}
      const permitted=await students(db,account),student=permitted.find(s=>s.studentId===studentId);if(!student)M.fail('STUDENT_ACCESS_DENIED',403);
      if(!mapping)return {studentName:student.name};
      if(studentId.includes('/'))M.fail('INVALID_ID');
      const [t,s]=await Promise.all([`teacher:${actor.uid}`,`student:${studentId}`].map(key=>db.collection('portalLessonNotionMappings').doc(key).get()));
      if(t.data()?.verified!==true||s.data()?.verified!==true)M.fail('NOTION_MAPPING_REQUIRED',409);
      if(t.data().dataSourceId!==cfg.notionDataSourceId||s.data().dataSourceId!==cfg.notionDataSourceId)M.fail('NOTION_MAPPING_REQUIRED',409);
      return {studentName:student.name,notionTeacherId:M.uuid(t.data().pageId),notionStudentId:M.uuid(s.data().pageId)};
    }});
    let result;
    switch(body.action){
      case 'tracking':result=await require('./tracking').tracking(db,a,body);break;
      case 'init':{
        const removed=await db.collection('portalLessonDeletedDrafts').where('ownerUid','==',a.uid).get();
        const teachers=a.admin?await db.collection('users').where('role','in',['INSTRUCTOR','ADMIN']).limit(1000).get():null;
        const teacherSubjects=new Map();
        if(teachers){for(let i=0;i<teachers.docs.length;i+=100){const part=teachers.docs.slice(i,i+100),profiles=await db.getAll(...part.map(d=>db.collection('userProfiles').doc(d.id)));part.forEach((d,n)=>{const p=profiles[n].data()||{},u=d.data();teacherSubjects.set(d.id,String(p.subject||u.subject||p.department||u.department||'').slice(0,80));});}}
        result={actor:a,deletedIds:removed.docs.map(d=>d.id),verification:!!fixture,students:fixture?[{studentId:fixture.studentId,name:fixture.name,school:fixture.school,grade:''}]:await students(db,account),teachers:teachers?[{uid:a.uid,name:a.name,subject:String(account.profile.subject||account.user.subject||account.profile.department||account.user.department||'').slice(0,80)},...teachers.docs.filter(d=>d.id!==a.uid).map(d=>({uid:d.id,name:String(d.data().name||'강사'),subject:teacherSubjects.get(d.id)||''}))]:[],lessonTypes:M.TYPES,maxFileBytes:M.MAX_FILE};break;
      }
      case 'syncQueue':result=await service.list(a,{...body,queue:true});break;
      case 'retryBatch':result=await retryBatch(service,a,body.ids);break;
      case 'list':result=await service.list(a,body);break;
      case 'get':{
        result=await service.load(a,body.id);delete result.sync;
        const files=await Promise.all(result.content.attachmentIds.map(id=>db.collection(M.COLLECTION).doc(body.id).collection('files').doc(id).get()));
        result.files=files.filter(s=>s.exists&&s.data().uploadedAt).map(s=>{const {id,name,mime,size}=s.data();return {id,name,mime,size,uploaded:true};});break;
      }
      case 'create':await service.create(a,body.id);result=await service.load(a,body.id);break;
      case 'save':result=await service.save(a,body.id,body);break;
      case 'archive':result=await service.archive(a,body.id,body.revision);break;
      case 'upload':result=await service.upload(a,body.id,body);break;
      case 'download':{const f=await service.download(a,body.id,body.fileId);res.set('Content-Type',f.mime);res.set('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);return res.send(f.bytes);}
      case 'adminSubmit':if(!a.admin)M.fail('ADMIN_ONLY',403);if(!body.review||typeof body.review.title!=='string'||typeof body.review.content!=='string')M.fail('INVALID_CONTENT');result=await service.submit(a,body.id,body.revision,body.review);break;
      case 'submit':result=await service.submit(a,body.id,body.revision);break;
      case 'retry':result=await service.retry(a,body.id);break;
      default:M.fail('UNKNOWN_ACTION');
    }
    // Deliberately do not return private storage paths or relation mappings to the browser.
    if(result.snapshot)result.snapshot={revision:result.snapshot.revision,files:result.snapshot.files.map(({id,name,mime,size})=>({id,name,mime,size}))};
    return res.json({success:true,data:wire(result)});
  }catch(e){const auth=String(e.code||'').startsWith('auth/');const code=auth?'UNAUTHENTICATED':e.statusCode?e.code:'SERVICE_UNAVAILABLE';return res.status(auth?401:e.statusCode||503).json({success:false,error:code,message:API_MESSAGES[code]||'요청을 완료하지 못했습니다. 작성 내용은 지우지 말고 다시 시도해 주세요.'});}
};}
async function drain(admin){const db=admin.firestore();const cfg=(await db.collection('portalLessonLogConfig').doc('runtime').get()).data()||{};
  if(cfg.enabled!==true&&!(Array.isArray(cfg.verificationUids)&&cfg.verificationUids.length))return;
  if(!cfg.notionDataSourceId||!cfg.bucket)return;
  // Page past leased/backoff rows, so the first five cannot starve the queue.
  let cursor=null,processed=0;const deadline=Date.now()+450000;
  while(processed<5&&Date.now()<deadline){
    let query=db.collection(M.COLLECTION).where('status','==','submitting').orderBy('__name__').limit(100);
    if(cursor)query=query.startAfter(cursor);
    const queue=await query.get();if(!queue.size)break;
    for(const d of queue.docs){const row=d.data();cursor=d;
      if(row.deletedAt||row.sync?.leaseUntil>Date.now()||row.sync?.nextAttemptAt>Date.now())continue;
      if(cfg.enabled!==true&&!cfg.verificationUids.includes(row.ownerUid))continue;
      try{await processDraft(admin,d.id);}catch(_){console.warn('lesson-log-drain-item-failed',{draftId:d.id});}
      if(++processed>=5||Date.now()>=deadline)break;
    }
    if(queue.size<100)break;
  }
}
function pinnedConfig(row){
  const d=row.snapshot?.destination;
  if(!d||JSON.stringify(d)!==JSON.stringify(row.destination)||!['2b099db0-0a45-4351-936f-20e8f5c5237a','1d1d8b62-80e7-80b5-81fc-000b6f0c13f4'].includes(d.dataSourceId)||d.bucket!=='fir-lms-prod-portal-lesson-files')M.fail('DESTINATION_REVIEW_REQUIRED',409);
  return {notionDataSourceId:d.dataSourceId,bucket:d.bucket};
}
async function processDraft(admin,id){const db=admin.firestore(),ref=db.collection(M.COLLECTION).doc(id),row=(await ref.get()).data();if(!row||row.deletedAt||row.status!=='submitting'||row.sync?.nextAttemptAt>Date.now())return;try{await settings(db,row.ownerUid);}catch(e){if(e.code==='FEATURE_DISABLED')return;throw e;}
  let target;try{target=pinnedConfig(row);}catch(e){await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.data()?.status==='submitting'&&!s.data()?.sync?.leaseUntil)tx.update(ref,{status:'sync_failed',lastError:'DESTINATION_REVIEW_REQUIRED',updatedAt:admin.firestore.FieldValue.serverTimestamp()});});return;}
  await worker(admin,target)(id);
}
module.exports={makeHandler,drain,students,authorStudents,processDraft,verificationFixture,pinnedConfig};
