'use strict';
const {randomUUID}=require('node:crypto');
const M = require('./model');
// All persistence is server-only. Clients never receive a service credential or a public file URL.
function createService({db,bucket,stamp,resolveStudent,destination=null}) {
  const ref = id => db.collection(M.COLLECTION).doc(M.uuid(id));
  const txDraft = (id,fn) => db.runTransaction(async tx => {const r=ref(id),s=await tx.get(r); return fn(tx,r,s.exists?s.data():null);});
  const load = async (a,id) => {const s=await ref(id).get(),d=s.exists?s.data():null;M.access(a,d);return d;};
  return {
    load,
    async list(a,{ownerUid,cursor,status,queue=false}={}) {
      if(queue&&!a.admin)M.fail('ADMIN_ONLY',403);
      if(queue&&status&&!['draft','submitting','sync_failed'].includes(status))M.fail('INVALID_STATUS');
      let q=db.collection(M.COLLECTION);
      if(queue&&!status)q=q.where('status','in',['draft','submitting','sync_failed']);
      if (!a.admin || ownerUid) q=q.where('ownerUid','==',a.admin?String(ownerUid):a.uid);
      if(status){if(!['draft','submitting','submitted','sync_failed','archived'].includes(status))M.fail('INVALID_STATUS');q=q.where('status','==',status);}
      q=q.orderBy('updatedAt','desc').orderBy('__name__','desc');
      if(cursor){const s=await ref(cursor).get();const d=s.data();M.access(a,d?{...d,deletedAt:null}:null);q=q.startAfter(s);}
      const snap=await q.limit(40).get();
      return {rows:snap.docs.filter(s=>!s.data().deletedAt).map(s=>{const d=s.data();return {id:s.id,ownerUid:d.ownerUid,teacherName:d.teacherName,studentName:d.studentName||'',studentId:d.content.studentId,lessonType:d.content.lessonType,attachmentCount:(d.content.attachmentIds||[]).length,status:d.status,title:d.content.title,lessonDate:d.content.lessonDate,updatedAt:d.updatedAt,lastError:d.lastError,...(queue?{submittedAt:d.submittedAt,attempts:d.sync?.attempts||0,nextAttemptAt:d.sync?.nextAttemptAt||0,lastRetriedAt:d.lastRetriedAt||null,lastRetriedBy:d.lastRetriedBy||null}: {})};}),deletedIds:snap.docs.filter(s=>s.data().deletedAt).map(s=>s.id),cursor:snap.size===40?snap.docs.at(-1).id:null};
    },
    async create(a,id) {
      return txDraft(id,(tx,r,d)=>{if(d){M.access(a,d,true);return d;}
        const row={id,ownerUid:a.uid,teacherName:a.name,destination,content:M.clean(),revision:0,status:'draft',createdAt:stamp(),updatedAt:stamp(),submittedAt:null,lastError:null,notionPageId:null};tx.create(r,row);return row;});
    },
    async save(a,id,input) {
      const content=M.clean(input.content),mutationId=M.uuid(input.mutationId),hash=M.digest(content);
      const before=await load(a,id);M.access(a,before,true);
      const student=content.studentId?(content.studentId===before.content.studentId?{studentName:before.studentName}:await resolveStudent(a,content.studentId,false)):null;
      return txDraft(id,async(tx,r,d)=>{
        M.access(a,d,true);
        const receipt=r.collection('mutations').doc(mutationId),prior=await tx.get(receipt);
        if(prior.exists){if(prior.data().hash!==hash)M.fail('MUTATION_REUSED',409);return {revision:prior.data().revision};}
        if(d.status!=='draft')M.fail('NOT_EDITABLE',409);
        if(input.revision!==d.revision)M.fail('REVISION_CONFLICT',409);
        const revision=d.revision+1;tx.update(r,{content,studentName:student?.studentName||'',revision,updatedAt:stamp(),lastError:null});tx.create(receipt,{hash,revision,createdAt:stamp()});return {revision};
      });
    },
    async archive(a,id,revision) {
      return txDraft(id,(tx,r,d)=>{M.access(a,d,true);if(d.status==='archived')return {};
        if(d.status!=='draft'||d.revision!==revision)M.fail('REVISION_CONFLICT',409);
        tx.update(r,{status:'archived',updatedAt:stamp(),archivedAt:stamp()});return {};});
    },
    async upload(a,id,body) {
      const d=await load(a,id);M.access(a,d,true);if(d.status!=='draft')M.fail('NOT_EDITABLE',409);
      if(!d.content.attachmentIds.includes(body.fileId))M.fail('FILE_NOT_IN_DRAFT',409);
      const {bytes,...meta}=M.fileBytes(body),fileId=body.fileId;
      const path=`lesson-log-files/${a.uid}/${id}/${fileId}`,file=bucket.file(path);
      // Reserve the identity before storage I/O; concurrent/retried requests cannot
      // reuse the same ID with different bytes, even on storage emulators.
      await txDraft(id,async(tx,r,current)=>{
        M.access(a,current,true);if(current.status!=='draft'||!current.content.attachmentIds.includes(fileId))M.fail('NOT_EDITABLE',409);
        const manifest=r.collection('files').doc(fileId),prior=await tx.get(manifest);
        if(prior.exists){if(prior.data().sha256!==meta.sha256)M.fail('FILE_ID_REUSED',409);}
        else tx.create(manifest,{...meta,id:fileId,path,uploadedAt:null});
      });
      // Immutable objects: a reused ID can never replace a submitted attachment.
      try{await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:meta.mime,cacheControl:'private,no-store',metadata:{sha256:meta.sha256}}});}
      catch(e){if(Number(e.code)!==412)throw e;const [old]=await file.getMetadata();if(old.metadata?.sha256!==meta.sha256)M.fail('FILE_ID_REUSED',409);}
      await txDraft(id,(tx,r,current)=>{M.access(a,current,true);if(current.status!=='draft')M.fail('NOT_EDITABLE',409);if(!current.content.attachmentIds.includes(fileId))M.fail('FILE_NOT_IN_DRAFT',409);tx.set(r.collection('files').doc(fileId),{...meta,id:fileId,path,uploadedAt:stamp()});});
      return {id:fileId,...meta};
    },
    async download(a,id,fileId) {
      const d=await load(a,id);M.uuid(fileId);if(!d.content.attachmentIds.includes(fileId))M.fail('NOT_FOUND',404);
      const s=await ref(id).collection('files').doc(fileId).get();if(!s.exists)M.fail('NOT_FOUND',404);
      const f=s.data();if(!f.uploadedAt)M.fail('FILE_UPLOAD_PENDING',409);const [bytes]=await bucket.file(f.path).download();return {bytes,mime:f.mime,name:f.name};
    },
    async submit(a,id,revision,review=null) {
      if(review!==null&&!a.admin)M.fail('ADMIN_ONLY',403);
      const draft=await load(a,id);M.access(a,draft,review===null);
      if(['submitting','submitted','sync_failed'].includes(draft.status))return {status:draft.status};
      if(destination&&JSON.stringify(draft.destination)!==JSON.stringify(destination))M.fail('DESTINATION_CHANGED',409);
      const content=review===null?draft.content:M.clean({...draft.content,title:review.title,content:review.content});
      M.complete(content);
      // Relation IDs come from a verified server mapping, never a browser-provided Notion page ID.
      const resolved=await resolveStudent(review===null?a:{uid:draft.ownerUid,name:draft.teacherName,admin:false},content.studentId);
      return txDraft(id,async(tx,r,d)=>{
        M.access(a,d,review===null);
        if(['submitting','submitted','sync_failed'].includes(d.status))return {status:d.status};
        if(d.status!=='draft'||d.revision!==revision||d.revision!==draft.revision)M.fail('REVISION_CONFLICT',409);
        const files=[];for(const id of d.content.attachmentIds){const s=await tx.get(r.collection('files').doc(id));if(!s.exists||!s.data().uploadedAt)M.fail('FILE_UPLOAD_PENDING',409);files.push(s.data());}
        if(review!==null)tx.create(r.collection('submissionHistory').doc(randomUUID()),{actorUid:a.uid,ownerUid:d.ownerUid,at:stamp(),previousContent:d.content,previousRevision:d.revision});
        tx.update(r,{...(review!==null?{content,revision:d.revision+1,submittedBy:a.uid,adminSubmitted:true}:{}),status:'submitting',submittedAt:stamp(),updatedAt:stamp(),studentName:resolved.studentName,lastError:null,snapshot:{destination:d.destination,content,revision:review===null?d.revision:d.revision+1,teacherName:d.teacherName,...resolved,files},sync:{phase:'new',leaseUntil:0,attempts:0}});
        return {status:'submitting'};
      });
    },
    async retry(a,id) {
      return txDraft(id,(tx,r,d)=>{M.access(a,d);if(d.status==='submitted'||d.status==='submitting')return {status:d.status,queued:false};
        if(d.status!=='sync_failed'||!d.snapshot)M.fail('NOT_RETRYABLE',409);
        // Keep the frozen source and the ambiguous-create phase; a retry is not new authorship.
        tx.update(r,{status:'submitting',updatedAt:stamp(),lastRetriedAt:stamp(),lastRetriedBy:a.uid,
          sync:{...d.sync,leaseUntil:0,nextAttemptAt:0,failures:0}});
        tx.create(r.collection('retryHistory').doc(randomUUID()),{actorUid:a.uid,admin:a.admin===true,at:stamp(),previousError:d.lastError||null});
        return {status:'submitting',queued:true};});
    }
  };
}
async function retryBatch(service,a,ids){
  if(!a.admin)M.fail('ADMIN_ONLY',403);
  if(!Array.isArray(ids)||!ids.length||ids.length>40)M.fail('INVALID_BATCH');
  ids=[...new Set(ids.map(M.uuid))];
  const results=[];
  for(const id of ids){try{results.push({id,...await service.retry(a,id)});}catch(e){results.push({id,error:['NOT_FOUND','NOT_RETRYABLE'].includes(e.code)?e.code:'RETRY_FAILED'});}}
  return {results};
}
module.exports={createService,retryBatch};
