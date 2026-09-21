const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const src=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function fn(name){const start=src.indexOf('  function '+name+'(');return src.slice(start,src.indexOf('\n  }',start)+4);}
const context={URLSearchParams,location:{search:'?hub_nonce=test'},currentUser:{uid:'staff',staffReadOnly:true},teacherPortalFirebaseState:{auth:{currentUser:{uid:'admin',getIdToken:()=>{throw Error('must not request token');}}}},Promise,Date,decodePortalJwtPayload_:()=>({}),ensureTeacherPortalStaffReadSession_:()=>{throw Error('must not grant');}};
vm.createContext(context);vm.runInContext(fn('isTeacherPortalHubSession_')+'\n'+fn('getTeacherPortalFirebaseIdToken_'),context);
(async()=>{
 assert(context.isTeacherPortalHubSession_());context.location.search='';assert(!context.isTeacherPortalHubSession_());
 await assert.rejects(context.getTeacherPortalFirebaseIdToken_(false),/다른 계정/);
 context.teacherPortalFirebaseState.auth.currentUser={uid:'staff',getIdToken:async()=> 'expired'};
 context.ensureTeacherPortalStaffReadSession_=async user=>{assert.equal(user.uid,'staff');return 'renewed';};
 assert.equal(await context.getTeacherPortalFirebaseIdToken_(false),'renewed');
 context.currentUser={uid:'teacher',staffReadOnly:false};context.teacherPortalFirebaseState.auth.currentUser={uid:'teacher',getIdToken:async()=> 'own-token'};
 assert.equal(await context.getTeacherPortalFirebaseIdToken_(false),'own-token');
 console.log('PASS mismatched account blocked before grant, STAFF renewed, teacher unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});
