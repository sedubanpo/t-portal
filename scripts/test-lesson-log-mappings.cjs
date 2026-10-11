const test=require('node:test'),assert=require('node:assert/strict');
const {resolveStudentMapping,studentPageVerifier}=require('../portal-functions/lesson-logs/mappings');
const sid='11111111-1111-4111-8111-111111111111',pid='22222222-2222-4222-8222-222222222222';
function fixture({existing,binding,duplicate=false}={}){
 const rows=new Map();if(existing)rows.set('portalLessonNotionMappings/student:'+sid,existing);
 rows.set('notionStudentBindings/'+sid,binding===undefined?{confirmedAt:'today',studentDocId:sid,publicPageId:pid}:binding);
 const snap=k=>({exists:rows.has(k),data:()=>rows.get(k)});
 const db={collection:c=>({doc:id=>({key:c+'/'+id,get:async()=>snap(c+'/'+id)}),where:()=>({query:true})}),runTransaction:async fn=>fn({get:async ref=>ref.query?{empty:!duplicate}:snap(ref.key),create:(ref,v)=>rows.set(ref.key,v)})};
 return {db,rows,student:{studentId:sid,name:'학생'},dataSourceId:'destination',stamp:()=>123,verifyPage:async()=>{}};
}
test('confirmed student binding fills absent mapping once',async()=>{const f=fixture();let n=0;f.verifyPage=async(p,name,d)=>{n++;assert.equal(p,pid);assert.equal(name,'학생');assert.equal(d,'destination')};assert.equal((await resolveStudentMapping(f)).pageId,pid);await resolveStudentMapping(f);assert.equal(n,1)});
test('unconfirmed or mismatched binding cannot authorize submission',async()=>{for(const binding of [null,{publicPageId:pid},{confirmedAt:'today',studentDocId:'wrong',publicPageId:pid}])await assert.rejects(resolveStudentMapping(fixture({binding})),{code:'NOTION_STUDENT_MAPPING_REQUIRED'})});
test('existing unverified mapping is never overwritten',async()=>{const f=fixture({existing:{verified:false}});f.verifyPage=()=>assert.fail();assert.equal((await resolveStudentMapping(f)).verified,false)});
test('duplicate student relation is rejected',async()=>assert.rejects(resolveStudentMapping(fixture({duplicate:true})),{code:'NOTION_STUDENT_MAPPING_REQUIRED'}));
test('changed binding during verification is rejected',async()=>{const f=fixture();f.verifyPage=async()=>f.rows.set('notionStudentBindings/'+sid,{confirmedAt:'changed',studentDocId:sid,publicPageId:pid});await assert.rejects(resolveStudentMapping(f),{code:'NOTION_STUDENT_MAPPING_REQUIRED'})});
test('Notion failure does not create mapping',async()=>{const f=fixture();f.verifyPage=async()=>{throw Error('unavailable')};await assert.rejects(resolveStudentMapping(f));assert(!f.rows.has('portalLessonNotionMappings/student:'+sid))});
test('Notion title, relation source and archived state must match',async()=>{const schema={properties:{학생명:{relation:{data_source_id:'students'}}}},good={parent:{data_source_id:'students'},properties:{name:{type:'title',title:[{plain_text:'학생 '}]}},archived:false};for(const change of [null,{archived:true},{in_trash:true},{parent:{data_source_id:'other'}},{properties:{name:{type:'title',title:[{plain_text:'다른학생'}]}}}]){const page={...good,...change};const verify=studentPageVerifier({token:'test',fetcher:async url=>({ok:true,json:async()=>url.includes('/pages/')?page:schema})});if(change)await assert.rejects(verify(pid,'학생','destination'),{code:'NOTION_STUDENT_MAPPING_REQUIRED'});else await verify(pid,'학생','destination');}});
