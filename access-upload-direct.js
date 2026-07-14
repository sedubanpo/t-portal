(function(global) {
  'use strict';
  const text = value => String(value == null ? '' : value).trim();
  const normText = value => text(value).normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ');
  const normName = value => normText(value).replace(/\s+/g, '').replace(/\s*T$/i, '');
  const studentKey = value => normText(value).replace(/^\/+|\/+$/g, '').split('/')[0].replace(/\s+/g, '').toLowerCase();
  const parseTime = value => {
    const match = text(value).match(/(오전|오후|am|pm)?\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
    if (!match) return null;
    let hour = Number(match[2]);
    const minute = Number(match[3]);
    const ampm = String(match[1] || match[4] || '').toLowerCase();
    if ((ampm === '오후' || ampm === 'pm') && hour < 12) hour += 12;
    if ((ampm === '오전' || ampm === 'am') && hour === 12) hour = 0;
    return hour * 60 + minute;
  };
  const timeKey = value => {
    const minutes = parseTime(value);
    return minutes == null ? normText(value).replace(/\s+/g, '') : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  };
  const categoryKey = value => normText(value).replace(/\s+/g, '').replace(/(\-|^)\d+명개별/g, '$1개별').replace(/(\-|^)\d+명1:1/g, '$11:1').replace(/(\-|^)\d+명2:1/g, '$12:1').replace(/(\-|^)\d+명/g, '$1').replace(/--+/g, '-').replace(/^-|-$/g, '');
  const stableHash = value => {
    let a = 2166136261, b = 2246822519;
    for (const ch of String(value || '')) {
      a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
      b = Math.imul(b ^ ch.charCodeAt(0), 3266489917);
    }
    return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
  };
  function parseCsv(source) {
    const sample = String(source || '').split(/\r?\n/).filter(line => line.trim()).slice(0, 8).join('\n');
    const delimiter = (sample.match(/\t/g) || []).length > (sample.match(/,/g) || []).length ? '\t' : ',';
    const output = []; let row = [], cell = '', quoted = false;
    const input = String(source || '');
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i], next = input[i + 1];
      if (quoted) {
        if (ch === '"' && next === '"') { cell += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); output.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    row.push(cell); output.push(row); return output;
  }
  const header = value => text(value).replace(/^\uFEFF/, '').toLowerCase().replace(/\s+/g, '_');
  function pick(record, keys) {
    for (const key of keys) { const value = record[header(key)]; if (value != null && text(value)) return text(value); }
    return '';
  }
  function sourceYear(fileName, source) {
    const full = String(fileName || '').match(/(20\d{2})[-_. ]?\d{1,2}[-_. ]?\d{1,2}/) || String(source || '').match(/\b(20\d{2})[./-]\d{1,2}[./-]\d{1,2}\b/);
    if (full) return Number(full[1]);
    const short = String(fileName || '').match(/(^|[^\d])(\d{2})[-_. ](\d{1,2})([^\d]|$)/);
    return short ? 2000 + Number(short[2]) : new Date().getFullYear();
  }
  function dateKey(value, year) {
    const raw = text(value); if (!raw) return '';
    const full = raw.replace(/[./]/g, '-').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
    const md = raw.match(/(^|[^\d])(\d{1,2})[./-](\d{1,2})([^\d]|$)/);
    return md ? `${year}-${md[2].padStart(2, '0')}-${md[3].padStart(2, '0')}` : '';
  }
  function format(headers, fileName) {
    const set = new Set(headers); const name = String(fileName || '').normalize('NFKC').toLowerCase();
    if (set.has('이름') && set.has('수업일') && set.has('반명') && set.has('출결') && set.has('tr') && set.has('시간당') && set.has('금액')) return 'access-monthly-hours';
    if (set.has('이름') && set.has('수업일') && set.has('반명') && set.has('출결') && set.has('tr') && set.has('시작') && set.has('종료') && (set.has('시간') || set.has('시수'))) return 'access-daily';
    return name.includes('일일') || /\d{2,4}[-_.]\d{1,2}[-_.]\d{1,2}/.test(name) ? 'access-daily' : 'access-monthly';
  }
  const financial = key => ['시간당','금액','할인','amount','price','unit_price','hourly_rate','discount'].includes(header(key));
  function parse(source, fileName) {
    const table = parseCsv(source); if (table.length < 2) return { rows: [], parsedRows: 0, sourceDates: [] };
    const headers = table[0].map(header), year = sourceYear(fileName, source), sourceFormat = format(headers, fileName);
    const rows = []; let parsedRows = 0;
    table.slice(1).filter(row => row.some(cell => text(cell))).forEach(raw => {
      const rec = {}; headers.forEach((key, i) => { if (key) rec[key] = raw[i] || ''; });
      const rawDate = pick(rec, ['date','class_date','수업일','날짜','일자']);
      const teacher = pick(rec, ['teacher','teacher_name','강사','강사명','담당강사','tr']);
      const rawStudent = pick(rec, ['student','student_name','학생','학생명','수강생','이름']);
      const category = pick(rec, ['category','class_name','수업','수업명','수업유형','과목','반명']);
      if (!rawDate && !teacher && !rawStudent && !category) return;
      parsedRows += 1;
      const date = dateKey(rawDate, year), studentParts = text(rawStudent).replace(/^\/+|\/+$/g, '').split('/').map(text);
      if (!date || !teacher || !studentParts[0]) return;
      const start = pick(rec, ['start','start_time','시작','시작시간']), end = pick(rec, ['end','end_time','종료','종료시간']);
      const hoursRaw = pick(rec, ['hours','시수','수업시간','시간']); const match = hoursRaw.match(/[\d.]+/);
      const hours = match ? Number(match[0]) : Math.max(0, Number((((parseTime(end) || 0) - (parseTime(start) || 0)) / 60).toFixed(2)));
      const campus = pick(rec, ['campus','지점','캠퍼스','관']);
      const row = { class_date:date, display_date:rawDate, category, subject:text(category).split('-')[0], lesson_type:category.includes('1:1')?'1:1':category.includes('2:1')?'2:1':category.includes('보강')?'보강':category.includes('보충')?'보충':category.includes('개별')?'개별':'', student_name:studentParts[0], student_school:studentParts[1]||pick(rec,['school','학교']), student_grade:studentParts[2]||pick(rec,['grade','학년']), teacher_name:teacher, status:pick(rec,['status','출결','출석상태','상태']), campus, start_time_text:start, end_time_text:end, hours, note:pick(rec,['note','memo','비고','메모','참고']), raw_student:rawStudent, raw_row:Object.fromEntries(Object.entries(rec).filter(([key])=>!financial(key))) };
      row._base = ['attendance',date,normName(teacher),studentKey(studentParts[0]),timeKey(start),timeKey(end),normText(category),normText(campus)].join('|'); rows.push(row);
    });
    const counts = {}; rows.forEach(row => { counts[row._base]=(counts[row._base]||0)+1; row.legacy_key=`${row._base}|#${counts[row._base]}`; delete row._base; });
    const sourceDates = [...new Set(rows.map(row=>row.class_date))].sort();
    return { rows, parsedRows, headers:headers.filter(key=>!financial(key)), inferredYear:year, sourceFormat, isMonthlySource:sourceFormat==='access-monthly-hours'||sourceFormat==='access-monthly', isDailySource:sourceFormat==='access-daily', sourceDates, sourceMonth:sourceDates[0]?.slice(0,7)||'', minDate:sourceDates[0]||'', maxDate:sourceDates[sourceDates.length-1]||'' };
  }
  function dedupe(rows) { const map=new Map(); (rows||[]).forEach(row=>{const key=[row.class_date,normName(row.teacher_name),studentKey(row.student_name||row.raw_student),timeKey(row.start_time_text),timeKey(row.end_time_text),categoryKey(row.category),normText(row.campus)].join('|');const prev=map.get(key);if(!prev||String(row.updated_at||'')>String(prev.updated_at||''))map.set(key,row);});return [...map.values()]; }
  function diff(before,after){return [['status','상태'],['hours','시간'],['note','비고'],['start_time_text','시작'],['end_time_text','종료'],['category','수업'],['teacher_name','강사'],['student_name','학생']].flatMap(([key,label])=>{const a=key==='hours'?Number(before[key]||0).toFixed(2):text(before[key]),b=key==='hours'?Number(after[key]||0).toFixed(2):text(after[key]);return a===b?[]:[{field:label,before:a,after:b}];});}
  const summaryRow=row=>row?{date:text(row.class_date),teacher:text(row.teacher_name),student:text(row.student_name||row.raw_student),category:text(row.category),status:text(row.status),start:text(row.start_time_text),end:text(row.end_time_text),hours:Number(row.hours||0),note:text(row.note)}:null;
  function candidate(type,existing,incoming,changes,options={}){const basis=[type,existing&&(existing.id||existing.legacy_key)||'',incoming&&incoming.legacy_key||''].join('|');return{id:stableHash(basis).slice(0,24),type,recommendedAction:options.recommendedAction||'',reason:options.reason||'',coverage:options.coverage??null,existing:summaryRow(existing),incoming:summaryRow(incoming),existingId:existing?.id?String(existing.id):'',incomingLegacyKey:incoming?.legacy_key?String(incoming.legacy_key):'',changes:changes||[]};}
  function buildPlan(incomingRows, existingRows){const incoming=dedupe(incomingRows),existing=dedupe(existingRows),byLegacy=Object.fromEntries(existing.filter(r=>r.legacy_key).map(r=>[r.legacy_key,r])),matched=new Set(),candidates=[],unchanged=[],unmatched=[];incoming.forEach(row=>{const old=byLegacy[row.legacy_key];if(!old){unmatched.push(row);return;}if(old.id)matched.add(String(old.id));const changes=diff(old,row);changes.length?candidates.push(candidate('update',old,row,changes,{recommendedAction:'overwrite',reason:'같은 수업의 상태·시수·비고 등 변경 사항이 확인되었습니다.'})):unchanged.push(row);});unmatched.forEach(row=>{const matches=existing.filter(old=>!matched.has(String(old.id||''))&&old.class_date===row.class_date&&studentKey(old.student_name||old.raw_student)===studentKey(row.student_name||row.raw_student));let picked=null;if(matches.length===1)picked=matches[0];else if(matches.length>1){const scored=matches.map(old=>({old,score:(normName(old.teacher_name)===normName(row.teacher_name)?4:0)+(timeKey(old.start_time_text)===timeKey(row.start_time_text)?3:0)+(timeKey(old.end_time_text)===timeKey(row.end_time_text)?3:0)+(categoryKey(old.category)===categoryKey(row.category)?2:0)})).sort((a,b)=>b.score-a.score);if(scored[0].score>=2&&(!scored[1]||scored[0].score!==scored[1].score))picked=scored[0].old;}if(picked){if(picked.id)matched.add(String(picked.id));const changes=diff(picked,row);candidates.push(candidate('identity_change',picked,row,changes,{recommendedAction:'replace',reason:'같은 날짜·학생의 기존 수업에서 강사명 또는 시작·종료 시간이 달라졌습니다.'}));}else candidates.push(candidate('create',null,row,[],{recommendedAction:'create',reason:'기존 데이터에서 대응하는 수업을 찾지 못해 신규 수업으로 예상됩니다.'}));});const ic={},ec={};incoming.forEach(r=>ic[r.class_date]=(ic[r.class_date]||0)+1);existing.forEach(r=>ec[r.class_date]=(ec[r.class_date]||0)+1);existing.forEach(row=>{if(row.id&&matched.has(String(row.id)))return;const coverage=(ic[row.class_date]||0)/(ec[row.class_date]||1),partial=coverage<.7;candidates.push(candidate('delete',row,null,[],{recommendedAction:partial?'preserve':'delete',reason:partial?'새 파일의 해당 날짜 행 수가 기존보다 현저히 적어 부분 수정본일 가능성이 있습니다.':'새 파일에서 기존 수업이 사라져 오입력 삭제 후보로 판단됩니다.',coverage}));});const summary={unchanged:unchanged.length,create:0,update:0,identityChange:0,delete:0,reviewRequired:candidates.length};candidates.forEach(c=>{if(c.type==='identity_change')summary.identityChange++;else summary[c.type]++;});return{planHash:stableHash(JSON.stringify(candidates)+incoming.map(r=>r.legacy_key).sort().join('|')),summary,candidates,unchangedRows:unchanged,incomingRows:incoming,existingRows:existing};}
  function resolve(plan,resolutions={}){const incoming=Object.fromEntries(plan.incomingRows.map(row=>[row.legacy_key,row])),rows=[...plan.unchangedRows],deleteIds=[],summary={unchanged:plan.unchangedRows.length,created:0,overwritten:0,replaced:0,preserved:0,deleted:0,skipped:0};for(const c of plan.candidates){const action=String(resolutions[c.id]||c.recommendedAction||''),row=incoming[c.incomingLegacyKey];if(c.type==='create'){if(action==='create'&&row){rows.push(row);summary.created++;}else summary.skipped++;}else if(c.type==='update'){if(action==='overwrite'&&row){rows.push(row);summary.overwritten++;}else summary.preserved++;}else if(c.type==='identity_change'){if(action==='replace'&&row){if(c.existingId)deleteIds.push(c.existingId);rows.push(row);summary.replaced++;}else if(action==='create'&&row){rows.push(row);summary.created++;}else summary.preserved++;}else if(c.type==='delete'){if(action==='delete'&&c.existingId){deleteIds.push(c.existingId);summary.deleted++;}else summary.preserved++;}}const deleted=new Set(deleteIds),finalRows=dedupe(plan.existingRows.filter(r=>!deleted.has(String(r.id))).concat(rows));return{rowsToUpsert:dedupe(rows),idsToDelete:[...deleted],finalRows,summary};}
  global.PortalAccessUploadEngine=Object.freeze({parse,buildPlan,resolve,stableHash});
})(window);
