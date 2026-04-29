#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');
const filePath = process.argv.find(arg => arg && !arg.startsWith('--') && arg !== process.argv[0] && arg !== process.argv[1]);

if (!filePath) {
  console.error('Usage: node scripts/import-attendance-csv.mjs [--dry-run] <access-export.csv>');
  process.exit(1);
}

if (!dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const raw = await readFile(filePath, 'utf8');
const sourceHash = createHash('sha256').update(raw).digest('hex');
const parsed = parseAttendanceCsv(raw, path.basename(filePath));
let batchId = dryRun ? 'DRY_RUN' : null;

if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    sourceFile: path.basename(filePath),
    sourceHash,
    parsedRows: parsed.parsedRows,
    importableRows: parsed.rows.length,
    headers: parsed.headers,
    inferredYear: parsed.inferredYear,
    sourceFormat: parsed.sourceFormat,
    sourceMonth: parsed.sourceMonth,
    sample: parsed.rows.slice(0, 5)
  }, null, 2));
  process.exit(0);
}

if (!parsed.rows.length) {
  console.error('No importable rows found.');
  process.exit(1);
}

const batch = await createOrFindImportBatch({
  source: parsed.sourceFormat || 'access-export',
  source_file: path.basename(filePath),
  source_hash: sourceHash,
  row_count: parsed.rows.length,
  status: 'pending',
  metadata: {
    headers: parsed.headers,
    inferredYear: parsed.inferredYear,
    sourceFormat: parsed.sourceFormat,
    sourceMonth: parsed.sourceMonth
  }
});
batchId = batch.id;

const attendanceRows = parsed.rows.map(row => ({
  ...row,
  import_batch_id: batchId
}));

await upsertTeachers(attendanceRows);
await upsertStudents(attendanceRows);
await supabaseUpsert('attendance_logs', attendanceRows, 'legacy_key');

let reconcile = { staleRowsRemoved: 0, warning: '' };
if (parsed.isMonthlySource) {
  reconcile = await reconcileMonthlyAttendance(parsed, attendanceRows);
}

await supabasePatch('import_batches', batchId, {
  status: 'completed',
  row_count: attendanceRows.length,
  note: [
    batch.duplicate ? 'Duplicate source hash re-uploaded from local script.' : '',
    reconcile.warning ? `Reconcile warning: ${reconcile.warning}` : '',
    reconcile.staleRowsRemoved ? `Removed stale monthly rows: ${reconcile.staleRowsRemoved}` : ''
  ].filter(Boolean).join(' / ')
});

console.log(JSON.stringify({
  ok: true,
  batchId,
  sourceFile: path.basename(filePath),
  parsedRows: parsed.parsedRows,
  importedRows: attendanceRows.length,
  sourceFormat: parsed.sourceFormat,
  staleRowsRemoved: reconcile.staleRowsRemoved,
  reconcileWarning: reconcile.warning
}, null, 2));

