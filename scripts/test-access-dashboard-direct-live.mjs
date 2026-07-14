#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),admin=require('/Users/anjongseong/Documents/New project/s-lms/node_modules/firebase-admin');
const service=require(process.env.FIREBASE_SERVICE_ACCOUNT||'/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json');
const apiKey='AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg',url='https://wfgtqajdkwzuqkwygcft.supabase.co',key='sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8';
const adminUid=process.env.TEST_ADMIN_UID||'teacher_01089945993';
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../access-dashboard-direct.js',import.meta.url),'utf8'),context);const engine=context.window.PortalAccessDashboardEngine;
admin.initializeApp({credential:admin.credential.cert(service),projectId:'fir-lms-prod'});
async function token(){const custom=await admin.auth().createCustomToken(adminUid);const res=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})});const body=await res.json();assert.ok(res.ok);return body.idToken;}
async function sb(path,jwt){const res=await fetch(`${url}/rest/v1/${path}`,{headers:{apikey:key,Authorization:`Bearer ${jwt}`}});if(!res.ok)throw new Error(await res.text());return res.json();}
async function attendance(jwt){const all=[];for(let offset=0;;offset+=1000){const rows=await sb(`attendance_logs?select=*&class_date=gte.2026-07-01&class_date=lt.2026-08-01&order=class_date.asc&limit=1000&offset=${offset}`,jwt);all.push(...rows);if(rows.length<1000)return all;}}
try{const jwt=await token();const [rows,batches]=await Promise.all([attendance(jwt),sb('import_batches?select=id,source,source_file,imported_by,imported_at,row_count,status,note,metadata&order=imported_at.desc&limit=500',jwt)]);const directDashboard=engine.buildDashboard(rows,batches,2026,7),directOverview=engine.buildOverview(rows,batches,2026,7,'');assert.ok(rows.length>0,'운영 월 출결이 비어 있습니다.');assert.equal(directDashboard.monthSummary.rows,rows.length);assert.equal(directOverview.summary.rows,rows.length);assert.ok(directOverview.summary.coverageDays>0);assert.ok(directOverview.summary.batches>0);assert.equal(Object.values(directOverview.summary.statusCounts).reduce((sum,value)=>sum+Number(value||0),0),rows.length);console.log(JSON.stringify({ok:true,adminUid,rows:rows.length,hours:directDashboard.monthSummary.hours,coverageDays:directOverview.summary.coverageDays,batches:directOverview.summary.batches},null,2));}finally{await admin.app().delete();}
