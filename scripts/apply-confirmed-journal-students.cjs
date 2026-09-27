'use strict';
// User-confirmed pages only; no roster, original bindings or Notion writes.
const admin=require('../portal-functions/node_modules/firebase-admin');
const {execFileSync}=require('node:child_process');
const {authorStudents}=require('../portal-functions/lesson-logs/http');
const apply=process.argv.includes('--apply-confirmed');
const target='1d1d8b62-80e7-80b5-81fc-000b6f0c13f4';
const source='1bad8b62-80e7-8130-a7bd-000b6f769665';
const confirmed=[['김주안','3e4d8b62-80e7-80a0-860f-d686116897c1'],['김서윤b','2e0d8b62-80e7-8014-aa49-d94f39dabe37']];
admin.initializeApp({credential:admin.credential.cert(require('/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json'))});
(async()=>{
 const db=admin.firestore(),collections={};
 for(const c of ['students','studentAliases','canonicalStudentMap'])collections[c]=(await db.collection(c).get()).docs.map(d=>({...d.data(),id:d.id}));
 const students=authorStudents({user:{role:'INSTRUCTOR'}},collections);
 const token=execFileSync('/opt/homebrew/bin/gcloud',['secrets','versions','access','latest','--secret=TEACHER_PORTAL_NOTION_TOKEN','--project=fir-lms-prod'],{encoding:'utf8'}).trim();
 const rows=[];
 for(const [name,pageId] of confirmed){
  const matches=students.filter(s=>s.name===name);if(matches.length!==1)throw Error('CANONICAL_STUDENT_AMBIGUOUS');
  const r=await fetch('https://api.notion.com/v1/pages/'+pageId,{headers:{Authorization:'Bearer '+token,'Notion-Version':'2025-09-03'},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('NOTION_HTTP_'+r.status);const p=await r.json();
  const title=Object.values(p.properties||{}).find(x=>x.type==='title')?.title.map(x=>x.plain_text||x.text?.content||'').join('').trim();
  if(p.archived||p.in_trash||p.parent?.data_source_id!==source||title!==name)throw Error('CONFIRMED_PAGE_CHANGED');
  rows.push({name,studentId:matches[0].studentId,pageId});
 }
 if(apply)await db.runTransaction(async tx=>{
  const checks=[];
  for(const row of rows){
   const ref=db.doc('portalLessonNotionMappings/student:'+row.studentId),old=(await tx.get(ref)).data();
   const duplicates=await tx.get(db.collection('portalLessonNotionMappings').where('pageId','==',row.pageId));
   if(duplicates.docs.some(d=>d.id!==ref.id)||old&&(old.pageId!==row.pageId||old.dataSourceId!==target))throw Error('MAPPING_CONFLICT');
   checks.push({ref,row,old});
  }
  for(const {ref,row,old} of checks)if(!old||old.verified!==true)tx.set(ref,{pageId:row.pageId,dataSourceId:target,verified:true,source:'user-confirmed-20260928',verifiedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
 });
 const verified=[];
 for(const row of rows){const m=(await db.doc('portalLessonNotionMappings/student:'+row.studentId).get()).data();verified.push({name:row.name,verified:m?.verified===true&&m.pageId===row.pageId&&m.dataSourceId===target});}
 const cfg=(await db.doc('portalLessonLogConfig/runtime').get()).data();
 console.log(JSON.stringify({applied:apply,students:verified,pilotCount:cfg.pilotUids?.length,productionTarget:cfg.notionDataSourceId===target,rosterChanged:false}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>admin.app().delete());
