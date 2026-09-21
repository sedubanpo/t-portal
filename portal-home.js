(function(){
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon=name=>`<span class="material-icons-round" aria-hidden="true">${name}</span>`;
 let installed=false,latest=null,latestScope='',latestPending=false,latestRequest=0,latestLoadedAt=0,noticeUid='',noticePending=false;
 const teacher=()=>viewTeacherName||currentUser.name||'';
 const scope=()=>currentUser.uid+'|'+teacher();
 async function api(mode,extra={}){
   const token=await getTeacherPortalFirebaseIdToken_(false);
   const r=await fetch('https://asia-northeast3-fir-lms-prod.cloudfunctions.net/teacherPortalBootstrap',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({mode,...extra}),signal:AbortSignal.timeout(25000)});
   const data=await r.json();if(!r.ok||data.success!==true)throw Error(data.message||'조회하지 못했습니다. 다시 시도해 주세요.');return data;
 }
 function install(){
   if(installed||!$('dashboard-main'))return;installed=true;document.body.classList.add('home-renewal');
   const main=$('dashboard-main'),side=$('dashboard-sidebar');
   const brand=document.createElement('div');brand.className='ph-brand';brand.innerHTML=`<span class="ph-logo" aria-hidden="true"></span><div><strong>에스에듀</strong><small>강사 포털</small></div>`;side.prepend(brand);
   side.append(document.querySelector('.portal-version-dock'));
   const home=document.createElement('button');home.type='button';home.className='ph-nav-home';home.innerHTML=icon('home')+'홈';home.onclick=()=>window.portalHomeNavigate('home');brand.after(home);
   const admin=$('admin-panel');main.prepend(admin);
   const hero=$('mobile-greeting-card');main.prepend(hero);const clock=document.createElement('div');clock.className='ph-clock';clock.innerHTML='<span id="ph-clock-date"></span><strong id="ph-clock-time"></strong>';hero.append(clock);
   const mobileBrand=brand.cloneNode(true);mobileBrand.classList.add('ph-mobile-brand');hero.before(mobileBrand);
   const summary=document.createElement('section');summary.className='ph-summary';summary.setAttribute('aria-label','강사별 월간 수업 현황');admin.after(summary);
   const profile=side.querySelector('.header-area');summary.append(profile);
   profile.querySelectorAll('.icon-btn').forEach((el,i)=>{el.setAttribute('role','button');el.setAttribute('aria-label',i?'로그아웃':'비밀번호 변경');el.tabIndex=0;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}};});
   const month=document.createElement('div');month.className='ph-month';month.innerHTML=`<button type="button" aria-label="이전 달" onclick="changeMonth(-1)">${icon('chevron_left')}</button><strong id="ph-month-title"></strong><button type="button" aria-label="다음 달" onclick="changeMonth(1)">${icon('chevron_right')}</button><button type="button" class="ph-history" onclick="portalHomeNavigate('history')">${icon('history')}시수 변경 이력</button>`;summary.append(month);
   summary.append($('desktop-kpi-board'));
   const cards=[...$('desktop-kpi-board').children];
   cards.forEach((card,i)=>{card.insertAdjacentHTML('afterbegin',`<span class="ph-kpi-icon">${icon(['menu_book','schedule','description'][i])}</span>`);card.tabIndex=0;card.setAttribute('role','button');card.onclick=()=>i<2?openHoursModal():openKpiDetailModal('missing');card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();card.click();}};});
   const makeup=document.createElement('button');makeup.className='desktop-kpi-card ph-makeup';makeup.type='button';makeup.onclick=()=>{openHoursModal();showStatDetails('makeup');};makeup.innerHTML=`<span class="ph-kpi-icon">${icon('event_available')}</span><div class="desktop-kpi-label">보강 / 보충</div><div class="desktop-kpi-value" id="ph-makeup-count">—</div><div class="desktop-kpi-sub">선택 월에 등록된 수업 기준</div>`;$('desktop-kpi-board').append(makeup);
   const sign=document.createElement('section');sign.id='ph-sign';sign.className='ph-sign';sign.setAttribute('aria-live','polite');summary.after(sign);
   const lower=document.createElement('div');lower.className='ph-lower';sign.after(lower);
   const recent=document.createElement('section');recent.id='ph-recent';recent.className='ph-panel';lower.append(recent);
   lower.append($('desktop-event-board'));
   const rail=document.createElement('div');rail.className='ph-right';lower.append(rail);
   const notice=document.createElement('section');notice.id='ph-notices';notice.className='ph-panel';notice.innerHTML='<h2>공지사항 <small>S-LMS</small></h2><p class="ph-muted">공지를 불러오고 있습니다.</p>';rail.append(notice);
   const quick=document.createElement('section');quick.className='ph-panel';quick.innerHTML=`<h2>빠른 메뉴</h2><div class="ph-quick"><button onclick="openLink('log')">${icon('edit_note')}수업일지</button><button onclick="openLink('grades')">${icon('assessment')}성적 제출</button><button onclick="openHomeroomModal()">${icon('supervisor_account')}담임 업무</button><button onclick="openTimetableModal()">${icon('calendar_month')}주간 시간표</button></div>`;rail.append(quick);
   const nav=document.createElement('nav');nav.className='ph-bottom';nav.setAttribute('aria-label','강사 포털 메뉴');nav.innerHTML=`<button onclick="portalHomeNavigate('home')">${icon('home')}홈</button><button onclick="portalHomeNavigate('hours')">${icon('schedule')}시수 조회</button><button onclick="openLink('log')">${icon('edit_note')}수업일지</button><button onclick="portalHomeNavigate('more')" aria-expanded="false" id="ph-more-toggle">${icon('more_horiz')}더보기</button>`;document.body.append(nav);
   const close=document.createElement('button');close.className='ph-menu-close';close.textContent='메뉴 닫기';close.onclick=()=>window.portalHomeNavigate('more');side.prepend(close);
   // Existing menu handlers and modal IDs are retained.
   side.querySelectorAll('.glass-card-menu').forEach(n=>{n.tabIndex=0;n.setAttribute('role','button');n.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();n.click();}};n.addEventListener('click',()=>document.body.classList.remove('ph-menu-open'));});
   const eventTitle=$('desktop-event-board').querySelector('.desktop-event-title');eventTitle.textContent='주요 일정';
   function tick(){const now=new Date();$('ph-clock-date').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'short'}).format(now);$('ph-clock-time').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'numeric',minute:'2-digit',hour12:true}).format(now);}
   tick();setInterval(tick,30000);
 }
 function effectiveHours(r){return r.status==='당일취소'||(String(r.status||'').includes('예고')&&r.status!=='결석예고 · 실제 대체수업')?0:Number(r.hours)||0;}
 function paintLatest(){
   if(!$('ph-sign'))return;
   const readonly=currentUser.staffReadOnly===true||normalizeTeacherName(teacher())!==normalizeTeacherName(currentUser.name);
   const valid=latest?.date&&latest.rows?.length,rows=valid?latest.rows:[],sum=rows.reduce((n,r)=>n+effectiveHours(r),0);
   const label=latestPending?'등록된 수업을 확인하고 있습니다':latest?.error?'지난 수업 조회 실패':valid?`${latest.date} 수업 결산`:'등록된 수업이 없습니다';
   $('ph-sign').innerHTML=`<div class="ph-sign-symbol">${icon(latest?.signed?'verified':'draw')}</div><div class="ph-sign-copy"><h2>${esc(label)}</h2><p>${latest?.error?esc(latest.error):valid?`${rows.length}건 · ${sum.toFixed(1)}H · ${latest.signed?'시수 동의 완료':readonly?'선택 강사의 시수 동의 현황을 조회합니다.':'수업 내역과 수업일지 제출 상태를 확인한 후 서명해 주세요.'}`:'출결 마감 후 시수가 반영되면 결산을 확인할 수 있습니다.'}</p></div><button type="button" onclick="${latest?.error?'refreshPortalHomeData(true)':'openPortalLatestLesson()'}" ${!valid&&!latest?.error?'disabled':''}>${latest?.error?'다시 시도':readonly?'결산 내역 조회':latest?.signed?'서명 내역 확인':'확인 후 서명하기'}${icon('chevron_right')}</button>`;
   $('ph-recent').innerHTML=`<header><h2>지난 수업 <small>${valid?rows.length+'건':''}</small></h2><button type="button" onclick="openPortalLatestLesson()" ${!valid?'disabled':''}>전체보기 ${icon('chevron_right')}</button></header><p class="ph-muted">${valid?esc(latest.date)+' · 시수가 등록된 가장 최근 수업일':latestPending?'최근 등록 수업을 불러오고 있습니다.':latest?.error?'조회에 실패했습니다. 위의 다시 시도를 눌러 주세요.':'아직 등록된 수업이 없습니다.'}</p><div class="ph-lessons">${rows.slice(0,5).map(r=>`<button type="button" class="ph-lesson" onclick="openPortalLatestLesson()"><span class="ph-lesson-time">${esc(r.start||'시간 확인')}<br>${esc(r.end||'')}</span><span class="ph-type">${esc(r.status==='당일취소'?'취소':r.className.includes('1:1')?'1:1':'개별')}</span><span class="ph-student">${renderPortalStudentName_(r.student,r)}</span><strong>${effectiveHours(r).toFixed(1)}H</strong>${icon('chevron_right')}</button>`).join('')}</div>`;
 }
 window.renderPortalHome=function(){
   install();if(!currentUser?.uid)return;
   $('ph-month-title').textContent=`${currentYear}년 ${currentMonth+1}월`;
   $('ph-makeup-count').textContent=(monthlyData||[]).filter(r=>/보강|보충|직보/.test(r.status||'')).length+'회';
   const profile=$('dashboard-main').querySelector('.header-area');profile.setAttribute('aria-label',(currentUser.staffReadOnly?'실무자 조회 전용 · ':isAdminMode?'관리자 · ':'')+'현재 조회 강사 '+teacher());
   refreshPortalHomeData();loadPortalLmsNotices();
 };
 window.refreshPortalHomeData=async function(force){
   install();if(!currentUser?.uid)return;
   const key=scope();if(!force&&latestScope===key&&(latestPending||Date.now()-latestLoadedAt<60000))return;
   latestScope=key;latest=null;latestPending=true;paintLatest();const id=++latestRequest;
   try{const result=await api('homeLatestHours',{teacherName:teacher()});if(id!==latestRequest||scope()!==key)return;latest=result;latestLoadedAt=Date.now();}
   catch(e){if(id===latestRequest&&scope()===key)latest={error:e.message};}
   finally{if(id===latestRequest&&scope()===key){latestPending=false;paintLatest();}}
 };
 window.loadPortalLmsNotices=async function(force){
   install();const uid=currentUser?.uid;if(!uid||(!force&&noticeUid===uid)||noticePending)return;
   noticeUid=uid;noticePending=true;$('ph-notices').innerHTML='<h2>공지사항 <small>S-LMS</small></h2><p class="ph-muted">공지를 불러오고 있습니다.</p>';
   try{const data=await api('lmsNotices');if(currentUser.uid!==uid){noticeUid='';return;}
     $('ph-notices').innerHTML=`<header><h2>공지사항 <small>S-LMS</small></h2><button type="button" onclick="loadPortalLmsNotices(true)" aria-label="공지 새로고침">${icon('refresh')}</button></header>${data.rows.length?data.rows.map(n=>`<details class="ph-notice"><summary>${esc(n.content.length>56?n.content.slice(0,56)+'…':n.content)}</summary><p>${esc(n.content)}</p>${n.updatedAt?`<time>${esc(n.updatedAt.slice(0,10))}</time>`:''}</details>`).join(''):'<p class="ph-muted">등록된 공지사항이 없습니다.</p>'}`;
   }catch(e){if(currentUser.uid===uid)$('ph-notices').innerHTML='<h2>공지사항</h2><p class="ph-muted">LMS 공지를 불러오지 못했습니다.</p><button onclick="loadPortalLmsNotices(true)">다시 시도</button>';}
   finally{noticePending=false;if(currentUser?.uid&&currentUser.uid!==uid)loadPortalLmsNotices();}
 };
 window.openPortalLatestLesson=function(){
   if(!latest?.date||!latest.rows?.length)return;
   const [y,m,d]=latest.date.split('-').map(Number),key=scope();currentYear=y;currentMonth=m-1;openHoursModal();
   loadHoursDashboardData({teacherName:teacher(),onDone:()=>{if(scope()===key&&currentYear===y&&currentMonth===m-1)selectDate(d,null);}});
 };
 window.portalHomeNavigate=function(target){
   if(target==='more'){const open=document.body.classList.toggle('ph-menu-open');$('ph-more-toggle').setAttribute('aria-expanded',String(open));return;}
   document.body.classList.remove('ph-menu-open');$('ph-more-toggle')?.setAttribute('aria-expanded','false');
   if(target==='home'){closeHoursModal();$('dashboard-section').scrollIntoView({block:'start'});}
   else {openHoursModal();if(target==='history')toggleHoursHistory();}
 };
 document.addEventListener('keydown',e=>{if(e.key==='Escape')document.body.classList.remove('ph-menu-open');});
 install();
 if(typeof module!=='undefined')module.exports={effectiveHours,esc};
})();
