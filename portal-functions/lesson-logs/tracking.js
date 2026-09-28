// Read-only S-LMS tracking projection, reused 2026-09-28. No Notion writes or sync actions.
'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { monthsBetween, publishedLessons, applySentChanges, normalizeLesson, resolveTeacherAccounts, compareLessons } = require('./tracking-core');
const MAX_DOCS_PER_MONTH = 2000;
const MAX_MIRROR_PAGES = 10000;
const SYNC_FRESH_MS = 2 * 60 * 60 * 1000;

function fail(code, message) { throw new HttpsError(code, message); }
function active(value) { return !!value && value.active !== false && value.isActive !== false && !value.disabled && !value.deletedAt && !value.retiredAt && !value.terminationDate; }

async function teacherAccounts(db) {
  const snapshot = await db.collection('users').where('role', '==', 'INSTRUCTOR').limit(1001).get();
  if (snapshot.size > 1000) fail('resource-exhausted', '강사 계정 조회 한도를 초과했습니다.');
  const accounts = [];
  for (let offset = 0; offset < snapshot.docs.length; offset += 100) {
    const chunk = snapshot.docs.slice(offset, offset + 100);
    const [profiles, accesses] = await Promise.all([
      db.getAll(...chunk.map(doc => db.collection('userProfiles').doc(doc.id))),
      db.getAll(...chunk.map(doc => db.collection('userAppAccess').doc(doc.id))),
    ]);
    chunk.forEach((doc, index) => {
      const user = doc.data() || {}, profile = profiles[index].data() || {}, access = accesses[index].data() || {};
      if (user.status === 'ACTIVE' && active(user) && profiles[index].exists && active(profile) && accesses[index].exists && active(access) && access.apps?.sLms === true && user.name) accounts.push({ uid: doc.id, name: user.name, department: String(profile.department || user.department || '').slice(0, 40), accountHint: String(user.loginId || '').length >= 6 ? String(user.loginId).slice(-4) : '' });
    });
  }
  return accounts;
}

async function teacherDecisions(db, months) {
  const results = new Map();
  for (const month of months) {
    const snapshot = await db.collection('lessonLogTeacherDecisions').where('month', '==', month).limit(2001).get();
    if (snapshot.size > 2000) fail('resource-exhausted', '강사 연결 검토 기록이 조회 한도를 초과했습니다.');
    snapshot.docs.forEach(doc => results.set(doc.id, doc.data()));
  }
  return results;
}

async function sourceLessons(db, months, start, end, teacherUid = null, accounts = [], decisions = new Map()) {
  const candidates = [];
  for (const month of months) {
    const [periods, histories, sentEvents] = await Promise.all([
      ...['intranetStudentPeriods', 'intranetLegacyPeriods'].map(name => db.collection(name).where('month', '==', month).limit(MAX_DOCS_PER_MONTH + 1).get()),
      db.collection('intranetPortalChanges').where('month', '==', month).limit(5001).get(),
    ]);
    if (periods.size > MAX_DOCS_PER_MONTH || histories.size > MAX_DOCS_PER_MONTH || sentEvents.size > 5000) fail('resource-exhausted', '해당 월의 수업이 조회 한도를 초과했습니다.');
    const events = sentEvents.docs.map(doc => doc.data());
    const current = new Map(periods.docs.map(doc => [doc.data().studentId, { id: doc.id, ...doc.data() }]));
    const history = new Map(histories.docs.map(doc => [doc.data().studentId, { id: doc.id, ...doc.data() }]));
    const ids = [...new Set([...current.keys(), ...history.keys()].filter(Boolean))];
    for (const studentId of ids) {
      const period = current.get(studentId) || {};
      const old = history.get(studentId) || {};
      const periodKey = current.get(studentId)?.id || old.id || `${month}|${studentId}`;
      const oldLessons = old.lessons || old.publishedLessons || [];
      const effective = applySentChanges(publishedLessons(period, oldLessons), events, studentId, period.publishedDeletedIds || []);
      for (const lesson of effective) {
        const row = normalizeLesson(lesson, studentId, '', periodKey);
        if (row && row.classDate >= start && row.classDate <= end) candidates.push(row);
      }
    }
  }
  const resolved = resolveTeacherAccounts(candidates, accounts, decisions).filter(row => !teacherUid || row.teacherUid === teacherUid);
  const studentIds = [...new Set(resolved.map(row => row.studentId))];
  const students = new Map();
  for (let offset = 0; offset < studentIds.length; offset += 100) {
    const chunk = studentIds.slice(offset, offset + 100);
    const snapshots = await db.getAll(...chunk.map(id => db.collection('students').doc(id)));
    snapshots.forEach((doc, index) => {
      const student = doc.data() || {};
      students.set(chunk[index], { name: student.name || student.studentName || '', school: student.school || '', grade: student.grade || '' });
    });
  }
  return resolved.map(row => ({ ...row, studentName: students.get(row.studentId)?.name || row.studentName, studentSchool: students.get(row.studentId)?.school || '', studentGrade: students.get(row.studentId)?.grade || '' })).sort((a, b) => b.classDate.localeCompare(a.classDate) || b.start.localeCompare(a.start) || a.id.localeCompare(b.id));
}

