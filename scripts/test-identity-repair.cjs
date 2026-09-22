const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ensureTeacherIdentity}=require('../portal-functions/identity');
const account=()=>({uid:'test-uid',user:{name:'테스트',role:'INSTRUCTOR',status:'ACTIVE',loginId:'01012345678'},profile:{},access:{apps:{teacherPortal:true}}});
const auth={uid:'test-uid',email:'01012345678@sedu-auth.local',disabled:false};
function harness(seed={}) {
 const tables={teachers:[],portal_identities:[],...seed}, writes=[];
 const rest=async(path,options={})=>{
  const url=new URL(path,'https://test/'),table=url.pathname.slice(1);
  assert.ok(['teachers','portal_identities'].includes(table),'repair must never write lessons or signatures');
  if(options.method==='POST'){
   writes.push(table);const key=table==='teachers'?'id':'firebase_uid';
   if(!tables[table].some(row=>row[key]===options.body[key]))tables[table].push({...options.body});return [];
  }
  return tables[table].filter(row=>[...url.searchParams].every(([k,v])=>k==='select'||String(row[k])===v.slice(3)));
 };return {tables,writes,rest};
}
test('missing master and identity repair is idempotent and own-scope only',async()=>{
 const h=harness();assert.equal((await ensureTeacherIdentity(account(),auth,h.rest)).provisioned,true);
 assert.equal((await ensureTeacherIdentity(account(),auth,h.rest)).provisioned,false);
 assert.deepEqual(h.writes,['teachers','portal_identities']);
 assert.equal(h.tables.portal_identities[0].role,'teacher');
 assert.equal(h.tables.portal_identities[0].all_teacher_access,false);
 assert.equal(h.tables.portal_identities[0].all_student_access,false);
});
test('disabled, denied app, UID mismatch and inactive profile cannot repair',async()=>{
 for(const mutate of [a=>a.user.status='INACTIVE',a=>a.access.apps.teacherPortal=false,a=>a.profile.active=false]){
  const a=account();mutate(a);const h=harness();await assert.rejects(ensureTeacherIdentity(a,auth,h.rest));assert.equal(h.writes.length,0);
 }
 for(const user of [{...auth,disabled:true},{...auth,uid:'other'}])await assert.rejects(ensureTeacherIdentity(account(),user,harness().rest));
});
test('staff/admin/student repair never provisions teacher writes',async()=>{
 for(const role of ['STAFF','ADMIN','STUDENT']){const a=account();a.user.role=role;const h=harness();assert.equal((await ensureTeacherIdentity(a,auth,h.rest)).skipped,true);assert.equal(h.writes.length,0);}
});
test('mismatched login, name collisions, inactive teacher and owner conflicts fail closed',async()=>{
 const bad=account();bad.user.loginId='01099999999';await assert.rejects(ensureTeacherIdentity(bad,auth,harness().rest));
 const teacher={id:'t1',display_name:'테스트',normalized_name:'테스트',active:true,phone:'01012345678'};
 for(const seed of [
  {teachers:[{...teacher,phone:'01099999999'}]},
  {teachers:[teacher,{...teacher,id:'t2'}]},
  {teachers:[{...teacher,active:false}]},
  {teachers:[teacher],portal_identities:[{firebase_uid:'other',teacher_id:'t1'}]},
  {portal_identities:[{firebase_uid:'test-uid',teacher_id:'t1',teacher_name:'다른강사',active:true,role:'teacher'}]},
 ]){const h=harness(seed);await assert.rejects(ensureTeacherIdentity(account(),auth,h.rest));assert.equal(h.writes.length,0);}
});
test('concurrent first requests converge on one teacher and identity',async()=>{
 const h=harness();await Promise.all([ensureTeacherIdentity(account(),auth,h.rest),ensureTeacherIdentity(account(),auth,h.rest)]);
 assert.equal(h.tables.teachers.length,1);assert.equal(h.tables.portal_identities.length,1);
});
