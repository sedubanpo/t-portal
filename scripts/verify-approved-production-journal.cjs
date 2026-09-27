'use strict';
// Read-only verification of the single explicitly approved production QA journal.
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const admin=require('../portal-functions/node_modules/firebase-admin');
const title='[연동 검증·실제 수업 아님]';
const target='1d1d8b62-80e7-80b5-81fc-000b6f0c13f4';
const token=execFileSync('/opt/homebrew/bin/gcloud',['secrets','versions','access','latest','--secret=TEACHER_PORTAL_NOTION_TOKEN','--project=fir-lms-prod'],{encoding:'utf8'}).trim();
admin.initializeApp({credential:admin.credential.cert(require('/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json'))});
async function notion(path,body){const r=await fetch('https://api.notion.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});assert.ok(r.ok,'Notion HTTP '+r.status);return r.json();}
const text=xs=>(xs||[]).map(x=>x.plain_text||x.text?.content||'').join('');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
(async()=>{
 const db=admin.firestore();
 const q=await db.collection('portalLessonDrafts').where('ownerUid','==','teacher_01089945993').get();
 const matches=q.docs.filter(d=>d.data().content?.title===title);assert.equal(matches.length,1,'Exactly one approved QA draft');
 const doc=matches[0],row=doc.data();assert.equal(row.status,'submitted','QA must be submitted');
 assert.equal(row.destination?.dataSourceId,target);assert.equal(row.snapshot?.destination?.dataSourceId,target);
 assert.equal(row.snapshot.notionTeacherId,'17fd8b62-80e7-808d-9766-df0f05f0e60f');
 assert.equal(row.snapshot.notionStudentId,'1bad8b62-80e7-81a2-9ca8-ddf30b85b109');
 const found=await notion('data_sources/'+target+'/query',{filter:{property:'Portal draft ID',rich_text:{equals:doc.id}},page_size:2});
 assert.equal(found.results.length,1);assert.equal(found.has_more,false);assert.equal(found.results[0].id,row.notionPageId);
 const page=found.results[0],p=page.properties,c=row.snapshot.content;
 assert.equal(text(p['수업 제목(클릭)'].title),title);assert.equal(text(p['Portal draft ID'].rich_text),doc.id);
 for(const [field,key] of [['수업내용','content'],[' 숙제','homework'],['지난 숙제 피드백','feedback']])assert.equal(text(p[field].rich_text),c[key]);
 assert.equal(p['날짜'].date.start,c.lessonDate);assert.equal(p['수업유형'].select.name,c.lessonType);
 assert.deepEqual(p['강사명'].relation.map(r=>r.id),[row.snapshot.notionTeacherId]);
 assert.deepEqual(p['학생명'].relation.map(r=>r.id),[row.snapshot.notionStudentId]);
 const blocks=await notion('blocks/'+row.notionPageId+'/children?page_size=100');assert.equal(blocks.has_more,false);
 const paragraphs=blocks.results.filter(b=>b.type==='paragraph').map(b=>text(b.paragraph.rich_text));
 for(const key of ['content','materials','homework','feedback','assessment'])assert.ok(paragraphs.includes(c[key]),'Body preserved: '+key);
 const attached=blocks.results.filter(b=>['image','file','pdf'].includes(b.type));assert.equal(attached.length,2);assert.equal(row.snapshot.files.length,2);
 const evidence=[];
 for(const f of row.snapshot.files){
  assert.ok(['portal-qa.png','portal-qa.pdf'].includes(f.name));
  const b=attached.find(b=>text(b[b.type].caption)===f.name);assert.ok(b,'Notion attachment exists');
  const r=await fetch(b[b.type].file.url,{signal:AbortSignal.timeout(30000)});assert.ok(r.ok,'Attachment readable');
  const bytes=Buffer.from(await r.arrayBuffer());assert.equal(hash(bytes),hash(fs.readFileSync('/tmp/portal-attachment-qa/'+f.name)),'Attachment bytes match');
  evidence.push({name:f.name,bytes:bytes.length,sha256Matches:true});
 }
 console.log(JSON.stringify({success:true,draftId:doc.id,notionPageId:row.notionPageId,status:row.status,uniquePages:1,fieldsAndBodyMatch:true,attachments:evidence,readOnly:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>admin.app().delete());
