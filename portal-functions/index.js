const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { buildScopedBootstrap } = require('./scope');
const { staffReadAccess, inactive } = require('./staff-access');
const { projectNotices, projectLatestHours } = require('./home-data');
const {ensureTeacherIdentity,ensureStaffIdentity,makePortalRest} = require('./identity');
admin.initializeApp();
// No browser role, phone, teacher name, or UID is trusted as an identity.
exports.teacherPortalBootstrap = onRequest({region:'asia-northeast3', timeoutSeconds:60, memory:'256MiB', maxInstances:5, secrets:['INTRANET_PORTAL_SERVICE_KEY'], cors:['https://sedubanpo.github.io']}, async (req,res) => {
  res.set('Cache-Control','no-store');
  if(req.method !== 'POST') return res.status(405).json({success:false,message:'POST required'});
  try {
    const match = String(req.headers.authorization || '').match(/^Bearer (\S+)$/);
    if(!match) return res.status(401).json({success:false,message:'로그인이 필요합니다.'});
    const claims = await admin.auth().verifyIdToken(match[1], true);
    const db = admin.firestore();
    const docs = await Promise.all(['users','userProfiles','userAppAccess'].map(c=>db.collection(c).doc(claims.uid).get()));
    const account={uid:claims.uid, user:docs[0].data()||{}, profile:docs[1].data()||{}, access:docs[2].data()||{}};
    const role=String(account.user.role||'').toUpperCase();
    const status=String(account.user.status||'').toUpperCase();
    const isAdmin=['ADMIN','SUPER_ADMIN'].includes(role);
    if(!docs[0].exists || role==='DISABLED' || [account.user,account.profile,account.access].some(inactive) || (!isAdmin && account.access.apps?.teacherPortal!==true)) return res.status(403).json({success:false,message:'강사 포털 접근 권한이 없습니다.'});
    const payload=req.body||{};
    if (!payload.mode || payload.mode==='ensureIdentity') {
      const authUser=await admin.auth().getUser(claims.uid);
      const identity=await ensureTeacherIdentity(account,authUser,makePortalRest(process.env.INTRANET_PORTAL_SERVICE_KEY));
      if(identity.provisioned) console.info('teacher-portal-identity-repaired', {uid:claims.uid});
      if(payload.mode==='ensureIdentity') return res.json(identity);
    }
    if(payload.mode==='lmsNotices'){
      const snap=await db.collection('dashboardSnapshots').doc('GLOBAL_NOTICE').get();
      const rows=projectNotices(snap.data()||{});
      return res.json({success:true,source:'S-LMS',rows});
    }
    if(payload.mode==='homeLatestHours'){
      const teacher=String(payload.teacherName||'').trim();
      if(!teacher)return res.status(400).json({success:false,message:'강사를 선택해 주세요.'});
      const headers={apikey:'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8',Authorization:'Bearer '+match[1],'Content-Type':'application/json'};
      const base='https://wfgtqajdkwzuqkwygcft.supabase.co/rest/v1/';
      const latest=await fetch(base+'attendance_logs?select=class_date&teacher_name=eq.'+encodeURIComponent(teacher)+'&order=class_date.desc&limit=1',{headers,signal:AbortSignal.timeout(10000)});
      if(!latest.ok)throw Error('LATEST_READ_FAILED');
      const dates=await latest.json();const date=dates[0]?.class_date;
      if(!date)return res.json({success:true,date:null,rows:[],signed:false});
      const r=await fetch(base+'rpc/portal_get_teacher_hours_live',{method:'POST',headers,body:JSON.stringify({payload:{teacherName:teacher,year:Number(date.slice(0,4)),month:Number(date.slice(5,7))}}),signal:AbortSignal.timeout(10000)});
      if(!r.ok)return res.status(r.status).json({success:false,message:'지난 수업을 조회할 수 없습니다.'});
      const data=await r.json();
      return res.json(projectLatestHours(data,date));
    }
    if (payload.mode === 'hoursHistory') {
      // The database checks the caller's teacher scope before any actor lookup.
      const upstream=await fetch('https://wfgtqajdkwzuqkwygcft.supabase.co/rest/v1/rpc/portal_get_hours_history',{
        method:'POST',headers:{'Content-Type':'application/json',apikey:'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8',Authorization:'Bearer '+match[1]},
        body:JSON.stringify({payload:{teacherName:payload.teacherName,monthKey:payload.monthKey,offset:payload.offset||0}}),signal:AbortSignal.timeout(15000)
      });
      if(!upstream.ok)return res.status(upstream.status).json({success:false,message:'이 강사의 변경 이력을 조회할 권한이 없거나 조회에 실패했습니다.'});
      const history=await upstream.json();
      const wanted=new Set((history.rows||[]).filter(r=>r.actor==='담당자 정보 없음').map(r=>r.actorKey));
      if(wanted.size){
        const crypto=require('node:crypto');
        const people=await db.collection('users').where('role','in',['ADMIN','SUPER_ADMIN','STAFF','DESK']).limit(500).get();
        const names=new Map();
        for(const p of people.docs){const key=crypto.createHash('md5').update(p.id).digest('hex');if(wanted.has(key)){const row=p.data();const name=String(row.name||row.displayName||'').trim();if(name)names.set(key,name);}}
        for(const row of history.rows||[])if(names.has(row.actorKey))row.actor=names.get(row.actorKey);
      }
      // No directory endpoint and no unrelated account information leaves server.
      for(const row of history.rows||[])delete row.actorKey;
      return res.json(history);
    }
    if (payload.mode === 'staffReadSession') {
      const permitted = staffReadAccess(account);
      const authUser = await admin.auth().getUser(claims.uid);
      const previous = authUser.customClaims || {};
      if(permitted) await ensureStaffIdentity(account,authUser,makePortalRest(process.env.INTRANET_PORTAL_SERVICE_KEY));
      // Dedicated expiring read claim. Never set isAdmin or change write scopes.
      await admin.auth().setCustomUserClaims(claims.uid, {...previous, portalStaffReadUntil: permitted ? Math.floor(Date.now()/1000)+3600 : 0});
      return res.status(permitted ? 200 : 403).json({success:permitted,readOnly:true,message:permitted?'실무자 조회 권한 확인 완료':'실무자 조회 권한이 없습니다.'});
    }
    const needsStudents=payload.includeStudentList!==false || payload.includeHomeroom!==false;
    const names=needsStudents?['students','studentPermissions','studentHomerooms','studentAliases','canonicalStudentMap']:[];
    const collections={};
    await Promise.all(names.map(async name=>{
      const snap=await db.collection(name).limit(20001).get();
      if(snap.size>20000) throw new Error('SOURCE_LIMIT');
      collections[name]=snap.docs.map(d=>({...d.data(),id:d.id}));
    }));
    // login aliases are matched by verified uid, never by a user supplied phone.
    const aliases=await db.collection('loginAliases').where('uid','==',claims.uid).limit(100).get();
    account.aliases=aliases.docs.map(d=>d.data());
    res.json(buildScopedBootstrap(account,collections,payload));
  } catch(error) {
    const authError=String(error.code||'').startsWith('auth/');
    res.status(authError?401:(error.statusCode||503)).json({success:false,message:authError?'로그인 세션을 확인해 주세요.':error.statusCode===409?error.message:'학생·담임 정보를 불러오지 못했습니다. 다시 시도해 주세요.'});
  }
});
