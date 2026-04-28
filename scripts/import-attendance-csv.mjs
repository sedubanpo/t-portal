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
const rows = parseCsv(raw);
if (rows.length < 2) {
  console.error('No data rows found.');
  process.exit(1);
}

const headers = rows[0].map(normalizeHeader);
const dataRows = rows.slice(1).filter(row => row.some(cell => String(cell || '').trim()));
let batchId = dryRun ? 'DRY_RUN' : null;
const attendanceRows = dataRows.map((row, index) => {
  const record = rowToObject(headers, row);
  const classDate = normalizeDate(get(record, ['date', 'class_date', '수업일', '날짜', '일자']));
  const teacherName = cleanText(get(record, ['teacher', 'teacher_name', '강사', '강사명', '담당강사']));
  const rawStudent = cleanText(get(record, ['student', 'student_name', '학생', '학생명', '수강생']));
  const parsedStudent = parseStudent(rawStudent);
  const category = cleanText(get(record, ['category', 'class_name', '수업', '수업명', '수업유형', '과목']));
  const status = cleanText(get(record, ['status', '출결', '출석상태', '상태']));
  const start = cleanText(get(record, ['start', 'start_time', '시작', '시작시간']));
  const end = cleanText(get(record, ['end', 'end_time', '종료', '종료시간']));
  const hours = parseHours(get(record, ['hours', '시수', '수업시간', '시간'])) || calculateHours(start, end);
  const legacyKey = [
    classDate,
    teacherName,
    parsedStudent.name,
    start,
    end,
    category,
    index + 2
  ].join('|');

  return {
    legacy_key: legacyKey,
    class_date: classDate,
    display_date: cleanText(get(record, ['display_date', '표시일', '일자표시'])),
    category,
    subject: parseSubject(category),
    lesson_type: parseLessonType(category),
    student_name: parsedStudent.name,
    student_school: parsedStudent.school || cleanText(get(record, ['school', '학교'])),
    student_grade: parsedStudent.grade || cleanText(get(record, ['grade', '학년'])),
    teacher_name: teacherName,
    status,
    campus: cleanText(get(record, ['campus', '지점', '캠퍼스'])),
    start_time_text: start,
    end_time_text: end,
    hours,
    note: cleanText(get(record, ['note', 'memo', '비고', '메모'])),
    raw_student: rawStudent,
    raw_row: record,
    import_batch_id: batchId
  };
}).filter(row => row.class_date && row.teacher_name && row.student_name);

if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    sourceFile: path.basename(filePath),
    sourceHash,
    parsedRows: dataRows.length,
    importableRows: attendanceRows.length,
    headers,
    sample: attendanceRows.slice(0, 5)
  }, null, 2));
  process.exit(0);
}

const batch = await supabaseInsert('import_batches', {
  source: 'access-export',
  source_file: path.basename(filePath),
  source_hash: sourceHash,
  row_count: dataRows.length,
  status: 'pending',
  metadata: { headers }
});
batchId = batch.id;
attendanceRows.forEach(row => {
  row.import_batch_id = batchId;
});

await upsertTeachers(attendanceRows);
await upsertStudents(attendanceRows);
await supabaseUpsert('attendance_logs', attendanceRows, 'legacy_key');
await supabasePatch('import_batches', batchId, {
  status: 'completed',
  row_count: attendanceRows.length
});

console.log(JSON.stringify({
  ok: true,
  batchId,
  sourceFile: path.basename(filePath),
  parsedRows: dataRows.length,
  importedRows: attendanceRows.length
}, null, 2));

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
    if (ch === '"') {
      quote = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  row.push(cell);
  out.push(row);
  return out;
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/\s+/g, '_');
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

function parseStudent(value) {
  const parts = cleanText(value).replace(/^\/+|\/+$/g, '').split('/').map(v => v.trim());
  return {
    name: parts[0] || '',
    school: parts[1] || '',
    grade: parts[2] || ''
  };
}

function normalizeDate(value) {
  const rawValue = cleanText(value);
  if (!rawValue) return '';
  const raw = rawValue.replace(/[.\/]/g, '-');
  const match = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const fallback = new Date(rawValue);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString().slice(0, 10);
  return '';
}

function parseHours(value) {
  const match = cleanText(value).match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
}

function parseTimeMinutes(value) {
  const raw = cleanText(value);
  const match = raw.match(/(오전|오후)?\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3]);
  if (match[1] === '오후' && hour < 12) hour += 12;
  if (match[1] === '오전' && hour === 12) hour = 0;
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
  if (text.includes('과학')) return '과학';
  if (text.includes('사탐') || text.includes('사회')) return '사탐';
  return '기타';
}

function parseLessonType(category) {
  const text = cleanText(category);
  if (text.includes('1:1')) return '1:1';
  if (text.includes('2:1')) return '2:1';
  if (text.includes('보강')) return '보강';
  if (text.includes('보충')) return '보충';
  return '개별';
}

function normalizeName(value) {
  return cleanText(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s*T$/i, '')
    .replace(/\s+/g, '');
}

async function upsertTeachers(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeName(row.teacher_name);
    if (!key || map.has(key)) continue;
    map.set(key, {
      display_name: row.teacher_name,
      normalized_name: key
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
      school: row.student_school || null,
      grade: row.student_grade || null
    });
  }
  if (map.size) await supabaseUpsert('students', [...map.values()], 'normalized_name,school_key,grade_key');
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
