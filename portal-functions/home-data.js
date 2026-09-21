'use strict';
// Keep the home response small: no account directory, contacts or raw LMS metadata.
function projectNotices(data={}) {
  const source=Array.isArray(data.items)?data.items:(data.content?[data]:[]);
  return source.filter(n=>n && n.active!==false && String(n.content||'').trim())
    .map(n=>({content:String(n.content),updatedAt:String(n.updatedAt||'')}))
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
function projectLatestHours(data,date) {
  if(data.success!==true)throw Error('LATEST_HOURS_UNAVAILABLE');
  const rows=(data.attendanceRows||[]).filter(row=>row.class_date===date).map(row=>({
    student:row.student_name,school:row.student_school,grade:row.student_grade,
    start:row.start_time_text,end:row.end_time_text,status:row.status,
    className:row.category||row.lesson_type||'',hours:row.hours
  }));
  return {success:true,date,rows,signed:(data.signatureRows||[]).some(s=>s.class_date===date&&s.signed===true)};
}
module.exports={projectNotices,projectLatestHours};
