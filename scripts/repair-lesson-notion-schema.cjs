'use strict';
// Deliberate maintenance command. Default is read-only; no journal content is logged.
// GOOGLE_APPLICATION_CREDENTIALS must identify an authorized operator credential.
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const admin=require('../portal-functions/node_modules/firebase-admin');
const target='1d1d8b62-80e7-80b5-81fc-000b6f0c13f4',property='Portal draft ID';
const apply=process.argv.includes('--apply');
const token=process.env.TEACHER_PORTAL_NOTION_TOKEN||execFileSync('gcloud',['secrets','versions','access','latest','--secret=TEACHER_PORTAL_NOTION_TOKEN','--project=fir-lms-prod'],{encoding:'utf8'}).trim();
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'fir-lms-prod'});
async function request(path,method='GET',body){const r=await fetch('https://api.notion.com/v1/'+path,{method,headers:{Authorization:'Bearer '+token,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('NOTION_HTTP_'+r.status);return r.json();}
(async()=>{
 const db=admin.firestore(),cfg=(await db.collection('portalLessonLogConfig').doc('runtime').get()).data();assert.equal(cfg.notionDataSourceId,target);
 const schema=await request('data_sources/'+target);const current=schema.properties[property];if(current)assert.equal(current.type,'rich_text');
 const submitted=await db.collection('portalLessonDrafts').where('status','==','submitted').get();
 const known=submitted.docs.filter(d=>d.data().destination?.dataSourceId===target&&d.data().notionPageId&&!d.data().deletedAt);
 console.log(JSON.stringify({apply,missingIdentityProperty:!current,knownSubmittedPages:known.length}));
 if(!apply)return;
 if(!current)await request('data_sources/'+target,'PATCH',{properties:{[property]:{rich_text:{}}}});
 const after=await request('data_sources/'+target);assert.equal(after.properties[property].type,'rich_text');
 for(const [name,p]of Object.entries(schema.properties)){assert.equal(after.properties[name]?.id,p.id);assert.equal(after.properties[name]?.type,p.type);}
 // Restore the identifiers on known successful pages too, without changing lesson content.
 let restored=0,archivedSkipped=0;
 for(const d of known){const pageId=d.data().notionPageId,page=await request('pages/'+pageId);assert.equal(page.parent?.data_source_id,target);if(page.archived||page.in_trash){archivedSkipped++;continue;}
   const existing=(page.properties[property]?.rich_text||[]).map(t=>t.plain_text||t.text?.content||'').join('');assert.ok(!existing||existing===d.id,'IDENTITY_CONFLICT');
   if(!existing){await request('pages/'+pageId,'PATCH',{properties:{[property]:{rich_text:[{type:'text',text:{content:d.id}}]}}});restored++;}
 }
 await require('../portal-functions/lesson-logs/notion').createNotion({token,dataSourceId:target}).preflight();
 console.log(JSON.stringify({schemaVerified:true,otherPropertiesPreserved:true,restoredKnownIdentifiers:restored,archivedSkipped}));
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>admin.app().delete());