function parseAttendanceCsv(text, fileName) {
  const rows = parseCsv(text);
  const headers = rows.length ? rows[0].map(normalizeHeader) : [];
  const sourceFormat = detectCsvFormat(headers);
  const sourceYear = inferSourceYear(fileName, text);
  const dataRows = rows.slice(1).filter(row => row.some(cell => String(cell || '').trim()));
  const out = [];
  let parsedRows = 0;
  let minDate = '';
  let maxDate = '';

  for (const [index, row] of dataRows.entries()) {
    const record = rowToObject(headers, row);
    const rawDate = get(record, ['date', 'class_date', '수업일', '날짜', '일자']);
    const teacherName = cleanText(get(record, ['teacher', 'teacher_name', '강사', '강사명', '담당강사', 'tr']));
    const rawStudent = cleanText(get(record, ['student', 'student_name', '학생', '학생명', '수강생', '이름']));
    const category = cleanText(get(record, ['category', 'class_name', '수업', '수업명', '수업유형', '과목', '반명']));
    if (isSummaryRow(record, rawDate, rawStudent, teacherName, category)) continue;

    parsedRows++;
    const classDate = normalizeDate(rawDate, sourceYear);
    const parsedStudent = parseStudent(rawStudent);
    const status = cleanText(get(record, ['status', '출결', '출석상태', '상태']));
    const start = cleanText(get(record, ['start', 'start_time', '시작', '시작시간']));
    const end = cleanText(get(record, ['end', 'end_time', '종료', '종료시간']));
    const parsedHours = parseHours(get(record, ['hours', '시수', '수업시간', '시간']));
    const hours = parsedHours === null ? calculateHours(start, end) : parsedHours;
    const campus = cleanText(get(record, ['campus', '지점', '캠퍼스', '관']));
    if (!classDate || !teacherName || !parsedStudent.name) continue;

    if (!minDate || classDate < minDate) minDate = classDate;
    if (!maxDate || classDate > maxDate) maxDate = classDate;
    out.push({
      legacy_key: '',
      _legacy_base_key: buildLegacyBaseKey(classDate, teacherName, parsedStudent.name, start, end, category, campus),
      class_date: classDate,
      display_date: cleanText(get(record, ['display_date', '표시일', '일자표시'])) || cleanText(rawDate),
      category,
      subject: parseSubject(category),
      lesson_type: parseLessonType(category),
      student_name: parsedStudent.name,
      student_school: parsedStudent.school || cleanText(get(record, ['school', '학교'])),
      student_grade: parsedStudent.grade || cleanText(get(record, ['grade', '학년'])),
      teacher_name: teacherName,
      status,
      campus,
      start_time_text: start,
      end_time_text: end,
      hours,
      note: cleanText(get(record, ['note', 'memo', '비고', '메모', '참고'])),
      raw_student: rawStudent,
      raw_row: record
    });
  }

  assignLegacyKeys(out);
  const sourceMonth = minDate ? minDate.slice(0, 7) : '';
  return {
    rows: out,
    parsedRows,
    headers,
    inferredYear: sourceYear,
    sourceFormat,
    isMonthlySource: sourceFormat === 'access-monthly-hours' || sourceFormat === 'access-monthly',
    sourceMonth,
    monthStart: sourceMonth ? `${sourceMonth}-01` : '',
    monthEnd: sourceMonth ? getNextMonthStart(`${sourceMonth}-01`) : '',
    minDate,
    maxDate
  };
}

function parseCsv(text) {
  const out = [];
  let row = [];
  let cell = '';
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quote = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quote = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); out.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  row.push(cell);
  out.push(row);
  return out;
}

function normalizeHeader(value) {
  return String(value || '').trim().replace(/^\uFEFF/, '').toLowerCase().replace(/\s+/g, '_');
}

function detectCsvFormat(headers) {
  const set = {};
  for (const h of headers || []) set[h] = true;
  if (set['이름'] && set['수업일'] && set['반명'] && set['출결'] && set['tr'] && set['시간당'] && set['금액']) return 'access-monthly-hours';
  if (set['이름'] && set['수업일'] && set['반명'] && set['출결'] && set['tr']) return 'access-monthly';
  return 'access-daily';
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, index) => {
    if (!header) return;
    obj[header] = row[index] ?? '';
  });
  return obj;
}

function get(row, keys) {
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    if (row[normalized] !== undefined && String(row[normalized]).trim() !== '') return row[normalized];
  }
  return '';
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function isSummaryRow(record, rawDate, rawStudent, teacherName, category) {
  if (cleanText(rawDate) || cleanText(rawStudent) || cleanText(teacherName) || cleanText(category)) return false;
  return !!(
    cleanText(get(record, ['status', '출결', '출석상태', '상태'])) ||
    cleanText(get(record, ['hours', '시수', '수업시간', '시간'])) ||
    cleanText(get(record, ['금액', 'amount']))
  );
}

