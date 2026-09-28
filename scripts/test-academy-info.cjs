const {test}=require('node:test');
const assert=require('node:assert/strict');
const {canEdit,validate,handle}=require('../portal-functions/academy-info');
const account=role=>({uid:'test',user:{role},profile:{},access:{}});
test('only active administrators can edit',()=>{
  for(const role of ['ADMIN','SUPER_ADMIN'])assert(canEdit(account(role)));
  for(const role of ['INSTRUCTOR','STAFF','DESK','DISABLED',''])assert(!canEdit(account(role)));
  for(const field of ['user','profile','access']){const a=account('ADMIN');a[field].active=false;assert(!canEdit(a));}
});
test('bounded plain text validation',()=>{
  assert.deepEqual(validate({revision:0,items:[{label:' 연락처 ',value:' test '}]}),[{label:'연락처',value:'test'}]);
  for(const input of [{items:[]},{revision:-1,items:[]},{revision:0,items:[null]},{revision:0,items:[{label:'',value:'a'}]},{revision:0,items:[{label:'a',value:'x'.repeat(4001)}]},{revision:0,items:Array(41).fill({label:'a',value:'b'})}])assert.throws(()=>validate(input));
});
function fake(){let current;const revisions=[];const ref={get:async()=>({data:()=>current}),collection:()=>({doc:id=>({id})})};return {collection:()=>({doc:()=>ref}),runTransaction:async fn=>fn({get:ref.get,set:(r,v)=>r===ref?current=v:revisions.push(v)}),revisions};}
test('read, save, revision conflict, history, instructor denial',async()=>{
 const db=fake();assert.deepEqual((await handle(db,account('INSTRUCTOR'),{mode:'academyInfoRead'})).items,[]);
 await assert.rejects(handle(db,account('INSTRUCTOR'),{mode:'academyInfoSave',revision:0,items:[]}),{statusCode:403});
 const result=await handle(db,account('ADMIN'),{mode:'academyInfoSave',revision:0,items:[{label:'test',value:'test'}]});
 assert.equal(result.revision,1);assert.equal(db.revisions.length,1);assert(!('updatedBy' in result));
 await assert.rejects(handle(db,account('ADMIN'),{mode:'academyInfoSave',revision:0,items:[]}),{statusCode:409});
 assert.equal((await handle(db,account('INSTRUCTOR'),{mode:'academyInfoRead'})).editable,false);
});
test('login integration preserves authentication hooks',()=>{
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
 for(const id of ['inputId','inputPw','remember-id','remember-pw'])assert(html.includes(`id="${id}"`));
 assert(html.includes('autocomplete="current-password"'));assert(html.includes('onclick="tryLogin()"'));
});
