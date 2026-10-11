'use strict';
const M=require('./model');
// Only an explicit administrator-confirmed binding may fill an absent mapping.
// Never match students by name or replace an existing mapping.
async function resolveStudentMapping({db,student,dataSourceId,verifyPage,stamp}) {
  const ref=db.collection('portalLessonNotionMappings').doc('student:'+student.studentId);
  const current=await ref.get();
  if(current.exists)return current.data();
  const bindingRef=db.collection('notionStudentBindings').doc(student.studentId);
  const binding=(await bindingRef.get()).data();
  if(!binding?.confirmedAt||binding.studentDocId!==student.studentId||!binding.publicPageId)M.fail('NOTION_STUDENT_MAPPING_REQUIRED',409);
  M.uuid(binding.publicPageId);
  await verifyPage(binding.publicPageId,student.name,dataSourceId);
  return db.runTransaction(async tx=>{
    const latest=await tx.get(ref),confirmed=(await tx.get(bindingRef)).data();
    if(latest.exists)return latest.data();
    if(!confirmed?.confirmedAt||confirmed.studentDocId!==student.studentId||confirmed.publicPageId!==binding.publicPageId||String(confirmed.confirmedAt)!==String(binding.confirmedAt))M.fail('NOTION_STUDENT_MAPPING_REQUIRED',409);
    const duplicates=await tx.get(db.collection('portalLessonNotionMappings').where('pageId','==',binding.publicPageId));
    if(!duplicates.empty)M.fail('NOTION_STUDENT_MAPPING_REQUIRED',409);
    const mapping={pageId:binding.publicPageId,dataSourceId,verified:true,source:'confirmed-public-notion-binding',verifiedAt:stamp()};
    tx.create(ref,mapping);return mapping;
  });
}
function studentPageVerifier({token,fetcher=fetch}) {
  return async(pageId,name,dataSourceId)=>{
    async function get(path){
      const response=await fetcher('https://api.notion.com/v1/'+path,{headers:{Authorization:'Bearer '+token,'Notion-Version':'2025-09-03'},signal:AbortSignal.timeout(8000)});
      if(!response.ok)M.fail('NOTION_CONNECTION_CHECK_FAILED',503);
      return response.json();
    }
    const [schema,page]=await Promise.all([get('data_sources/'+dataSourceId),get('pages/'+pageId)]);
    const expected=schema.properties?.['학생명']?.relation?.data_source_id;
    const title=Object.values(page.properties||{}).find(p=>p.type==='title')?.title?.map(t=>t.plain_text||t.text?.content||'').join('').trim();
    if(!expected||page.parent?.data_source_id!==expected||page.archived||page.in_trash||title!==String(name).trim())M.fail('NOTION_STUDENT_MAPPING_REQUIRED',409);
  };
}
module.exports={resolveStudentMapping,studentPageVerifier};
