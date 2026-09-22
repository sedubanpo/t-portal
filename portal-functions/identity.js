const {createHash} = require('node:crypto');
const {inactive} = require('./staff-access');
const normalize = value => String(value || '').trim().replace(/\s*T$/i, '').replace(/\s+/g, '').toLowerCase();
function fail(message) { const error = new Error(message); error.statusCode = 409; throw error; }

// Only server-verified account data enters this function. No browser teacher name.
async function ensureTeacherIdentity(account, authUser, rest) {
  if (String(account.user.role).toUpperCase() !== 'INSTRUCTOR') return {success:true, skipped:true};
  if (authUser.uid !== account.uid || authUser.disabled || String(account.user.status).toUpperCase() !== 'ACTIVE'
      || account.access.apps?.teacherPortal !== true || [account.user,account.profile,account.access].some(inactive)) {
    fail('활성 강사 포털 계정만 연결할 수 있습니다.');
  }
  const name = String(account.user.name || '').trim();
  if (!name) fail('강사 이름 확인이 필요합니다.');
  const query = (table, params) => table+'?'+new URLSearchParams(params);
  const identities = await rest(query('portal_identities',{select:'firebase_uid,teacher_id,teacher_name,role,active,all_teacher_access,all_student_access',firebase_uid:'eq.'+account.uid}));
  if (identities.length) {
    const row=identities[0];
    if (!row.active || !row.teacher_id || !['teacher','homeroom'].includes(row.role) || normalize(row.teacher_name)!==normalize(name)) fail('기존 강사 연결을 관리자가 확인해야 합니다.');
    const teachers=await rest(query('teachers',{select:'id,display_name,active',id:'eq.'+row.teacher_id}));
    if (teachers.length!==1 || !teachers[0].active || normalize(teachers[0].display_name)!==normalize(name)) fail('기존 강사 정보 확인이 필요합니다.');
    return {success:true, provisioned:false};
  }
  const email=String(authUser.email||'').toLowerCase();
  const phone=email.split('@')[0];
  if (!/^[0-9]{11}@sedu-auth\.local$/.test(email) || String(account.user.loginId||'').replace(/\D/g,'')!==phone) fail('검증된 로그인 정보가 일치하지 않습니다.');
  const matches=await rest(query('teachers',{select:'id,display_name,phone,active',normalized_name:'eq.'+normalize(name)}));
  if (matches.length>1) fail('동명이인 강사 연결을 확인해야 합니다.');
  let teacher=matches[0];
  if (teacher && (!teacher.active || String(teacher.phone||'').replace(/\D/g,'')!==phone)) fail('기존 강사의 전화번호 또는 상태가 일치하지 않습니다.');
  if (!teacher) {
    // Deterministic key + ignore-duplicates makes simultaneous first logins safe.
    const hex=createHash('sha256').update('teacher-portal:'+account.uid).digest('hex');
    const id=[hex.slice(0,8),hex.slice(8,12),'5'+hex.slice(13,16),'a'+hex.slice(17,20),hex.slice(20,32)].join('-');
    await rest('teachers?on_conflict=id',{method:'POST',body:{id,display_name:name,normalized_name:normalize(name),phone,active:true,source_metadata:{source:'verified-firebase-portal-repair',firebase_uid:account.uid}},ignoreDuplicates:true});
    const created=await rest(query('teachers',{select:'id,display_name,phone,active',id:'eq.'+id}));
    teacher=created[0];
    if (!teacher || !teacher.active || normalize(teacher.display_name)!==normalize(name) || String(teacher.phone||'').replace(/\D/g,'')!==phone) fail('강사 정보 연결 확인에 실패했습니다.');
  }
  const owners=await rest(query('portal_identities',{select:'firebase_uid',teacher_id:'eq.'+teacher.id}));
  if (owners.some(row=>row.firebase_uid!==account.uid)) fail('이미 다른 계정에 연결된 강사입니다.');
  await rest('portal_identities?on_conflict=firebase_uid',{method:'POST',ignoreDuplicates:true,body:{firebase_uid:account.uid,teacher_id:teacher.id,teacher_name:name,role:'teacher',active:true,all_teacher_access:false,all_student_access:false,source:'verified-firebase-portal-repair',synced_at:new Date().toISOString()}});
  const confirmed=await rest(query('portal_identities',{select:'teacher_id,role,active,all_teacher_access,all_student_access',firebase_uid:'eq.'+account.uid}));
  if (confirmed.length!==1 || confirmed[0].teacher_id!==teacher.id || confirmed[0].role!=='teacher' || !confirmed[0].active || confirmed[0].all_teacher_access || confirmed[0].all_student_access) fail('강사 권한 연결 확인에 실패했습니다.');
  return {success:true,provisioned:true};
}

function makePortalRest(key, fetcher=fetch) {
  return async function rest(path, options={}) {
    if (!key) throw new Error('Portal identity service unavailable');
    const response=await fetcher('https://wfgtqajdkwzuqkwygcft.supabase.co/rest/v1/'+path,{
      method:options.method||'GET', headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:options.ignoreDuplicates?'resolution=ignore-duplicates,return=minimal':'return=minimal'},
      body:options.body?JSON.stringify(options.body):undefined,signal:AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Portal identity storage failed ('+response.status+')');
    const body=await response.text();return body?JSON.parse(body):[];
  };
}
module.exports={ensureTeacherIdentity,makePortalRest};
