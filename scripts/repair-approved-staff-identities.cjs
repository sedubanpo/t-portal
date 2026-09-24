const admin=require('../portal-functions/node_modules/firebase-admin');
const {execFileSync}=require('node:child_process');
const {ensureStaffIdentity,makePortalRest}=require('../portal-functions/identity');
admin.initializeApp({credential:admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT))});
const rest=makePortalRest(execFileSync('gcloud',['secrets','versions','access','latest','--secret=INTRANET_PORTAL_SERVICE_KEY','--project=fir-lms-prod'],{encoding:'utf8'}).trim());
(async()=>{for(const name of ['이민현','이성진','권민정','박승빈','전소희']){
 const q=await admin.firestore().collection('users').where('name','==',name).get();if(q.size!==1)throw Error('Ambiguous account');
 const doc=q.docs[0],uid=doc.id;
 const [p,a,u]=await Promise.all([admin.firestore().collection('userProfiles').doc(uid).get(),admin.firestore().collection('userAppAccess').doc(uid).get(),admin.auth().getUser(uid)]);
 const result=await ensureStaffIdentity({uid,user:doc.data(),profile:p.data()||{},access:a.data()||{}},u,async(path,opts)=>{if(opts?.method && !path.startsWith('portal_identities?'))throw Error('Out of scope write');return rest(path,opts);});
 console.log(JSON.stringify({name,...result}));
}})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>admin.app().delete());
