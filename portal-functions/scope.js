const text=v=>String(v??'').trim();
const {staffReadAccess}=require('./staff-access');
const active=r=> !(r.active===false||r.isActive===false||['INACTIVE','WITHDRAWN','DELETED','GRADUATED'].includes(text(r.status||r.enrollmentStatus||r.enrollment_status).toUpperCase())) && (r.active===true||r.isActive===true||['ACTIVE','ENROLLED','CURRENT'].includes(text(r.status||r.enrollmentStatus||r.enrollment_status).toUpperCase()));
function buildScopedBootstrap(account,collections,payload={}) {
  const u=account.user||{},p=account.profile||{},a=account.access||{};
  const isAdmin=['ADMIN','SUPER_ADMIN'].includes(text(u.role).toUpperCase()) || staffReadAccess(account);
  const keys=new Set();
  const add=v=>{if(text(v))keys.add(text(v));const phone=text(v).replace(/\D/g,'');if(phone.length>=8)keys.add(phone);};
  [account.uid,u.email,u.phone,u.loginId,u.teacherId,u.instructorId,p.email,p.phone,p.loginId,p.teacherId,p.instructorId,p.synChroInstructorId,p.synchroInstructorId,p.supabaseInstructorId,a.instructorId,a.teacherId,a.synchroS?.supabaseInstructorId].forEach(add);
  (account.aliases||[]).forEach(r=>[r.id,r.loginId,r.phone,r.email,r.teacherId,r.instructorId,r.alias].forEach(add));
  const matches=v=>!!text(v)&&(keys.has(text(v))||keys.has(text(v).replace(/\D/g,'')));
  const aliasToCanonical=Object.create(null),canonicalToAliases=Object.create(null);
  [...(collections.studentAliases||[]),...(collections.canonicalStudentMap||[])].forEach(r=>{
    const id=text(r.canonicalStudentId||r.canonical_student_id||r.canonicalId||r.studentId||r.id);
    let aliases=r.aliasStudentIds||r.alias_student_ids||r.aliases||r.studentIds||[];
    if(typeof aliases==='string') aliases=aliases.split(/[,\s]+/);
    if(!id||!Array.isArray(aliases))return;
    aliases.map(text).filter(v=>v&&v!==id).forEach(v=>{
      if(aliasToCanonical[v]&&aliasToCanonical[v]!==id) throw new Error('AMBIGUOUS_ALIAS');
      aliasToCanonical[v]=id;
      canonicalToAliases[id]=Array.from(new Set([...(canonicalToAliases[id]||[]),v]));
    });
  });
  const canonical=id=>aliasToCanonical[text(id)]||text(id);
  const studentId=r=>canonical(r.studentId||r.student_id||r.id);
  const permitted=new Set(),homeroomIds=new Set();
  (collections.studentPermissions||[]).forEach(r=>{
    const permission=text(r.permission||r.permissionType||r.type).toUpperCase();
    if(r.active===false||r.isActive===false||(permission&&!['ALLOW','READ'].includes(permission))||['REVOKED','INACTIVE','DISABLED'].includes(text(r.status).toUpperCase()))return;
    if(['instructorUid','instructorId','teacherId','uid','userId','ownerUid'].some(k=>matches(r[k])))permitted.add(studentId(r));
  });
  const roomMatches=r=>(r.instructorIds||[]).some(matches)||(r.assignments||[]).some(v=>matches(v.instructorUid||v.instructorId||v.teacherId));
  (collections.studentHomerooms||[]).filter(roomMatches).forEach(r=>homeroomIds.add(studentId(r)));
  const groups=new Map();
  (collections.students||[]).forEach(r=>{const id=studentId(r);if(id)groups.set(id,[...(groups.get(id)||[]),r]);});
  const students=[];
  groups.forEach((rows,id)=>{
    if(!rows.some(active)||(!isAdmin&&!permitted.has(id)&&!homeroomIds.has(id)))return;
    const base=rows.find(r=>text(r.studentId||r.id)===id)||rows.find(active)||rows[0];
    const value=k=>text(base[k])||text(rows.find(r=>text(r[k]))?.[k]);
    students.push({studentId:id,canonicalStudentId:id,aliasStudentIds:canonicalToAliases[id]||[],name:value('name')||value('studentName'),studentName:value('studentName')||value('name'),school:value('school'),grade:value('grade'),gender:value('gender'),active:true,dataSource:'firestore:students'});
  });
  const ids=new Set(students.map(r=>r.studentId));
  const rooms=(collections.studentHomerooms||[]).filter(r=>ids.has(studentId(r))&&(isAdmin||homeroomIds.has(studentId(r)))).map(r=>({studentId:studentId(r),canonicalStudentId:studentId(r),instructorIds:(r.instructorIds||[]).filter(v=>isAdmin||matches(v)),assignments:(r.assignments||[]).filter(v=>isAdmin||matches(v.instructorUid||v.instructorId||v.teacherId)).map(v=>({instructorUid:text(v.instructorUid),instructorId:text(v.instructorId),teacherId:text(v.teacherId),subject:text(v.subject)}))}));
  const mappings=Object.keys(canonicalToAliases).filter(id=>ids.has(id)).map(id=>({canonicalStudentId:id,aliasStudentIds:canonicalToAliases[id]}));
  const scopedAliases=Object.fromEntries(mappings.flatMap(r=>r.aliasStudentIds.map(id=>[id,r.canonicalStudentId])));
  const teacherId=text(p.instructorId||u.instructorId||p.teacherId||u.teacherId||p.loginId||u.loginId||account.uid);
  const name=text(p.name||p.displayName||u.name||u.displayName);
  const flatRooms=rooms.flatMap(r=>{
    const student=students.find(s=>s.studentId===r.studentId);
    const assignments=r.assignments.length?r.assignments:r.instructorIds.map(instructorId=>({instructorId,subject:''}));
    return assignments.map(v=>({studentId:r.studentId,canonicalStudentId:r.studentId,studentName:student.name,school:student.school,grade:student.grade,instructorId:!isAdmin?teacherId:text(v.instructorId||v.teacherId||v.instructorUid),subject:v.subject,instructorName:!isAdmin?name:''}));
  });
  return {success:true,masterSource:'firebase-server-scoped',teacherId,studentList:payload.includeStudentList===false?[]:students,homeroomStudents:payload.includeHomeroom===false?[]:flatRooms,slmsTeacherMap:payload.includeSlms===false?{}:{[name.replace(/\s+/g,'')]:{teacherId,name,subject:text(p.subject||u.subject)}},studentAliasMappings:payload.includeStudentAliases===true?mappings:[],studentAliasResolver:{aliasToCanonical:scopedAliases,canonicalToAliases:Object.fromEntries(mappings.map(r=>[r.canonicalStudentId,r.aliasStudentIds])),compositeToCanonical:{},mappingCount:mappings.length,aliasCount:Object.keys(scopedAliases).length},studentScope:{returnedStudents:students.length},common:[],notices:[]};
}
module.exports={buildScopedBootstrap};
