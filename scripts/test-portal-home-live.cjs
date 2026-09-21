// Read-only production data checks; JWTs never leave memory or appear in output.
const assert=require('node:assert/strict');
const admin=require('/Users/anjongseong/Documents/New project/s-lms/node_modules/firebase-admin');
admin.initializeApp({credential:admin.credential.cert(require('/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json')),projectId:'fir-lms-prod'});
const endpoint='https://asia-northeast3-fir-lms-prod.cloudfunctions.net/teacherPortalBootstrap';
async function token(uid){const custom=await admin.auth().createCustomToken(uid);const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})});assert(r.ok);return (await r.json()).idToken;}
async function post(jwt,payload){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()};}
(async()=>{
 const uid='teacher_01086262428';let jwt=await token(uid);
 assert.equal((await post(jwt,{mode:'staffReadSession'})).status,200);jwt=await token(uid);
 const latest=await post(jwt,{mode:'homeLatestHours',teacherName:'김이천'});
 assert.equal(latest.status,200);assert(latest.body.success);assert(latest.body.rows.length>0);assert(/^\d{4}-\d{2}-\d{2}$/.test(latest.body.date));
 assert(latest.body.rows.every(r=>!('teacher_phone' in r)&&!('metadata' in r)));
 const notices=await post(jwt,{mode:'lmsNotices'});assert.equal(notices.status,200);assert(notices.body.success);assert(notices.body.rows.every(r=>Object.keys(r).every(k=>['content','updatedAt'].includes(k))));
 console.log(JSON.stringify({latestStatus:latest.status,latestDate:latest.body.date,lessonRows:latest.body.rows.length,signed:latest.body.signed,noticesStatus:notices.status,noticeCount:notices.body.rows.length}));
 const person=await admin.firestore().collection('users').doc('teacher_01034265447').get();
 assert(person.exists&&!['ADMIN','SUPER_ADMIN','STAFF','DESK'].includes(String(person.data().role).toUpperCase()),'fixture must not have privileged role');
 const ownJwt=await token(person.id);
 const own=await post(ownJwt,{mode:'homeLatestHours',teacherName:'김이천'});assert.equal(own.status,200);assert(own.body.rows.length>0);
 const other=await post(ownJwt,{mode:'homeLatestHours',teacherName:'김미라'});assert(other.status===403||(other.status===200&&other.body.rows.length===0),'ordinary teacher must not see another teacher');
 console.log('PASS teacher own latest rows available; other teacher rows not disclosed');
})().finally(()=>admin.app().delete()).catch(e=>{console.error(e.message);process.exitCode=1;});
