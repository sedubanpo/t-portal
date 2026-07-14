#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('/Users/anjongseong/Documents/New project/s-lms/node_modules/firebase-admin');
const service = require(process.env.FIREBASE_SERVICE_ACCOUNT || '/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json');
const apiKey = 'AIzaSyCFM21ZxgwIYwmjRPaAOp5bL9Kprqiyppg';
const url = 'https://wfgtqajdkwzuqkwygcft.supabase.co';
const key = 'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8';
const gas = 'https://script.google.com/macros/s/AKfycbyKiyCs2lYmGVAb1XVgqbd0rwkNcIw36gl06juaXNrV-0cxbSx8ZVP8XI9JC1vGViBmLg/exec';
const year = Number(process.argv[2] || new Date().getFullYear());
const month = Number(process.argv[3] || (new Date().getMonth() + 1));

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../class-log-overview-direct.js', import.meta.url), 'utf8'), context);
const engine = context.window.PortalClassLogOverviewEngine;
admin.initializeApp({ credential: admin.credential.cert(service), projectId: 'fir-lms-prod' });

async function token(uid) {
  const custom = await admin.auth().createCustomToken(uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const body = await response.json(); assert.ok(response.ok, JSON.stringify(body)); return body.idToken;
}
async function page(path, jwt, offset = 0) {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`${url}/rest/v1/${path}${separator}limit=1000&offset=${offset}`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` } });
  const bodyText = await response.text();
  assert.ok(response.ok, bodyText); return bodyText ? JSON.parse(bodyText) : [];
}
async function paged(path, jwt) {
  const rows = []; for (let offset = 0; ; offset += 1000) { const chunk = await page(path, jwt, offset); rows.push(...chunk); if (chunk.length < 1000) return rows; }
}
async function gasAction(action, payload) {
  const target = new URL(gas); target.searchParams.set('action', action); target.searchParams.set('payload', JSON.stringify(payload));
  const response = await fetch(target, { redirect: 'follow' }); assert.ok(response.ok); return response.json();
}
function normalizedDay(day) {
  return {
    taughtTeacherCount: day.taughtTeacherCount, submittedTeacherCount: day.submittedTeacherCount,
    missingTeacherCount: day.missingTeacherCount, partialTeacherCount: day.partialTeacherCount,
    noLogTeacherCount: day.noLogTeacherCount, agreementTeacherCount: day.agreementTeacherCount,
    agreementRecordTeacherCount: day.agreementRecordTeacherCount,
    teachers: (day.teachers || []).map(row => ({ teacher: row.teacher, hasClass: row.hasClass, taughtCount: row.taughtCount,
      taughtHours: row.taughtHours, logCount: row.logCount, submittedCount: row.submittedCount, missingCount: row.missingCount,
      portalLogCount: row.portalLogCount, portalSubmittedCount: row.portalSubmittedCount, portalMissingCount: row.portalMissingCount,
      status: row.status, portalStatus: row.portalStatus, hoursAgreementSigned: row.hoursAgreementSigned }))
  };
}

try {
  const jwt = await token('teacher_01089945993');
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = new Date(year, month, 1); const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  const scope = `class_date=gte.${start}&class_date=lt.${end}`;
  const [attendance, logs, signatures, batches, gasOverview, teacherToken] = await Promise.all([
    paged(`attendance_logs?select=class_date,category,student_name,teacher_name,status,start_time_text,end_time_text,hours,import_batch_id&${scope}&order=class_date.asc,teacher_name.asc,student_name.asc`, jwt),
    paged(`class_log_rows?select=class_date,teacher_name,student_name,status,reason,start_time_text,end_time_text,class_name,updated_at&${scope}&order=class_date.asc,teacher_name.asc,student_name.asc`, jwt),
    paged(`signatures?select=class_date,teacher_name,signed,signed_at,signed_by&${scope}&order=class_date.asc,teacher_name.asc`, jwt),
    paged('import_batches?select=id,source,status,metadata,imported_at,row_count&source=eq.access-daily&status=eq.completed&order=imported_at.desc', jwt),
    gasAction('getClassLogMonthlyOverview', { year, month, compact: false, includeNotion: false, forceRefresh: true }),
    token('teacher_01020837308')
  ]);
  assert.ok(logs.length > 0, '비교 월에 Supabase 수업일지 행이 없습니다.');
  const direct = engine.build(attendance, logs, signatures, year, month, { compact: false, batches });
  const mismatches = [];
  Object.keys(direct.dayMap).forEach(date => {
    if (JSON.stringify(normalizedDay(direct.dayMap[date])) !== JSON.stringify(normalizedDay(gasOverview.dayMap[date] || {}))) mismatches.push(date);
  });
  if (mismatches.length) {
    console.error(JSON.stringify(mismatches.map(date => ({ date, direct: normalizedDay(direct.dayMap[date]), gas: normalizedDay(gasOverview.dayMap[date] || {}) })), null, 2));
  }
  assert.deepEqual(mismatches, []);
  const teacherRows = await page(`class_log_rows?select=id&${scope}`, teacherToken);
  const teacherSignatures = await page(`signatures?select=id&${scope}`, teacherToken);
  assert.equal(teacherRows.length, 0); assert.equal(teacherSignatures.length, 0);
  console.log(JSON.stringify({ ok: true, year, month, attendanceRows: attendance.length, classLogRows: logs.length, signatures: signatures.length, mismatches, teacherRows: teacherRows.length }, null, 2));
} finally { await admin.app().delete(); }
