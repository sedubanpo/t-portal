'use strict';
// Approved additive setup. No journal pages, student assignments or legacy bindings are modified.
const admin=require('../portal-functions/node_modules/firebase-admin');
const {execFileSync}=require('node:child_process');
const {authorStudents}=require('../portal-functions/lesson-logs/http');
const apply=process.argv.includes('--apply-approved-setup');
const target='1d1d8b62-80e7-80b5-81fc-000b6f0c13f4';
const teacherSource='c0b433c2-9cd1-48e8-bf78-ca5df4161bc9',studentSource='1bad8b62-80e7-8130-a7bd-000b6f769665';
const norm=x=>String(x||'').replace(/-/g,'').toLowerCase();
const uuid=x=>norm(x).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
const token=execFileSync('/opt/homebrew/bin/gcloud',['secrets','versions','access','latest','--secret=TEACHER_PORTAL_NOTION_TOKEN','--project=fir-lms-prod'],{encoding:'utf8'}).trim();
admin.initializeApp({credential:admin.credential.cert(require('/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json'))});
async function request(path,method='GET',body){
 for(let i=0;i<4;i++){const r=await fetch('https://api.notion.com/v1/'+path,{method,headers:{Authorization:'Bearer '+token,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(r.status===429){await new Promise(r=>setTimeout(r,1500));continue;}if(!r.ok)throw Error('NOTION_HTTP_'+r.status);return r.json();}throw Error('NOTION_RATE_LIMIT');
}
async function pages(source){const map=new Map();let cursor;do{const r=await request('data_sources/'+source+'/query','POST',{page_size:100,...(cursor?{start_cursor:cursor}:{})});for(const p of r.results)if(!p.archived&&!p.in_trash)map.set(norm(p.id),p);cursor=r.has_more?r.next_cursor:null;}while(cursor);return map;}
(async()=>{
 const db=admin.firestore(),rows={};
 for(const name of ['users','userProfiles','userAppAccess','students','studentAliases','canonicalStudentMap','notionStudentBindings']){const s=await db.collection(name).get();rows[name]=s.docs.map(d=>({...d.data(),id:d.id}));}
 const schema=await request('data_sources/'+target);
 if(schema.properties['강사명']?.relation?.data_source_id!==teacherSource||schema.properties['학생명']?.relation?.data_source_id!==studentSource)throw Error('RELATION_TARGET_CONFLICT');
 if(schema.properties['Portal draft ID']&&schema.properties['Portal draft ID'].type!=='rich_text')throw Error('DRAFT_ID_TYPE_CONFLICT');
 const [tp,sp]=await Promise.all([pages(teacherSource),pages(studentSource)]);
 const proposed=[],skipped={teachers:0,students:0},profiles=new Map(rows.userProfiles.map(p=>[p.id,p])),access=new Map(rows.userAppAccess.map(p=>[p.id,p]));
 const title=p=>Object.values(p.properties).find(v=>v.type==='title')?.title.map(v=>v.plain_text||v.text?.content||'').join('').trim();
 for(const u of rows.users){
  if(!['INSTRUCTOR','ADMIN','SUPER_ADMIN'].includes(u.role)||u.status!=='ACTIVE'||access.get(u.id)?.apps?.teacherPortal!==true)continue;
  let id;try{id=new URL(profiles.get(u.id)?.links?.lessonLog).searchParams.get('teacher');}catch{}
  const p=tp.get(norm(id));if(!p||title(p).replace(/\s*T$/,'')!==String(u.name||'').trim()){skipped.teachers++;continue;}
  proposed.push({key:'teacher:'+u.id,pageId:uuid(p.id),source:'existing-fillout-teacher-id'});
 }
 const bindings=new Map(rows.notionStudentBindings.map(b=>[b.id,b]));
 const students=authorStudents({user:{role:'INSTRUCTOR'}},rows);
 for(const s of students){const b=bindings.get(s.studentId),p=sp.get(norm(b?.publicPageId));
  if(!b?.confirmedAt||b.studentDocId!==s.studentId||!p||title(p)!==s.name.trim()){skipped.students++;continue;}
  proposed.push({key:'student:'+s.studentId,pageId:uuid(p.id),source:'confirmed-public-notion-binding'});
 }
 const repeated=new Set(proposed.filter(a=>proposed.some(b=>a.key!==b.key&&a.pageId===b.pageId)).map(p=>p.pageId));
 const safe=proposed.filter(p=>!repeated.has(p.pageId));
 let written=0;
 if(apply){
  if(!schema.properties['Portal draft ID'])await request('data_sources/'+target,'PATCH',{properties:{'Portal draft ID':{rich_text:{}}}});
  for(const p of safe)await db.runTransaction(async tx=>{const ref=db.collection('portalLessonNotionMappings').doc(p.key),old=(await tx.get(ref)).data();
   if(old&&(old.pageId!==p.pageId||old.dataSourceId!==target))throw Error('EXISTING_MAPPING_CONFLICT');
   if(!old){tx.create(ref,{pageId:p.pageId,dataSourceId:target,verified:true,source:p.source,verifiedAt:admin.firestore.FieldValue.serverTimestamp()});written++;}
  });
 }
 const pilotTeacher=safe.some(p=>p.key==='teacher:teacher_01089945993'),pilotStudent=safe.some(p=>p.key==='student:d399b2b7-9b9b-436e-b8f2-d4fa27d61b24');
 console.log(JSON.stringify({applied:apply,teachers:safe.filter(p=>p.key.startsWith('teacher:')).length,students:safe.filter(p=>p.key.startsWith('student:')).length,skipped,duplicateTargets:repeated.size,written,pilotTeacher,pilotStudent,schemaReady:apply||!!schema.properties['Portal draft ID']}));
 await admin.app().delete();
})().catch(e=>{console.error(e.message);process.exitCode=1;});
