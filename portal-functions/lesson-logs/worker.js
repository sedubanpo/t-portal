'use strict';
const {randomUUID}=require('node:crypto');
const {COLLECTION,fail}=require('./model');
function createWorker({db,bucket,stamp,notion,now=Date.now}) {
  return async function synchronize(id) {
    const ref=db.collection(COLLECTION).doc(id),token=randomUUID();
    let d=await db.runTransaction(async tx=>{const s=await tx.get(ref);if(!s.exists)return null;const v=s.data();if(v.status!=='submitting'||v.sync?.leaseUntil>now())return null;
      const sync={...v.sync,token,leaseUntil:now()+120000,attempts:(v.sync?.attempts||0)+1};tx.update(ref,{sync});return {...v,sync};});
    if(!d)return;
    async function update(changes){await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.data()?.sync?.token!==token)fail('LEASE_LOST',409);tx.update(ref,{...changes,updatedAt:stamp()});});}
    try {
      await notion.preflight();
      const existing=d.notionPageId||await notion.find(id);
      if(existing){await update({status:'submitted',notionPageId:existing,syncedAt:stamp(),lastError:null,sync:{...d.sync,phase:'created',leaseUntil:0}});return;}
      // A timeout after POST is ambiguous. Never blindly create a second page.
      if(d.sync.phase==='creating')fail('NOTION_RESULT_UNCERTAIN',409);
      const uploads={...d.sync.uploads};
      const pending=d.snapshot.files.find(f=>!uploads[f.id]||uploads[f.id].expiresAt<now()+180000);
      if(pending){const [bytes]=await bucket.file(pending.path).download();uploads[pending.id]=await notion.upload(pending,bytes);
        await update({sync:{...d.sync,uploads,leaseUntil:0},lastError:null});return;}
      d.sync={...d.sync,uploads,phase:'creating'};
      await update({sync:d.sync});
      const page=await notion.create(id,d.snapshot,Object.fromEntries(Object.entries(uploads).map(([k,v])=>[k,v.id])));
      await update({status:'submitted',notionPageId:page.id,syncedAt:stamp(),lastError:null,sync:{...d.sync,phase:'created',leaseUntil:0}});
    } catch(e) {
      if(e.code==='LEASE_LOST')return;
      // Stable error codes only; never persist upstream bodies, student text or tokens.
      const allowed=['NOTION_SCHEMA_SETUP_REQUIRED','NOTION_DUPLICATE_REVIEW','NOTION_RESULT_UNCERTAIN','NOTION_FILE_PENDING'];
      await update({status:'sync_failed',lastError:allowed.includes(e.code)?e.code:'NOTION_SYNC_FAILED',sync:{...d.sync,leaseUntil:0}});
    }
  };
}
module.exports={createWorker};
