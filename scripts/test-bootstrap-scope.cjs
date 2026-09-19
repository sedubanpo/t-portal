const assert=require('node:assert/strict');
const {buildScopedBootstrap:build}=require('../portal-functions/scope');
const teacher={uid:'teacher-one',user:{role:'INSTRUCTOR',name:'강사'},profile:{instructorId:'I1'},access:{apps:{teacherPortal:true}}};
const data={students:[{id:'A',name:'동명이인',active:true},{id:'B',name:'동명이인',active:true},{id:'C',active:false},{id:'D',active:true},{id:'E',active:true}],studentPermissions:[{studentId:'A',instructorId:'I1',permission:'ALLOW'},{studentId:'B',instructorId:'I2',permission:'ALLOW'},{studentId:'C',instructorId:'I1',permission:'ALLOW'},{studentId:'E',instructorId:'I1',permission:'DENY'}],studentHomerooms:[{studentId:'D',instructorIds:['I1','I2'],assignments:[{instructorId:'I1',subject:'수학'},{instructorId:'I2',subject:'영어'}]}]};
assert.deepEqual(build(teacher,data).studentList.map(r=>r.studentId),['A','D']);
assert.deepEqual(build(teacher,data,{teacherName:'다른 강사',uid:'admin',isAdmin:true}).studentList.map(r=>r.studentId),['A','D']);
assert.deepEqual(build({...teacher,user:{role:'ADMIN'}},data).studentList.map(r=>r.studentId),['A','B','D','E']);
assert.equal(build(teacher,data,{includeStudentList:false}).studentList.length,0);
assert.equal(build(teacher,data,{includeHomeroom:false}).homeroomStudents.length,0);
const aliased={...data,studentAliases:[{canonicalStudentId:'A',aliasStudentIds:['OLD']}],studentPermissions:[{studentId:'OLD',instructorUid:'teacher-one',permission:'READ'}]};
assert.deepEqual(build(teacher,aliased).studentList.map(r=>r.studentId),['A','D']);
assert.throws(()=>build(teacher,{...aliased,canonicalStudentMap:[{canonicalStudentId:'B',aliasStudentIds:['OLD']}]}),/AMBIGUOUS_ALIAS/);
console.log('PASS: scoped students, same-name isolation, inactive and revoked exclusions, aliases, forged identity, include flags');
const {staffReadAccess}=require('../portal-functions/staff-access');
const staff={...teacher,user:{role:'STAFF',status:'ACTIVE'}};
assert.equal(staffReadAccess(staff),true);
assert.deepEqual(build(staff,data).studentList.map(r=>r.studentId),['A','B','D','E']);
for(const role of ['INSTRUCTOR','DESK','ADMIN']) assert.equal(staffReadAccess({...staff,user:{role,status:'ACTIVE'}}),false);
assert.equal(staffReadAccess({...staff,user:{role:'STAFF'}}),false);
assert.equal(staffReadAccess({...staff,access:{apps:{teacherPortal:false}}}),false);
for(const field of ['user','profile','access']) {
  assert.equal(staffReadAccess({...staff,[field]:{...staff[field],status:'INACTIVE'}}),false);
  assert.equal(staffReadAccess({...staff,[field]:{...staff[field],active:false}}),false);
}
console.log('PASS: active STAFF read-only eligibility, inactive/missing-state/DESK/teacher/app-denied exclusions');
