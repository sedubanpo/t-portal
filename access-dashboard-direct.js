(function(global) {
  'use strict';
  const text = value => String(value == null ? '' : value).trim();
  const statusBucket = status => {
    const value = text(status);
    if (value.includes('당일취소') || value === '취소') return 'canceled';
    if (value.includes('결석예고') || value.includes('결석 예정') || value.includes('예고')) return 'absentNotice';
    if (!value || value.includes('출석')) return 'attended';
    return 'other';
  };
  const row = value => ({
    date: text(value.class_date || value.date), teacher: text(value.teacher_name || value.teacher),
    student: text(value.student_name || value.student), school: text(value.student_school || value.school),
    grade: text(value.student_grade || value.grade), category: text(value.category), status: text(value.status),
    statusBucket: text(value.statusBucket) || statusBucket(value.status), hours: Number(value.hours || 0),
    start: text(value.start_time_text || value.start), end: text(value.end_time_text || value.end), note: text(value.note),
    updatedAt: text(value.updated_at || value.updatedAt), importBatchId: text(value.import_batch_id || value.importBatchId)
  });
  const compareRows = (a, b) => [a.date, a.start, a.teacher, a.student].join('|').localeCompare([b.date, b.start, b.teacher, b.student].join('|'), 'ko');
  function batchDates(batch) {
    const metadata = batch.metadata || {}, dates = new Set();
    (metadata.sourceDates || []).forEach(value => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && dates.add(text(value)));
    [metadata.minDate, metadata.maxDate].forEach(value => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && dates.add(text(value)));
    const summary = metadata.uploadSummary || {}, reconcile = metadata.reconcile || {};
    [summary.addedByDate, summary.changedByDate, reconcile.staleByDate].forEach(map => Object.keys(map || {}).forEach(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && dates.add(value)));
    (summary.addedSamples || []).concat(summary.changedSamples || [], reconcile.staleSamples || []).forEach(sample => {
      const value = text(sample && (sample.date || sample.class_date)); if (/^\d{4}-\d{2}-\d{2}$/.test(value)) dates.add(value);
    });
    return [...dates].sort();
  }
  function formatBatch(batch, selectedDate) {
    const metadata = batch.metadata || {}, summary = metadata.uploadSummary || {}, reconcile = metadata.reconcile || {};
    return {
      id:text(batch.id), shortId:text(batch.id).slice(0,8), source:text(batch.source), sourceFile:text(batch.source_file),
      importedBy:text(batch.imported_by), importedAt:text(batch.imported_at), rowCount:Number(batch.row_count || 0),
      status:text(batch.status), sourceFormat:text(metadata.sourceFormat || batch.source), sourceMonth:text(metadata.sourceMonth),
      revision:Number(metadata.revision || 0), sourceLabel:batch.source === 'intranet' ? '인트라넷' : 'Access',
      sourceDates:batchDates(batch), addedRows:Number(summary.addedRows || 0), changedRows:Number(summary.changedRows || 0),
      unchangedRows:Number(summary.unchangedRows || 0), staleRowsRemoved:Number(reconcile.staleRowsRemoved || 0),
      dateAddedRows:Number((summary.addedByDate || {})[selectedDate] || 0), dateChangedRows:Number((summary.changedByDate || {})[selectedDate] || 0),
      dateStaleRowsRemoved:Number((reconcile.staleByDate || {})[selectedDate] || 0), changedByDate:summary.changedByDate || {},
      changedByTeacherDate:summary.changedByTeacherDate || {}, addedByDate:summary.addedByDate || {}, staleByDate:reconcile.staleByDate || {},
      changedSamples:summary.changedSamples || [], addedSamples:summary.addedSamples || [], removedSamples:reconcile.staleSamples || [], note:text(batch.note)
    };
  }
  const inMonth = (batch, monthKey) => text((batch.metadata || {}).sourceMonth) === monthKey || batchDates(batch).some(value => value.startsWith(monthKey));
  function buildStats(rows) {
    const dayMap = {}, teachers = new Set(), students = new Set(), statusCounts = {attended:0,canceled:0,absentNotice:0,other:0};
    const quality = {missingTeacher:0,missingStudent:0,missingTime:0,zeroHourActive:0}; let latestUpdatedAt = '';
    rows.forEach(item => {
      if (!dayMap[item.date]) dayMap[item.date] = {date:item.date,total:0,attended:0,canceled:0,absentNotice:0,other:0,hours:0};
      const bucket = statusCounts[item.statusBucket] == null ? 'other' : item.statusBucket;
      dayMap[item.date].total += 1; dayMap[item.date][bucket] += 1; dayMap[item.date].hours += item.hours; statusCounts[bucket] += 1;
      if (item.teacher) teachers.add(item.teacher); else quality.missingTeacher += 1;
      if (item.student) students.add(item.student); else quality.missingStudent += 1;
      if (!item.start || !item.end) quality.missingTime += 1;
      if (!item.hours && bucket === 'attended') quality.zeroHourActive += 1;
      if (item.updatedAt > latestUpdatedAt) latestUpdatedAt = item.updatedAt;
    });
    Object.values(dayMap).forEach(day => { day.hours = Math.round(day.hours * 10) / 10; });
    return {dayMap,teacherCount:teachers.size,studentCount:students.size,statusCounts,quality,latestUpdatedAt};
  }
  function buildOverview(rawRows, rawBatches, year, month, selectedDate) {
    const monthKey = `${year}-${String(month).padStart(2,'0')}`;
    let rows = rawRows.map(row).filter(item => item.date.startsWith(monthKey)).sort(compareRows);
    // Legacy intranet batches have no date metadata. Link only surviving rows;
    // never present that fallback as an immutable historical snapshot.
    const linkedDates = new Map();
    rows.forEach(item => {
      if (!item.importBatchId) return;
      if (!linkedDates.has(item.importBatchId)) linkedDates.set(item.importBatchId, new Set());
      linkedDates.get(item.importBatchId).add(item.date);
    });
    const batches = rawBatches.map(batch => batch.source === 'intranet' && !batchDates(batch).length
      ? {...batch, metadata:{...batch.metadata, sourceDates:[...(linkedDates.get(batch.id) || [])]}} : batch)
      .filter(batch => batch.status === 'completed' && ['access-daily','intranet'].includes(batch.source) && inMonth(batch, monthKey));
    const versionsByDate = {};
    batches.forEach(batch => batchDates(batch).filter(date => date.startsWith(monthKey)).forEach(date => {
      (versionsByDate[date] ||= []).push(formatBatch(batch, date));
    }));
    Object.values(versionsByDate).forEach(items => items.sort((a,b)=>b.importedAt.localeCompare(a.importedAt)));
    const stats = buildStats(rows), dates = Object.keys(stats.dayMap).sort();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text(selectedDate)) || !text(selectedDate).startsWith(monthKey)) selectedDate = dates.at(-1) || `${monthKey}-01`;
    return {success:true,source:'supabase-access-attendance-direct',year,month,monthKey,monthLabel:`${year}년 ${month}월`,selectedDate,
      latestUpdatedAt:stats.latestUpdatedAt,dayMap:stats.dayMap,allRows:rows,versionsByDate,selectedDay:stats.dayMap[selectedDate] || {date:selectedDate,total:0,attended:0,canceled:0,absentNotice:0,other:0,hours:0},
      selectedRows:rows.filter(item=>item.date===selectedDate),versions:versionsByDate[selectedDate]||[],summary:{rows:rows.length,teachers:stats.teacherCount,students:stats.studentCount,coverageDays:dates.length,batches:batches.length,statusCounts:stats.statusCounts,quality:stats.quality}};
  }
  function buildDashboard(rawRows, rawBatches, year, month) {
    const rows = rawRows.map(row), teachers = new Set(), students = new Set(), statusCounts = {}; let hours = 0;
    rows.forEach(item => { if(item.teacher)teachers.add(item.teacher);if(item.student)students.add(item.student);statusCounts[item.status||'미기재']=(statusCounts[item.status||'미기재']||0)+1;hours+=item.hours; });
    return {success:true,monthStart:`${year}-${String(month).padStart(2,'0')}-01`,monthLabel:`${year}년 ${month}월`,monthSummary:{rows:rows.length,hours:Math.round(hours*10)/10,teachers:teachers.size,students:students.size,statusCounts},recentBatches:rawBatches.slice(0,12).map(batch=>formatBatch(batch,''))};
  }
  function buildPreview(rawRows, year, month, teacher, student, limit) {
    const teacherNeedle=text(teacher).replace(/\s+/g,''),studentNeedle=text(student).replace(/\s+/g,'');
    const rows=rawRows.map(row).filter(item=>(!teacherNeedle||item.teacher.replace(/\s+/g,'').includes(teacherNeedle))&&(!studentNeedle||[item.student,item.school,item.grade].join(' ').replace(/\s+/g,'').includes(studentNeedle)));
    const stats=buildStats(rows);return{success:true,monthLabel:`${year}년 ${month}월`,sourcePolicy:'direct',summary:{rows:rows.length,hours:Math.round(rows.reduce((sum,item)=>sum+item.hours,0)*10)/10,teachers:stats.teacherCount,students:stats.studentCount},rows:rows.slice(0,Math.max(1,Math.min(200,Number(limit)||80)))};
  }
  function buildVersion(batch, rawRows, dateKey, monthKey) {
    const metadata=batch.metadata||{},available=Array.isArray(metadata.accessRowsSnapshot)&&(metadata.accessRowsSnapshot.length>0||metadata.snapshotFormatVersion===1),snapshot=available?metadata.accessRowsSnapshot.map(row):[];
    let rows=available?snapshot.map(item=>({...item,action:'반영'})):rawRows.map(row).filter(item=>item.importBatchId===batch.id);
    if (available && Array.isArray(metadata.deletedRowsSnapshot)) rows=rows.concat(metadata.deletedRowsSnapshot.map(value=>({...row(value),action:'삭제'})));
    rows=rows.map(item=>({...item,importBatchId:text(batch.id),updatedAt:item.updatedAt||text(batch.imported_at)}));
    if(dateKey)rows=rows.filter(item=>item.date===dateKey);else if(monthKey)rows=rows.filter(item=>item.date.startsWith(monthKey));rows.sort(compareRows);
    return{success:true,batch:formatBatch(batch,dateKey),rows,source:available?'batch-snapshot':'current-attendance-logs',snapshotAvailable:available,snapshotTruncated:metadata.accessRowsSnapshotTruncated===true,message:available?'':'전송 당시 스냅샷이 없는 기록입니다. 이후 수정·삭제되지 않고 현재 남아 있는 행만 표시합니다.'};
  }
  function buildMarkers(rawBatches, year, month, teacherName) {
    const monthKey=`${year}-${String(month).padStart(2,'0')}`,batch=rawBatches.find(item=>text((item.metadata||{}).sourceMonth)===monthKey&&Number((((item.metadata||{}).uploadSummary||{}).changedRows)||0)>0)||rawBatches.find(item=>text((item.metadata||{}).sourceMonth)===monthKey);
    const markers={};if(!batch)return{success:true,sourceMonth:monthKey,teacherName,markers,latestBatch:null};const summary=(batch.metadata||{}).uploadSummary||{};
    Object.entries(summary.changedByTeacherDate||{}).forEach(([key,count])=>{const [teacher,date]=key.split('|');if(!date||!teacher||teacherName&&teacher!==teacherName)return;const marker=markers[date]||={date,count:0,teacherCount:1,samples:[]};marker.count+=Number(count||1);});
    return{success:true,sourceMonth:monthKey,teacherName,markers,latestBatch:formatBatch(batch,''),totalChangedRows:Number(summary.changedRows||0)};
  }
  global.PortalAccessDashboardEngine=Object.freeze({buildDashboard,buildPreview,buildOverview,buildVersion,buildMarkers,batchDates,formatBatch,row});
})(window);
