// Read-only production probes. Tokens remain in memory and are never printed.
const assert=require('node:assert/strict');
const admin=require('/Users/anjongseong/Documents/New project/s-lms/node_modules/firebase-admin');
admin.initializeApp({credential:admin.credential.cert(require('/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json')),projectId:'fir-lms-prod'});
const endpoint='https://asia-northeast3-fir-lms-prod.cloudfunctions.net/teacherPortalBootstrap';
async function token(uid){const custom=await admin.auth().createCustomToken(uid);const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})});const body=await r.json();assert(r.ok);return body.idToken;}
async function post(url,jwt,payload,extra={}){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt,...extra},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()};}
(async()=>{
 const uid='teacher_01086262428';let jwt=await token(uid);
 const grant=await post(endpoint,jwt,{mode:'staffReadSession'});assert.equal(grant.status,200);
 jwt=await token(uid);
 const history=await post(endpoint,jwt,{mode:'hoursHistory',teacherName:'김이천',monthKey:'2026-09'});
 assert.equal(history.status,200);assert(history.body.total>0);assert(history.body.rows.every(r=>!('actorKey' in r)));
 const hours=await post('https://wfgtqajdkwzuqkwygcft.supabase.co/rest/v1/rpc/portal_get_teacher_hours_live',jwt,{payload:{teacherName:'김이천',year:2026,month:9}},{apikey:'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8'});
 assert.equal(hours.status,200);assert(hours.body.success);assert(hours.body.attendanceRows.length>0);
 console.log(JSON.stringify({staffGrant:grant.status,historyStatus:history.status,historyTotal:history.body.total,actorNamesResolved:history.body.rows.filter(r=>r.actor!=='담당자 정보 없음').length,hoursStatus:hours.status,hoursResponseKeys:Object.keys(hours.body)}));
})().finally(()=>admin.app().delete()).catch(e=>{console.error(e.message);process.exitCode=1;});
