(function(root){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=v=>Math.max(0,Number.isFinite(Number(v))?Number(v):0);
const rate=r=>r.target>0?r.submitted/r.target*100:null;
const percent=r=>r===null?'—':r.toFixed(1)+'%';
const icon=name=>`<span class="material-icons-round" aria-hidden="true">${name}</span>`;
const groups=['국어','영어','수학','과학','사회','기타'];
function subject(value){const s=String(value||'');if(/국어/.test(s))return '국어';if(/영어/.test(s))return '영어';if(/수학/.test(s))return '수학';if(/과학|물리|화학|생명|지구/.test(s))return '과학';if(/사회|역사|지리|경제|윤리/.test(s))return '사회';return '기타';}
function aggregate(data,teachers){
 const directory=new Map();for(const t of teachers||[]){const name=String(t.name||'').trim();if(!directory.has(name))directory.set(name,new Set());directory.get(name).add(subject(t.subject));}
 const byTeacher=new Map(),daily=[];let agreements=0,agreementTargets=0;
 for(const date of Object.keys(data?.dayMap||{}).sort()){
  let target=0,submitted=0;
  for(const r of data.dayMap[date].teachers||[]){if(!r.hasClass)continue;const n=count(r.taughtCount),done=Math.min(n,count(r.submittedCount)),name=String(r.teacher||'').trim()||'강사 미확인';if(n<=0)continue;
   target+=n;submitted+=done;agreementTargets++;if(r.hoursAgreementSigned)agreements++;
   if(!byTeacher.has(name)){const gs=directory.get(name);byTeacher.set(name,{teacher:name,subject:gs?.size===1?[...gs][0]:'기타',target:0,submitted:0});}
   const t=byTeacher.get(name);t.target+=n;t.submitted+=done;
  }
  if(target>0)daily.push({date,target,submitted,missing:target-submitted,rate:submitted/target*100});
 }
 const rows=[...byTeacher.values()].map(t=>({...t,missing:t.target-t.submitted,rate:rate(t)})).sort((a,b)=>b.rate-a.rate||a.missing-b.missing||a.teacher.localeCompare(b.teacher,'ko'));
 const ties=new Map();for(const t of rows){const k=t.rate.toFixed(4);ties.set(k,(ties.get(k)||0)+1);}let prev=null,rank=0;
 rows.forEach((t,i)=>{if(prev===null||Math.abs(prev-t.rate)>0.0001)rank=i+1;t.rank=rank;t.tied=ties.get(t.rate.toFixed(4))>1;prev=t.rate;});
 const subjects=groups.map(name=>{const list=rows.filter(t=>t.subject===name),target=list.reduce((s,t)=>s+t.target,0),submitted=list.reduce((s,t)=>s+t.submitted,0);return {name,target,submitted,missing:target-submitted,teachers:list.length,rate:target?submitted/target*100:null};}).filter(g=>g.teachers);
 const target=rows.reduce((s,t)=>s+t.target,0),submitted=rows.reduce((s,t)=>s+t.submitted,0);
 return {rows,subjects,daily,target,submitted,missing:target-submitted,rate:target?submitted/target*100:null,agreements,agreementTargets};
}
const line=r=>`제출률 ${percent(r.rate)} · 제출 ${r.submitted} / 대상 ${r.target}건 · 미제출 ${r.missing}건`;
function report(model,period,section,key){
 let title='',lines=[];
 if(section==='teacher'){const r=model.rows.find(t=>t.teacher===key);if(!r)return '';title=r.teacher+' 선생님';lines=[`${r.tied?'공동 ':''}${r.rank}위 · ${r.subject}`,line(r)];}
 else if(section==='subject'){const r=model.subjects.find(t=>t.name===key);if(!r)return '';title=r.name+' 과목 제출 현황';lines=[line(r),`강사 ${r.teachers}명`];}
 else if(section==='ranking'){title='강사별 제출률';lines=model.rows.map(t=>`${t.tied?'공동 ':''}${t.rank}위 ${t.teacher} · ${t.subject} · ${line(t)}`);}
 else if(section==='subjects'){title='과목별 제출률';lines=model.subjects.map(t=>`${t.name}: ${line(t)}`);}
 else if(section==='trend'){title='날짜별 제출 흐름';lines=model.daily.map(t=>`${t.date}: ${line(t)}`);}
 else {title='클래스 체크아웃';lines=[line(model),`시수동의 ${model.agreements} / 대상 ${model.agreementTargets}건 (강사·수업일 기준)`,`조회 강사 ${model.rows.length}명`];}
 return [`${title} | ${period}`,...lines,'기준: 제출률 = 제출 / 대상 수업 · 미제출 = 대상 − 제출',...(section==='subject'||section==='subjects'?['과목은 강사 대표 과목 기준입니다.']:[])].join('\n');
}
function button(section,key,label){return `<button type="button" class="ci-copy" data-ci-copy="${esc(section)}" data-ci-key="${esc(key||'')}" title="${esc(label)} 복사" aria-label="${esc(label)} 복사">${icon('content_copy')}</button>`;}
function heading(title,section,subtitle){return `<div class="ci-heading"><h3>${esc(title)} ${button(section,'',title)}</h3>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>`;}
function ring(r,label){const p=Math.max(0,Math.min(100,r.rate||0));return `<div class="ci-ring" role="img" aria-label="${esc(label)} ${percent(r.rate)}: 제출 ${r.submitted}, 대상 ${r.target}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ci-ring-track" cx="50" cy="50" r="42"/><circle class="ci-ring-value" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="${p} 100"/></svg><strong>${percent(r.rate)}</strong></div>`;}
function renderSummary(m){return [
 ['대상 수업',m.target+'','선택한 두 달의 수업','event_note'],['시수동의',m.agreements+'',`강사·수업일 기준 / ${m.agreementTargets}건`,'draw'],['제출 완료',m.submitted+'',`미제출 ${m.missing}건`,'task_alt'],['통합 제출률',percent(m.rate),'제출 / 대상 수업 기준','donut_large']
 ].map(([title,value,sub,i])=>`<div class="ci-metric"><div class="ci-metric-title">${icon(i)}<span>${title}</span>${button('summary','',title)}</div><strong>${value}</strong><small>${sub}</small></div>`).join('');}
function renderInsights(m){if(!m.target)return '<div class="ci-empty">선택 기간에 제출률을 계산할 수업이 없습니다. 다른 기간을 선택해 주세요.</div>';
 return `<section class="ci-subject-section">${heading('과목별 제출률','subjects','강사 대표 과목별 합산 · 제출 건수를 대상 수업으로 나눈 비율')}<div class="ci-subject-grid">${m.subjects.map(r=>`<article class="ci-subject"><h4>${esc(r.name)} ${button('subject',r.name,r.name+' 제출률')}</h4>${ring(r,r.name)}<div class="ci-subject-numbers"><b>${r.submitted}<span> / ${r.target}건</span></b><small>미제출 ${r.missing}건 · 강사 ${r.teachers}명</small></div></article>`).join('')}</div></section>
 <section class="ci-trend-section">${heading('날짜별 제출 흐름','trend','수업이 있는 날짜만 표시 · 막대를 누르면 해당 날짜 현황을 확인합니다.')}<div class="ci-trend-scroll"><div class="ci-trend">${m.daily.map(r=>`<button class="ci-day" type="button" data-ci-date="${r.date}" aria-label="${r.date} ${esc(line(r))}" title="${r.date} · ${esc(line(r))}"><span class="ci-day-plot"><span style="height:${Math.min(100,r.rate)}%"></span></span><span>${r.date.slice(5).replace('-','/')}</span></button>`).join('')}</div></div><div class="ci-legend"><span><i></i>제출 비율</span><span>막대 전체 높이 = 100%</span></div></section>`;}
function renderRanking(m){if(!m.rows.length)return '<div class="ci-empty">선택 기간에 제출률 데이터가 없습니다.</div>';
 return `<p class="ci-formula">제출 / 대상 수업 기준 · 미제출은 대상에서 제출을 뺀 수치입니다.</p><div class="ci-rank-columns"><span>순위 · 강사</span><span>제출률</span><span>제출 / 대상</span><span>미제출</span></div><ol class="ci-rank-list">${m.rows.map(t=>`<li class="ci-rank-item"><div class="ci-rank-person"><span class="ci-position ${t.rank<=3?'ci-top':''}" aria-label="${t.tied?'공동 ':''}${t.rank}위">${t.rank<=3?icon('workspace_premium'):t.rank}<small>${t.tied?'공동 ':''}${t.rank}위</small></span><span><strong>${esc(t.teacher)}</strong><small>${esc(t.subject)}</small></span>${button('teacher',t.teacher,t.teacher+' 제출률')}</div><div class="ci-rate"><strong>${percent(t.rate)}</strong><div class="ci-track"><span style="width:${Math.min(100,t.rate)}%"></span></div></div><div class="ci-rank-count"><b>${t.submitted}</b><span> / ${t.target}</span></div><div class="ci-missing ${t.missing?'':'ci-complete'}">${t.missing}건</div></li>`).join('')}</ol>`;}
let state=null,readContext=null;
function update(data,teachers,period){state=data?{model:aggregate(data,teachers),period}:null;return state?.model;}
function cleanText(el){
 if(!el)return '';const clone=el.cloneNode(true);
 clone.querySelectorAll('.ci-copy,.cla-copy-btn,.cla-note-btn,.material-icons-round,[aria-hidden="true"]').forEach(n=>n.remove());
 clone.querySelectorAll('th,td').forEach(n=>n.append(' | '));
 clone.querySelectorAll('h3,h4,p,tr,li,.cla-teacher-chip,.cla-cal-cell,.cla-row,.cla-bottom-row,.cla-summary,.cla-search-card-title,.cla-search-list,.cla-search-copytext').forEach(n=>n.append('\n'));
 return (clone.textContent||'').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function fallback(text){let dlg=document.getElementById('ci-copy-dialog');if(dlg)dlg.remove();dlg=document.createElement('dialog');dlg.id='ci-copy-dialog';dlg.className='ci-copy-dialog';dlg.innerHTML='<h3>복사할 내용</h3><p>브라우저에서 자동 복사를 허용하지 않았습니다. 아래 내용을 선택해 복사해 주세요.</p><textarea aria-label="공유할 현황" readonly></textarea><button type="button">닫기</button>';document.body.appendChild(dlg);dlg.querySelector('textarea').value=text;dlg.querySelector('button').onclick=()=>dlg.close();dlg.addEventListener('close',()=>dlg.remove(),{once:true});dlg.showModal();dlg.querySelector('textarea').select();}
async function copy(text,btn){if(!text)return;const initial=btn.innerHTML;btn.disabled=true;try{if(!navigator.clipboard?.writeText)throw Error('unavailable');await navigator.clipboard.writeText(text);btn.innerHTML=icon('check');const status=document.getElementById('ci-copy-status');if(status)status.textContent='현황을 클립보드에 복사했습니다.';}catch(_){fallback(text);}finally{btn.disabled=false;setTimeout(()=>{if(btn.isConnected)btn.innerHTML=initial;},1600);}}
function install(getContext){readContext=getContext;
 document.addEventListener('keydown',event=>{
  const tab=event.target.closest('#cla-tabbar [role="tab"]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const tabs=[...tab.parentElement.querySelectorAll('[role="tab"]')];let i=tabs.indexOf(tab);
  i=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  event.preventDefault();tabs[i].click();tabs[i].focus();
 });document.addEventListener('click',event=>{
 const btn=event.target.closest('[data-ci-copy]');if(btn){const c=readContext();if(!c?.ready||!state)return;const section=btn.dataset.ciCopy;let text;
 if(section==='dom'){const target=document.getElementById(btn.dataset.ciKey);text=`클래스 체크아웃 | ${state.period}\n${cleanText(target)}`;}else text=report(state.model,state.period,section,btn.dataset.ciKey);copy(text,btn);}
 const date=event.target.closest('[data-ci-date]');if(date&&readContext()?.ready)readContext().selectDate(date.dataset.ciDate);
 });}
function decorate(){const rootEl=document.getElementById('classlog-audit-modal');if(!rootEl)return;
 const specs=[['cla-detail','.cla-detail-title'],['cla-teacher-search-result','.cla-search-result-title'],['cla-bottom-table-wrap','.cla-bottom-title']];
 for(const [id,sel] of specs){const container=document.getElementById(id),title=container?.querySelector(sel);if(title&&!title.querySelector('.ci-copy'))title.insertAdjacentHTML('beforeend',button('dom',id,title.textContent));}
 rootEl.querySelectorAll('[data-ci-copy]').forEach(b=>b.disabled=!readContext?.()?.ready);
}
const api={aggregate,report,renderSummary,renderInsights,renderRanking,button,update,install,decorate};root.PortalCheckoutUI=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
