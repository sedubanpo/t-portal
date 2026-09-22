// Explicitly scoped operational repair. No signatures, attendance or logs are written.
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const admin=require('../portal-functions/node_modules/firebase-admin');
const {ensureTeacherIdentity,makePortalRest}=require('../portal-functions/identity');
const names=['오기현','김현진','이유빈'];
const apply=process.argv.includes('--apply');
if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw Error('FIREBASE_SERVICE_ACCOUNT is required');
admin.initializeApp({credential:admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT))});
const key=execFileSync('gcloud',['secrets','versions','access','latest','--secret=INTRANET_PORTAL_SERVICE_KEY','--project=fir-lms-prod'],{encoding:'utf8'}).trim();
const rest=makePortalRest(key);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function evidence(){const rows={};for(const name of [...names,'김다인','김인찬']){rows[name]={};for(const table of ['signatures','class_log_rows','attendance_logs']) rows[name][table]=await rest(table+'?'+new URLSearchParams({select:'*',teacher_name:'eq.'+name,class_date:'gte.2026-09-01',order:'id.asc',limit:'1000'}));}return hash(rows);}
(async()=>{
 const before=await evidence();
 for(const name of names){
  const users=await admin.firestore().collection('users').where('name','==',name).get();
  if(users.size!==1)throw Error(name+': account match is ambiguous');
  const user=users.docs[0],uid=user.id;
  const [profile,access,auth]=await Promise.all([admin.firestore().collection('userProfiles').doc(uid).get(),admin.firestore().collection('userAppAccess').doc(uid).get(),admin.auth().getUser(uid)]);
  if(!apply){console.log(JSON.stringify({name,mode:'dry-run',active:user.data().status==='ACTIVE',allowed:access.data()?.apps?.teacherPortal===true}));continue;}
  const result=await ensureTeacherIdentity({uid,user:user.data(),profile:profile.data()||{},access:access.data()||{}},auth,rest);
  console.log(JSON.stringify({name,...result}));
 }
 const unchanged=before===await evidence();console.log(JSON.stringify({consentAndLessonRecordsUnchanged:unchanged}));if(!unchanged)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>admin.app().delete());