function inferSourceYear(fileName, text) {
  let match = String(fileName || '').match(/(20\d{2})[-_. ]?\d{1,2}[-_. ]?\d{1,2}/);
  if (match) return Number(match[1]);
  match = String(fileName || '').match(/(^|[^\d])(\d{2})[-_. ](\d{1,2})([^\d]|$)/);
  if (match) return 2000 + Number(match[2]);
  match = String(text || '').match(/\b(20\d{2})[./-]\d{1,2}[./-]\d{1,2}\b/);
  if (match) return Number(match[1]);
  return new Date().getFullYear();
}

function parseStudent(value) {
  const parts = cleanText(value).replace(/^\/+|\/+$/g, '').split('/').map(v => v.trim());
  return {
    name: parts[0] || '',
    school: parts[1] || '',
    grade: parts[2] || ''
  };
}

function normalizeDate(value, defaultYear) {
  const rawValue = cleanText(value);
  if (!rawValue) return '';
  const raw = rawValue.replace(/[.\/]/g, '-');
  const full = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
  const monthDay = rawValue.match(/(^|[^\d])(\d{1,2})[./-](\d{1,2})([^\d]|$)/);
  if (monthDay) return `${Number(defaultYear || new Date().getFullYear())}-${monthDay[2].padStart(2, '0')}-${monthDay[3].padStart(2, '0')}`;
  const fallback = new Date(rawValue);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString().slice(0, 10);
  return '';
}

function parseHours(value) {
  const text = cleanText(value);
  if (!text) return null;
  const match = text.match(/[\d.]+/);
  return match ? Number(match[0]) : null;
}