async function mirrorPages(db, start, end) {
  const snapshot = await db.collection('lessonLogNotionPages').where('classDate', '>=', start).where('classDate', '<=', end).limit(MAX_MIRROR_PAGES + 1).get();
  if (snapshot.size > MAX_MIRROR_PAGES) fail('resource-exhausted', 'Notion 기록이 조회 한도를 초과했습니다.');
  return snapshot.docs.map(doc => doc.data());
}

async function tracking(db, actor, input) {
  const ownHistory=input.view==='history'||input.view==='overview';
  const selected=!ownHistory&&actor.admin&&input.ownerUid?String(input.ownerUid):null;
  const who={uid:selected||actor.uid,staff:!ownHistory&&actor.admin&&!selected,admin:actor.admin};
  const mapping=await db.collection('portalLessonNotionMappings').doc('teacher:'+who.uid).get();
  const teacherPageId=mapping.data()?.pageId;
  const start = String(input.start || '');
  const end = String(input.end || '');
  let months;
  try { months = monthsBetween(start, end); }
  catch (error) { fail('invalid-argument', error.message); }
  const [accounts, decisions] = await Promise.all([teacherAccounts(db), teacherDecisions(db, months)]);
  const visible = await sourceLessons(db, months, start, end, who.staff ? null : who.uid, accounts, decisions);
  const state = (await db.collection('lessonLogSyncState').doc('notion').get()).data() || {};
  const lastSuccess = state.lastSuccessAt?.toDate?.() || null;
  const connected = !!lastSuccess && !state.error && (!state.syncing || state.syncPhase === 'fetching') && Date.now() - lastSuccess.getTime() < SYNC_FRESH_MS;
  const archived=await db.collection('portalLessonDrafts').where('status','==','archived').limit(1001).get();
  if(archived.size>1000)fail('resource-exhausted','삭제 내역 확인 한도를 초과했습니다.');
  const removed=new Set(archived.docs.filter(d=>d.data().deletedAt).map(d=>d.data().notionPageId));
  const pages = connected ? (await mirrorPages(db, start, end)).filter(p=>!removed.has(p.id)) : [];
  const rows = compareLessons(visible, pages, connected);
  if (connected) {
    const pageById = new Map(pages.map(page => [page.id, page]));
    const ids = [...new Set(rows.map(row => row.notionId).filter(Boolean))];
    const scores = new Map();
    for (let offset = 0; offset < ids.length; offset += 300) {
      const chunk = ids.slice(offset, offset + 300);
      const snapshots = await db.getAll(...chunk.map(id => db.collection('lessonLogBodyScores').doc(id)));
      snapshots.forEach((snapshot, index) => {
        const data = snapshot.data();
        if (data && data.editedAt === pageById.get(chunk[index])?.editedAt && Number.isInteger(data.charCount)) scores.set(chunk[index], data.charCount);
      });
    }
    rows.forEach(row => {
      if (row.notionId && scores.has(row.notionId)) {
        row.bodyCharCount = scores.get(row.notionId);
        row.bodyScore = bodyScore(row.bodyCharCount);
      }
    });
  }
  return {
    rows,
    history: pages.filter(page=>who.staff||page.teacherUid===who.uid||teacherPageId&&(page.teacherRelationIds||[]).some(id=>id.replace(/-/g,'')===teacherPageId.replace(/-/g,''))).map(page=>({id:page.id,title:page.title,classDate:page.classDate,teacherName:page.teacherName||(page.teacherNames||[]).join(' · '),studentName:page.studentName||(page.studentNames||[]).join(' · '),url:page.url,editedAt:page.editedAt})),
    staff: who.staff,
    admin: who.admin,
    teacherReview: who.admin ? visible.filter(row => row.teacherMatch === 'ambiguous').map(row => ({ id: row.id, teacherName: row.teacherName, studentName: row.studentName, classDate: row.classDate, start: row.start, subject: row.subject, teacherCandidates: row.teacherCandidates })) : undefined,
    autoLinkedCount: who.staff ? visible.filter(row => row.teacherMatch === 'name').length : undefined,
    source: connected ? 'connected' : state.error ? 'error' : lastSuccess ? 'stale' : 'not-connected',
    lastSyncedAt: lastSuccess?.toISOString() || null,
    syncing: !!state.syncing,
    syncPhase: state.syncPhase || null,
    sourceCount: visible.length,
    // Unknown teacher UIDs are deliberately omitted from instructor results.
    unassignedCount: who.staff ? visible.filter(row => !row.teacherUid).length : 0,
    incompleteNotionCount: who.staff ? Number(state.incompleteCount || 0) : undefined,
  };
}


function bodyScore(count){return count===0?0:Math.min(5,Math.floor(count/100)+1);}
module.exports={tracking};
