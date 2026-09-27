'use strict';
const {createHash} = require('node:crypto');
const TYPES = ['개별&1:1','2:1수업&개별','1:1 수업','개별정규','2:1 수업'];
const FIELDS = ['studentId','lessonDate','lessonType','title','content','materials','homework','feedback','assessment'];
const COLLECTION = 'portalLessonDrafts';
const MAX_FILE = 10 * 1024 * 1024;
function fail(code, status = 400) { const e = new Error(code); e.code = code; e.statusCode = status; throw e; }
function uuid(value) { if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value || '')) fail('INVALID_ID'); return value; }
function actor(account) {
  const role = String(account.user?.role || '').toUpperCase();
  if (!['ADMIN','SUPER_ADMIN','INSTRUCTOR'].includes(role)) fail('PRIVATE_DRAFT_ACCESS_DENIED',403);
  return {uid:account.uid, name:String(account.user.name || account.profile?.name || ''), admin:role !== 'INSTRUCTOR'};
}
function access(a, draft, write = false) {
  if (!draft || draft.deletedAt || (draft.ownerUid !== a.uid && !a.admin)) fail('NOT_FOUND',404);
  // Administrative visibility never grants proxy authorship.
  if (write && draft.ownerUid !== a.uid) fail('OWNER_ONLY',403);
}
function clean(input = {}) {
  const out = {};
  for (const key of FIELDS) {
    if (typeof input[key] !== 'string' && input[key] !== undefined) fail('INVALID_CONTENT');
    out[key] = input[key] || '';
    if (out[key].length > (['title','studentId','lessonDate','lessonType'].includes(key) ? 200 : 12000)) fail('CONTENT_TOO_LONG');
  }
  if (JSON.stringify(out).length > 65000) fail('CONTENT_TOO_LONG');
  const ids = input.attachmentIds || [];
  if (!Array.isArray(ids) || ids.length > 10 || new Set(ids).size !== ids.length) fail('INVALID_FILES');
  out.attachmentIds = ids.map(uuid);
  return out;
}
function complete(content) {
  if (!content.studentId || !content.title.trim() || !content.content.trim()) fail('REQUIRED_FIELDS');
  const date=new Date(content.lessonDate+'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(content.lessonDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== content.lessonDate) fail('INVALID_DATE');
  if (!TYPES.includes(content.lessonType)) fail('INVALID_LESSON_TYPE');
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fileBytes(body) {
  uuid(body.fileId);
  if (typeof body.base64 !== 'string' || body.base64.length > Math.ceil(MAX_FILE/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)) fail('INVALID_FILE');
  const bytes = Buffer.from(body.base64,'base64');
  if (!bytes.length || bytes.length > MAX_FILE) fail('FILE_TOO_LARGE');
  const mime = bytes.subarray(0,5).toString() === '%PDF-' ? 'application/pdf'
    : bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : null;
  if (!mime) fail('FILE_TYPE_UNSUPPORTED');
  return {bytes,mime,name:String(body.name || '첨부 자료').replace(/[\x00-\x1f/\\]/g,'_').slice(0,160),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
module.exports = {TYPES,FIELDS,COLLECTION,MAX_FILE,fail,uuid,actor,access,clean,complete,digest,fileBytes};
