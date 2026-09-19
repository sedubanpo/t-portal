const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { buildScopedBootstrap } = require('./scope');
const { staffReadAccess, inactive } = require('./staff-access');
admin.initializeApp();
// No browser role, phone, teacher name, or UID is trusted as an identity.
exports.teacherPortalBootstrap = onRequest({region:'asia-northeast3', timeoutSeconds:30, memory:'256MiB', maxInstances:5, cors:['https://sedubanpo.github.io']}, async (req,res) => {
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
    if (payload.mode === 'staffReadSession') {
      const permitted = staffReadAccess(account);
      const authUser = await admin.auth().getUser(claims.uid);
      const previous = authUser.customClaims || {};
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
    res.status(authError?401:503).json({success:false,message:authError?'로그인 세션을 확인해 주세요.':'학생·담임 정보를 불러오지 못했습니다. 다시 시도해 주세요.'});
  }
});
