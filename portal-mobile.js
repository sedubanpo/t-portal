(function(root){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const minutes=value=>{const m=String(value||'').match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):Infinity;};
 function daysForWeek(rows,start){
   return Array.from({length:7},(_,i)=>{const date=new Date(start);date.setDate(start.getDate()+i);const dateKey=key(date);return {date,dateKey,rows:rows.filter(r=>r.dateObj&&key(new Date(r.dateObj))===dateKey).slice().sort((a,b)=>minutes(a.start)-minutes(b.start)||String(a.student).localeCompare(String(b.student),'ko'))};});
 }
 let selectedDate='';
 root.renderPortalMobileWeek=function(grid,rows,start){
   const days=daysForWeek(rows,start),today=key(new Date());
   if(!days.some(d=>d.dateKey===selectedDate))selectedDate=(days.find(d=>d.dateKey===today)||days.find(d=>d.rows.length)||days[0]).dateKey;
   const panel=document.createElement('section');panel.className='pt-mobile-week';panel.setAttribute('aria-label','요일별 주간 시간표');grid.append(panel);
   function paint(){
     const day=days.find(d=>d.dateKey===selectedDate);
     panel.innerHTML=`<nav class="pt-week-days" aria-label="시간표 요일 선택">${days.map((d,i)=>`<button type="button" data-day="${i}" aria-pressed="${d===day}" aria-label="${d.date.getMonth()+1}월 ${d.date.getDate()}일 ${['월','화','수','목','금','토','일'][i]}요일 ${d.rows.length}건"><span>${['월','화','수','목','금','토','일'][i]}</span><strong>${d.date.getDate()}</strong><small>${d.rows.length?d.rows.length+'건':'—'}</small></button>`).join('')}</nav><header class="pt-day-heading"><h4>${day.date.getMonth()+1}월 ${day.date.getDate()}일</h4><span>${day.rows.length}건 · 등록 수업 기준</span></header><div class="pt-day-lessons">${day.rows.length?day.rows.map((r,i)=>{const meta=getTimetableStudentMeta(r.student,r);return `<button type="button" class="pt-lesson" data-row="${i}" aria-pressed="${timetableSelectedStudent===r.student}"><span class="pt-time">${escape(r.start||'시간 미등록')}<span>${escape(r.end||'')}</span></span><span class="pt-person"><strong>${renderPortalStudentName_(r.student,r)}</strong><span class="pt-school">${renderPortalSchool_(meta.school,getTimetableStudentMetaLabel(r.student,r))}</span><span class="pt-class">${escape(getClassTypeLabel(r))}${r.status?' · '+escape(r.status):''}</span></span></button>`;}).join(''):'<p class="pt-empty">이 날짜에 등록된 수업이 없습니다.</p>'}</div>`;
     panel.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{selectedDate=days[Number(b.dataset.day)].dateKey;paint();panel.querySelector(`[data-day="${b.dataset.day}"]`).focus({preventScroll:true});});
     panel.querySelectorAll('[data-row]').forEach(b=>b.onclick=()=>toggleTimetableStudent(day.rows[Number(b.dataset.row)].student));
   }
   paint();
 };
 if(typeof module!=='undefined')module.exports={daysForWeek,escape};
})(typeof window==='undefined'?{}:window);
