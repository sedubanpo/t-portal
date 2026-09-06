// Explicitly invoked, read-only production probe. Never part of the offline suite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import https from 'node:https';
import {gunzipSync} from 'node:zlib';
const require=createRequire(import.meta.url);
const admin=require('/Users/anjongseong/Documents/New project/s-lms/node_modules/firebase-admin');
const service=require(process.env.FIREBASE_SERVICE_ACCOUNT||'/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json');
const config={url:'https://wfgtqajdkwzuqkwygcft.supabase.co',publishableKey:'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8'};
const source=process.env.LIVE_SOURCE==='1'?await (await fetch('https://sedubanpo.github.io/t-portal/?probe='+Date.now())).text():fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const old=execFileSync('git',['show','c317366:index.html'],{encoding:'utf8',maxBuffer:10*1024*1024});
const names=['getSupabaseAttendanceExistingRowsDirect_','getSupabaseImportBatchesDirect_','getSupabaseAttendanceMonthDirect_','getSupabaseUploadDashboardDirect_','getSupabaseStoredAttendancePreviewDirect_','getSupabaseAccessAttendanceOverviewDirect_','getSupabaseAccessAttendanceVersionRowsDirect_'];
const extract=(s,n)=>{const a=s.indexOf('  function '+n+'(');assert(a>=0,n);return s.slice(a,s.indexOf('\n  function ',a+1));};
const samples=[];let label,jwt,snapshotBatch;
async function request(c,path,token){const start=performance.now();const {status,headers,raw}=await new Promise((resolve,reject)=>{const req=https.get(c.url+'/rest/v1/'+path,{headers:{apikey:c.publishableKey,Authorization:'Bearer '+token,'Accept-Encoding':'gzip'}},r=>{const chunks=[];r.on('data',d=>chunks.push(d));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,raw:Buffer.concat(chunks)}));r.on('error',reject);});req.on('error',reject);req.setTimeout(30000,()=>req.destroy(new Error('timeout')));});assert.equal(status,200,'Supabase HTTP status');const body=(headers['content-encoding']==='gzip'?gunzipSync(raw):raw).toString('utf8');const rows=JSON.parse(body);if(label==='before-overview'&&path.startsWith('import_batches'))snapshotBatch=rows.find(b=>b.metadata?.accessRowsSnapshot?.length);samples.push({label,table:path.split('?')[0],rows:rows.length,wireBodyBytes:raw.length,decodedBytes:Buffer.byteLength(body),ms:Math.round(performance.now()-start),encoding:headers['content-encoding']||'identity'});return rows;}
function context(s,modern){const c=vm.createContext({window:{},Map,Promise,Date,requestPortalSupabaseRows_:request});vm.runInContext(fs.readFileSync(new URL('../access-dashboard-direct.js',import.meta.url),'utf8'),c);vm.runInContext((modern?'var supabaseAccessReadCache_=new Map();\n'+['clearSupabaseAccessReadCache_','reuseSupabaseAccessRead_'].map(n=>extract(s,n)).join('\n'):'')+'\n'+names.map(n=>extract(s,n)).join('\n'),c);c.withSupabaseAccessAdminDirect_=cb=>cb(config,jwt);return c;}
const clean=x=>JSON.parse(JSON.stringify(x));
async function timed(name,fn){label=name;const start=performance.now(),i=samples.length;const value=await fn();return {value,measurement:{name,ms:Math.round(performance.now()-start),requests:samples.length-i,wireBodyBytes:samples.slice(i).reduce((n,s)=>n+s.wireBodyBytes,0),decodedBytes:samples.slice(i).reduce((n,s)=>n+s.decodedBytes,0)}};}
admin.initializeApp({credential:admin.credential.cert(service),projectId:'fir-lms-prod'});
try{
 const uid=process.env.TEST_ADMIN_UID||'teacher_01089945993';await admin.auth().getUser(uid); // Do not create an account accidentally.
 const custom=await admin.auth().createCustomToken(uid);
 const auth=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})});assert(auth.ok,'Firebase sign in failed');jwt=(await auth.json()).idToken;
 const before=context(old,false),after=context(source,true),p={year:2026,month:8};
 const baseline=await timed('before-overview',()=>before.getSupabaseAccessAttendanceOverviewDirect_(p));
 const cold=await timed('after-overview-cold',()=>after.getSupabaseAccessAttendanceOverviewDirect_(p));
 assert.deepEqual(clean(cold.value),clean(baseline.value),'overview parity');
 const warm=await timed('after-overview-warm',()=>after.getSupabaseAccessAttendanceOverviewDirect_(p));
 assert.deepEqual(clean(warm.value),clean(cold.value));
 const preview=await timed('after-preview-warm',()=>after.getSupabaseStoredAttendancePreviewDirect_(p));
 assert.equal(preview.measurement.requests,0,'month cache should avoid network');
 const force=await timed('after-overview-force',()=>after.getSupabaseAccessAttendanceOverviewDirect_({...p,forceRefresh:true}));
 assert.deepEqual(clean(force.value),clean(cold.value));assert(force.measurement.requests>1);
 assert(snapshotBatch,'existing snapshot required for version test');
 const version=await timed('after-selected-version',()=>after.getSupabaseAccessAttendanceVersionRowsDirect_({...p,batchId:snapshotBatch.id}));
 assert.deepEqual(clean(version.value),clean(after.window.PortalAccessDashboardEngine.buildVersion(snapshotBatch,[],'','2026-08')));
 console.log(JSON.stringify({time:new Date().toISOString(),source:process.env.LIVE_SOURCE==='1'?'deployed':'working-tree',version:source.match(/const APP_VERSION = '([^']+)'/)[1],parity:true,measurements:[baseline,cold,warm,preview,force,version].map(x=>x.measurement),samples},null,2));
}finally{await admin.app().delete();}