function parseTimeMinutes(value) {
  const raw = cleanText(value);
  const match = raw.match(/(오전|오후|am|pm)?\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3]);
  const ampm = String(match[1] || match[4] || '').toLowerCase();
  if ((ampm === '오후' || ampm === 'pm') && hour < 12) hour += 12;
  if ((ampm === '오전' || ampm === 'am') && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function calculateHours(start, end) {
  const s = parseTimeMinutes(start);
  const e = parseTimeMinutes(end);
  if (s === null || e === null || e <= s) return 0;
  return Number(((e - s) / 60).toFixed(2));
}

function parseSubject(category) {
  const text = cleanText(category);
  if (!text) return '';
  const first = text.split('-')[0].trim();
  if (first) return first;
  if (text.includes('수학')) return '수학';
  if (text.includes('영어')) return '영어';
  if (text.includes('국어')) return '국어';
  if (text.includes('과학') || text.includes('과탐')) return '과탐';
  if (text.includes('사탐') || text.includes('사회')) return '사탐';
  return '기타';
}

function parseLessonType(category) {
  const text = cleanText(category);
  if (text.includes('1:1')) return '1:1';
  if (text.includes('2:1')) return '2:1';
  if (text.includes('보강')) return '보강';
  if (text.includes('보충')) return '보충';
  if (text.includes('개별')) return '개별';
  return '';
}

function assignLegacyKeys(rows) {
  const counts = new Map();
  for (const row of rows) {
    const base = row._legacy_base_key || '';
    const next = (counts.get(base) || 0) + 1;
    counts.set(base, next);
    row.legacy_key = `${base}|#${next}`;
    delete row._legacy_base_key;
  }
}

function buildLegacyBaseKey(classDate, teacherName, studentName, start, end, category, campus) {
  return [
    'attendance',
    classDate,
    normalizeName(teacherName),
    normalizeName(studentName),
    normalizeKeyTime(start),
    normalizeKeyTime(end),
    normalizeKeyText(category),
    normalizeKeyText(campus)
  ].join('|');
}

function normalizeKeyText(value) {
  return cleanText(value).replace(/\s+/g, ' ');
}

function normalizeKeyTime(value) {
  const minutes = parseTimeMinutes(value);
  if (minutes === null) return normalizeKeyText(value);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeName(value) {
  return cleanText(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s*T$/i, '')
    .replace(/\s+/g, '');
}

function getNextMonthStart(monthStart) {
  const [y, m] = String(monthStart || '').split('-').map(Number);
  if (!y || !m) return '';
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}-01`;
}

async function reconcileMonthlyAttendance(parsed, rows) {
  const result = { staleRowsRemoved: 0, warning: '' };
  try {
    if (!parsed.monthStart || !parsed.monthEnd || !rows.length) return result;
    const batches = await supabaseSelect('/rest/v1/import_batches?select=id&source=in.(access-monthly-hours,access-monthly)&limit=1000');
    const batchIds = [...new Set([
      ...(batches || []).map(batch => batch.id).filter(Boolean),
      ...rows.map(row => row.import_batch_id).filter(Boolean)
    ])];
    if (!batchIds.length) return result;

    const currentKeys = new Set(rows.map(row => row.legacy_key).filter(Boolean));
    const staleIds = [];
    for (const idChunk of chunkArray(batchIds, 80)) {
      const found = await supabaseSelect(
        `/rest/v1/attendance_logs?select=id,legacy_key` +
        `&class_date=gte.${encodeURIComponent(parsed.monthStart)}` +
        `&class_date=lt.${encodeURIComponent(parsed.monthEnd)}` +
        `&import_batch_id=in.(${idChunk.map(encodeURIComponent).join(',')})` +
        `&limit=10000`
      );
      for (const row of found || []) {
        if (row.id && !currentKeys.has(row.legacy_key)) staleIds.push(row.id);
      }
    }

    for (const idChunk of chunkArray(staleIds, 80)) {
      await supabaseDelete(`/rest/v1/attendance_logs?id=in.(${idChunk.map(encodeURIComponent).join(',')})`);
    }
    result.staleRowsRemoved = staleIds.length;
  } catch (err) {
    result.warning = String(err && err.message ? err.message : err).slice(0, 300);
  }
  return result;
}

async function upsertTeachers(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeName(row.teacher_name);
    if (!key || map.has(key)) continue;
    map.set(key, {
      display_name: row.teacher_name,
      normalized_name: key,
      subject: row.subject || '',
      active: true,
      source_metadata: { source: 'local-import' }
    });
  }
  if (map.size) await supabaseUpsert('teachers', [...map.values()], 'normalized_name');
}

async function upsertStudents(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = [
      normalizeName(row.student_name),
      row.student_school || '',
      row.student_grade || ''
    ].join('|');
    if (!row.student_name || map.has(key)) continue;
    map.set(key, {
      display_name: row.student_name,
      normalized_name: normalizeName(row.student_name),
      school: row.student_school || '',
      grade: row.student_grade || '',
      school_level: inferSchoolLevel(row.student_school, row.student_grade),
      active: true,
      source_metadata: { source: 'local-import' }
    });
  }
  if (map.size) await supabaseUpsert('students', [...map.values()], 'normalized_name,school_key,grade_key');
}

function inferSchoolLevel(school, grade) {
  const text = `${school || ''} ${grade || ''}`;
  if (/[고高]|고등/.test(text)) return '고등';
  if (/[중中]|중등/.test(text)) return '중등';
  if (/[초小]|초등/.test(text)) return '초등';
  return '';
}

async function createOrFindImportBatch(batch) {
  try {
    const created = await supabaseInsert('import_batches', batch);
    if (created) return created;
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    if (!message.includes('23505') && !message.toLowerCase().includes('duplicate')) throw err;
  }
  const found = await supabaseSelect(`/rest/v1/import_batches?select=id&source_hash=eq.${encodeURIComponent(batch.source_hash)}&limit=1`);
  if (found && found.length) return { id: found[0].id, duplicate: true };
  throw new Error('Import batch creation failed.');
}

async function supabaseInsert(table, body) {
  const res = await request(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
  return res[0];
}

async function supabasePatch(table, id, body) {
  await request(`/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
}

async function supabaseSelect(pathname) {
  return request(pathname, { method: 'GET' });
}

async function supabaseDelete(pathname) {
  return request(pathname, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
}

async function supabaseUpsert(table, rows, onConflict) {
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk)
    });
  }
}

async function request(pathname, options) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
