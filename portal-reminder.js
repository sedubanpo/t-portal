(function(){
 'use strict';
 const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const monthRange=month=>{const [y,m]=month.split('-').map(Number);return {start:month+'-01',end:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};};
 const shift=(month,n)=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7);};
 function summarize(rows,signed,month,date=today()){
   const days={};
   for(const row of rows||[]){
     const key=row.classDate;
     if(!/^\d{4}-\d{2}-\d{2}$/.test(key||'')||key.slice(0,7)!==month||key>date||!(row.minutes>0))continue;
     const d=days[key]||(days[key]={date:key,count:0,matched:0,missing:0,unknown:0,minutes:0});
     d.count++;d.minutes+=row.minutes;
     d[row.status==='matched'?'matched':row.status==='missing'?'missing':'unknown']++;
   }
   for(const d of Object.values(days)){
     d.hours=signed&&Object.hasOwn(signed,d.date)?(signed[d.date]===true?'done':'pending'):'unknown';
     d.journal=d.unknown?'unknown':d.missing?'pending':'done';
   }
   return days;
 }
 const eligible=u=>!!u?.uid&&!u.isAdmin&&!u.staffReadOnly;
 const snoozed=(expiry,now=Date.now())=>Number(expiry)>now&&Number(expiry)<=now+86400000;
 if(typeof module!=='undefined')module.exports={summarize,monthRange,shift,eligible,snoozed};
 if(typeof document==='undefined')return;
 const fixture=['localhost','127.0.0.1'].includes(location.hostname)?window.portalReminderTestAdapter:null;
 const user=()=>fixture?fixture.user():typeof currentUser!=='undefined'&&typeof teacherPortalFirebaseState!=='undefined'&&teacherPortalFirebaseState.auth?.currentUser?.uid===currentUser?.uid?currentUser:null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon=n=>`<span class="material-icons-round" aria-hidden="true">${n}</span>`;
 const storageKey=uid=>'portal.lesson-check.snooze.v1:'+uid;
 let root,bound='',epoch=0,month='',selected='',data=null,busy=false,error='',hoursError=false,snooze=false,open=false,lastRead=0;
 const seen=new Set();
 function install(){
   if(root)return;
   root=document.createElement('aside');root.id='portal-lesson-check';root.hidden=true;root.setAttribute('aria-label','나의 수업 체크');document.body.append(root);
   root.addEventListener('click',e=>{const b=e.target.closest('[data-check]');if(!b)return;const action=b.dataset.check;
     if(action==='close'){if(snooze){try{localStorage.setItem(storageKey(bound),String(Date.now()+86400000));}catch{}}open=false;render();root.querySelector('button')?.focus();}
     if(action==='open'){open=true;snooze=false;load();}
     if(action==='refresh')load();
     if(action==='prev'||action==='next'){month=shift(month,action==='prev'?-1:1);selected='';load();}
     if(action==='day'){selected=b.dataset.date;render();root.querySelector(`[data-date="${selected}"]`)?.focus();}
     if(action==='hours'||action==='journal'){const u=user(),date=selected;if(!eligible(u)||u.uid!==bound||!data?.[date])return;open=false;render();
       if(fixture)return fixture.navigate(action,date);
       if(action==='journal')window.openPortalJournalDate(date).catch(()=>showToast('일지 현황을 열지 못했어요. 다시 시도해 주세요.','warning'));
       else{const [y,m,d]=date.split('-').map(Number);currentYear=y;currentMonth=m-1;openHoursModal();loadHoursDashboardData({teacherName:u.name,forceRefresh:true,onDone:()=>{if(user()?.uid===u.uid&&currentYear===y&&currentMonth===m-1)selectDate(d,null);}});}
     }
   });
   root.addEventListener('change',e=>{if(e.target.matches('[data-check-snooze]'))snooze=e.target.checked;});
   root.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){e.stopPropagation();root.querySelector('[data-check="close"]').click();}});
 }
 function badge(kind,state){return `<span class="pc-state pc-${state}">${kind}${state==='done'?'✓':state==='pending'?'!':'?'}</span>`;}
 const label=state=>state==='done'?'완료':state==='pending'?'필요':'확인 필요';
 function render(){
   if(!root)return;
   root.hidden=!eligible(user())||user()?.uid!==bound;if(root.hidden)return;
   if(!open){root.innerHTML=`<button type="button" class="pc-launch" data-check="open">${icon('event_available')}수업 체크</button>`;return;}
   const current=today().slice(0,7),previous=shift(current,-1),[y,m]=month.split('-'),days=Object.values(data||{}),pending=days.filter(d=>d.hours==='pending'||d.journal==='pending').length;
   let content=busy?'<p class="pc-message" role="status">수업 날짜와 확인 상태를 불러오고 있어요.</p>':error?'<p class="pc-message" role="status">수업 기록을 불러오지 못했어요.<br>새로고침으로 다시 확인해 주세요.</p>':null;
   if(content===null){
     const count=Number(monthRange(month).end.slice(-2)),offset=new Date(month+'-01T00:00:00Z').getUTCDay();
     content=`<p class="pc-summary" role="status">${!days.length?'이달에 전송된 수업 기록이 없어요.':pending?`확인이 필요한 수업일 <strong>${pending}일</strong>`:days.some(d=>d.hours==='unknown'||d.journal==='unknown')?'연결 상태를 확인할 날짜가 있어요.':'확인된 수업일을 모두 마쳤어요.'}</p><div class="pc-week" aria-hidden="true">${['일','월','화','수','목','금','토'].map(d=>'<span>'+d+'</span>').join('')}</div><div class="pc-grid">${'<span></span>'.repeat(offset)}${Array.from({length:count},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0'),d=data?.[date];return d?`<button type="button" class="pc-day${selected===date?' pc-selected':''}" data-check="day" data-date="${date}" aria-pressed="${selected===date}" aria-label="${Number(m)}월 ${i+1}일, 수업 ${d.count}건, 시수 동의 ${label(d.hours)}, 일지 제출 ${label(d.journal)}"><span>${i+1}</span><span class="pc-markers">${badge('시',d.hours)}${badge('일',d.journal)}</span></button>`:`<span class="pc-day pc-empty${date===today()?' pc-today':''}">${i+1}</span>`;}).join('')}</div><p class="pc-legend">시: 시수 동의 · 일: 일지 제출<br>✓ 완료 · ! 필요 · ? 확인 필요</p>`;
     const d=data?.[selected];
     if(d)content+=`<section class="pc-detail" aria-label="선택한 날짜"><strong>${Number(m)}월 ${Number(selected.slice(-2))}일 <small>수업 ${d.count}건</small></strong><p>시수 동의 ${label(d.hours)} · 일지 ${d.matched}/${d.count}건 확인${d.unknown?' · 동기화 확인 필요':''}</p><div><button type="button" data-check="hours">시수 확인${icon('chevron_right')}</button><button type="button" data-check="journal">일지 확인${icon('chevron_right')}</button></div></section>`;
     if(hoursError||days.some(d=>d.unknown))content+='<p class="pc-note">일부 상태를 확인하지 못했어요. 미완료로 집계하지 않으며, 제출 직후에는 동기화까지 시간이 걸릴 수 있어요.</p>';
   }
   root.innerHTML=`<div class="pc-panel"><header><div>${icon('event_available')}<h2>오늘도 수업 체크</h2></div><button type="button" data-check="close" aria-label="수업 체크 닫기">${icon('close')}</button></header><p class="pc-intro">수업 후 남은 확인을 한눈에.</p><div class="pc-month"><button type="button" data-check="prev" aria-label="이전 달 수업" ${busy||month<=previous?'disabled':''}>${icon('chevron_left')}</button><strong>${y}년 ${Number(m)}월</strong><button type="button" data-check="next" aria-label="다음 달 수업" ${busy||month>=current?'disabled':''}>${icon('chevron_right')}</button><button type="button" data-check="refresh" aria-label="수업 체크 새로고침" ${busy?'disabled':''}>${icon('refresh')}</button></div><div class="pc-content">${content}</div><footer><label><input type="checkbox" data-check-snooze ${snooze?'checked':''}>24시간 동안 안 보기</label><span>체크 후 닫기</span></footer><p class="pc-source">인트라넷에서 전송된 실제 수업 · 최근 두 달 조회</p></div>`;
 }
 async function load(){
   const u=user();if(!eligible(u)||u.uid!==bound)return;
   const request=++epoch,scope=bound,target=month;busy=true;error='';data=null;render();
   const range=monthRange(target);
   const results=await Promise.allSettled([
     fixture?fixture.tracking(range):window.readPortalLessonCheck(range),
     fixture?fixture.hours(target):requestTeacherHoursDashboardOnce_({year:Number(target.slice(0,4)),month0:Number(target.slice(5))-1,teacherName:u.name},u.name,true)
   ]);
   if(request!==epoch||user()?.uid!==scope||month!==target)return;
   busy=false;lastRead=Date.now();
   if(results[0].status==='rejected'||!Array.isArray(results[0].value?.rows))error='read';
   else{const hours=results[1].status==='fulfilled'&&results[1].value?.success===true?results[1].value.state?.auxiliary?.signedDateMap:null;hoursError=!hours;data=summarize(results[0].value.rows,hours,target);const dates=Object.keys(data).sort();if(!data[selected])selected=dates.find(date=>data[date].hours==='pending'||data[date].journal==='pending')||dates.at(-1)||'';}
   render();
 }
 window.maybeShowPortalLessonCheck=function(){
   install();const u=user();if(!eligible(u)){root.hidden=true;return;}
   if(bound!==u.uid){epoch++;bound=u.uid;month=today().slice(0,7);selected='';data=null;busy=false;open=false;snooze=false;}
   if(!seen.has(bound)){seen.add(bound);let expiry;try{expiry=localStorage.getItem(storageKey(bound));}catch{}open=!snoozed(expiry);if(open){load();return;}}
   render();
 };
 // Clear private state promptly on sign-out/account switch; never open over an admin session.
 setInterval(()=>{if(bound&&(!eligible(user())||user()?.uid!==bound)){epoch++;bound='';data=null;open=false;if(root){root.innerHTML='';root.hidden=true;}}},500);
 window.addEventListener('focus',()=>{if(open&&Date.now()-lastRead>60000&&!busy)load();});
})();
