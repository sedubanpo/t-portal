'use strict';
// Explicit user approval: recoverable cleanup of these four test journals only.
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const admin=require('../portal-functions/node_modules/firebase-admin');
const targets={
 '80460819-c699-4f8a-a1e6-f7735e7a4c65':'1',
 '7be107c4-b851-4884-bf9f-260fc6846e77':'복구 테스트',
 '39b91a46-4430-44b3-ac82-7b23d39f5071':'[PC 검증·미제출] 자동저장 복구',
 '05c7eea2-cd0e-4e6f-9855-422567ac03c3':'[연동 검증·실제 수업 아님]'
};
const apply=process.argv.includes('--apply');
admin.initializeApp({credential:admin.credential.cert(require('/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json'))});
(async()=>{
 const db=admin.firestore(),rows=[];
 for(const [id,title] of Object.entries(targets)){
  const ref=db.collection('portalLessonDrafts').doc(id),snap=await ref.get(),d=snap.data();
  assert.ok(d);assert.equal(d.ownerUid,'teacher_01089945993');assert.equal(d.content.title,title);
  assert.ok(['submitted','archived'].includes(d.status),'No in-flight journals');
  rows.push({ref,d,id,title});
 }
 if(!apply){console.log(JSON.stringify({dryRun:true,count:rows.length,rows:rows.map(({id,title,d})=>({id,title,alreadyDeleted:!!d.deletedAt,notion:!!d.notionPageId,attachments:d.content.attachmentIds.length}))}));return;}
 const token=execFileSync('/opt/homebrew/bin/gcloud',['secrets','versions','access','latest','--secret=TEACHER_PORTAL_NOTION_TOKEN','--project=fir-lms-prod'],{encoding:'utf8'}).trim();
 for(const {ref,d,id} of rows){
  if(d.notionPageId){
   const response=await fetch('https://api.notion.com/v1/pages/'+d.notionPageId,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:JSON.stringify({in_trash:true}),signal:AbortSignal.timeout(30000)});
   assert.ok(response.ok,'Notion trash HTTP '+response.status);assert.equal((await response.json()).in_trash,true);
  }
  await db.runTransaction(async tx=>{
   const current=(await tx.get(ref)).data();assert.equal(current.ownerUid,d.ownerUid);assert.equal(current.content.title,d.content.title);
   if(current.deletedAt)return;
   tx.create(db.collection('portalLessonDeletionBackups').doc(id),{original:current,deletedAt:admin.firestore.FieldValue.serverTimestamp(),reason:'User-approved test cleanup 2026-09-28'});
   tx.set(db.collection('portalLessonDeletedDrafts').doc(id),{ownerUid:d.ownerUid,deletedAt:admin.firestore.FieldValue.serverTimestamp()});
   tx.update(ref,{status:'archived',deletedAt:admin.firestore.FieldValue.serverTimestamp(),deletionReason:'User-approved test cleanup; attachments retained privately'});
  });
 }
 for(const {ref} of rows)assert.ok((await ref.get()).data().deletedAt);
 console.log(JSON.stringify({success:true,hiddenJournals:rows.length,notionPagesTrashed:rows.filter(r=>r.d.notionPageId).length,attachmentsRetained:true,originalsBackedUp:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>admin.app().delete());
