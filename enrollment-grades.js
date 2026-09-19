(function(root) {
  'use strict';
  const grades = ['고3','고2','고1','중3','중2','중1','초6','초5','초4','초3','초2','초1','N수','기타','학년 미확인'];
  // Fixed categorical palette: labels and counts always accompany color.
  const colors = ['#1d4ed8','#3b82f6','#93c5fd','#047857','#10b981','#6ee7b7','#b45309','#d97706','#f59e0b','#fbbf24','#fcd34d','#fde68a','#7c3aed','#64748b','#cbd5e1'];
  const clean = v => String(v == null ? '' : v).trim();
  function gradeOf(row) {
    const school=clean(row.school), raw=clean(row.grade), level=clean(row.level);
    if (/재수|삼수|N수|n수|졸업|검정|교육청/.test(school+' '+raw)) return 'N수';
    const qualified=raw.match(/^(고|중|초)(?:등(?:학교)?)?\s*([1-6])(?:학년)?$/);
    const n=qualified ? Number(qualified[2]) : Number(raw.replace(/학년/g,'').trim());
    const prefix=qualified ? qualified[1] : /고등|고$/.test(school+' '+level) || /고(?:등학교)?$/.test(school) ? '고' : /중등/.test(level)||/중(?:학교)?$/.test(school)||school==='신반포' ? '중' : /초등/.test(level)||/초(?:등학교)?$/.test(school) ? '초' : '';
    if (prefix && n >= 1 && n <= (prefix==='초'?6:3) && Number.isInteger(n)) return prefix+n;
    if (!raw || /확인|미정|없음|^-$/.test(raw) || prefix) return '학년 미확인';
    return '기타';
  }
  function change(current, previous, loaded) {
    if (!loaded) return {delta:null, rate:null, label:'비교 불가'};
    const delta=current-previous;
    if (!previous) return {delta,rate:current?null:0,label:current?'신규':'0.0%'};
    const rate=delta/previous*100;
    return {delta,rate,label:(rate>0?'+':'')+rate.toFixed(1)+'%'};
  }
  function build(entries, month, helpers) {
    const currentEntry=entries.find(e=>e.monthKey===month);
    const [y,m]=month.split('-').map(Number), d=new Date(y,m-2,1);
    const previousMonth=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const previousEntry=entries.find(e=>e.monthKey===previousMonth);
    function collect(entry) {
      const map=new Map();
      if (!entry || entry.loaded===false) return map;
      (entry.rows||[]).forEach(row=>{
        if (!helpers.active(row)) return;
        const key=helpers.identity(row); if(!key)return;
        const old=map.get(key);
        if(!old)map.set(key,{...row,rows:[...(row.rows||[])]});
        else { old.rows.push(...(row.rows||[])); if(gradeOf(old)==='학년 미확인'&&gradeOf(row)!=='학년 미확인'){old.school=row.school;old.grade=row.grade;old.level=row.level;} }
      });
      return map;
    }
    const current=collect(currentEntry),previous=collect(previousEntry), previousLoaded=!!previousEntry&&previousEntry.loaded!==false;
    const counts=map=>{const result=Object.fromEntries(grades.map(g=>[g,0]));map.forEach(r=>result[gradeOf(r)]++);return result;};
    const currentCounts=counts(current),previousCounts=counts(previous);
    const breakdown=grades.map((label,i)=>{const diff=change(currentCounts[label],previousCounts[label],previousLoaded);return {label,color:colors[i],count:currentCounts[label],previous:previousLoaded?previousCounts[label]:null,share:current.size?currentCounts[label]/current.size*100:0,delta:diff.delta,rate:diff.rate,changeLabel:diff.label};});
    const subjects=new Map();
    current.forEach((row,key)=>{
      const grade=gradeOf(row);
      (row.rows||[]).filter(item=>helpers.active({rows:[item]})).forEach(item=>{
        const subject=helpers.subject(item)||'과목 미확인', teacher=clean(item.teacher).replace(/\s*T$/,'')||'강사 미확인';
        if(!subjects.has(subject))subjects.set(subject,new Map());
        const teachers=subjects.get(subject);
        if(!teachers.has(teacher))teachers.set(teacher,new Map());
        teachers.get(teacher).set(key,grade);
      });
    });
    const subjectGroups=Array.from(subjects,([subject,teachers])=>({subject,teachers:Array.from(teachers,([teacher,students])=>({teacher,total:students.size,grades:grades.map((label,i)=>({label,color:colors[i],count:[...students.values()].filter(g=>g===label).length})).filter(g=>g.count)})).sort((a,b)=>b.total-a.total||a.teacher.localeCompare(b.teacher,'ko'))})).sort((a,b)=>a.subject.localeCompare(b.subject,'ko'));
    return {breakdown,subjectGroups,total:current.size,previousTotal:previous.size,previousLoaded,previousMonth,totalChange:change(current.size,previous.size,previousLoaded),unlinkedStudents:[...current.values()].filter(r=>!(r.rows||[]).some(item=>helpers.active({rows:[item]}))).length};
  }
  root.PortalEnrollmentGrades={grades,colors,gradeOf,change,build};
  if(typeof module==='object'&&module.exports)module.exports=root.PortalEnrollmentGrades;
})(typeof window==='object'?window:globalThis);
