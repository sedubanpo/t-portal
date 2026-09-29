(function(){
 'use strict';
 const ENDPOINT='https://asia-northeast3-fir-lms-prod.cloudfunctions.net/teacherPortalLessonLogs';
 const labels={draft:'작성 중',submitting:'Notion 전송 중',submitted:'제출 완료',sync_failed:'전송 확인 필요',archived:'보관됨'};
 const fieldLabels={title:'수업 제목',content:'수업 내용',materials:'수업 자료 · 링크',homework:'숙제',feedback:'지난 숙제 피드백',assessment:'테스트 · 평가'};
 const empty=()=>({studentId:'',lessonDate:'',lessonType:'개별정규',title:'',content:'',materials:'',homework:'',feedback:'',assessment:'',attachmentIds:[]});
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const id=()=>crypto.randomUUID();
 let journalTab='drafts',trackingPage=0,trackingResult=null,trackingEpoch=0,lastViewedTeacher='';
 const todayKST=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 let trackingFilter={start:todayKST().slice(0,7)+'-01',end:todayKST(),ownerUid:''};
 function journalIcon(key){
   const paths={drafts:'M4 4h10v4h4v12H4z M14 4l4 4 M8 12h6 M8 16h4',overview:'M4 20V10h4v10 M10 20V4h4v16 M16 20v-7h4v7',history:'M5 5h14v15H5z M8 2v6 M16 2v6 M5 10h14 M9 14h6 M9 17h4',missing:'M4 5h16v15H4z M8 2v6 M16 2v6 M4 10h16 M12 13v3 M12 18h.01',sync:'M20 7a8 8 0 0 0-13-2L4 8 M4 3v5h5 M4 17a8 8 0 0 0 13 2l3-3 M20 21v-5h-5'};
   return '<svg class="ll-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[key]+'"/></svg>';
 }
 function journalTabs(){return '<nav class="ll-tabs" aria-label="수업일지 소메뉴">'+[['drafts','수업일지 제출'],['overview','나의 현황'],['history','지난 수업일지'],['missing','미작성 수업'],...(context?.actor?.admin?[['sync','미전송 관리']]:[])].map(([key,label])=>'<button class="ll-secondary" data-action="journal-tab" data-id="'+key+'" aria-current="'+(journalTab===key?'page':'false')+'">'+journalIcon(key)+'<span>'+label+'</span></button>').join('')+'</nav>';}
 let queueFilter={},queueCursor=null,queuePrevious=[],queueNext=null,queueRows=[],queueSelected=new Set(),queueBusy=false,queueResult='';
 let root,context,record,timer,busy=false,conflict=false,locked=false,initializing=false,session=0,poll,boundUid=null,listFilter={};
 const branch=sessionStorage.getItem('lessonLogBranch')||id();sessionStorage.setItem('lessonLogBranch',branch);
 const fixture=location.hostname==='localhost'||location.hostname==='127.0.0.1'?window.lessonLogTestAdapter:null;
 const online=()=>fixture?!fixture.offline:navigator.onLine;
 const uid=()=>fixture?fixture.uid:(typeof teacherPortalFirebaseState!=='undefined'?teacherPortalFirebaseState.auth?.currentUser?.uid:null);
 const ownsRecord=()=>!!record&&record.ownerUid===uid();
 function matchStudent(students,query){
   const normalized=String(query||'').trim().normalize('NFC');
   const matches=students.filter(s=>s.name.normalize('NFC')===normalized||studentOption(s)===normalized);
   return matches.length===1?matches[0]:null;
 }
 function studentOption(s){return `${s.name} · ${s.school||'학교 미등록'} · ${s.grade||'학년 미등록'}`.normalize('NFC');}
 function updateStudentMatch(input){
   const match=matchStudent(context.students,input.value);
   record.studentQuery=input.value;record.content.studentId=match?.studentId||'';
   const status=root.querySelector('[data-student-match]');
   status.textContent=match?`${match.name} · ${match.school||'학교 미등록'} ${match.grade||''} 연결됨`:'이름을 입력해 주세요. 동명이인은 학교·학년까지 선택하면 연결됩니다.';
   status.dataset.matched=String(!!match);
 }
 function localMatches(row,owner,filter){
   return row.uid===owner&&!!row.id&&!!row.content&&
     (!filter.ownerUid||filter.ownerUid===(row.ownerUid||row.uid))&&
     (!filter.status||filter.status===row.status);
 }
 const db=new Promise((resolve,reject)=>{const r=indexedDB.open('sedu-private-lesson-logs',1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 async function store(mode,fn){const d=await db;return new Promise((resolve,reject)=>{const tx=d.transaction('records',mode),req=fn(tx.objectStore('records'));tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
 const put=value=>store('readwrite',s=>s.put(structuredClone(value)));
 const all=()=>store('readonly',s=>s.getAll());
 function message(text,tone=''){const n=root?.querySelector('[data-save]');if(n){n.textContent=text;n.dataset.tone=tone;}const symbol=root?.querySelector('[data-backup]');if(symbol){symbol.dataset.mode=tone==='error'?'error':!online()||tone==='offline'?'offline':conflict?'paused':record?.status==='draft'?'active':'idle';}}
 function notice(text){const n=root?.querySelector('[data-notice]');if(n){n.textContent=text;n.hidden=!text;}}
 async function api(action,payload={}){
   const requestUid=uid();
   const check=()=>{if(!requestUid||requestUid!==uid()){const e=Error('계정이 변경됐습니다. 다시 열어 주세요.');e.code='AUTH_CHANGED';throw e;}};
   check();
   if(fixture){const result=await fixture.api(action,payload);check();return result;}
   const token=await getTeacherPortalFirebaseIdToken_(false);
   const r=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action,...payload}),signal:AbortSignal.timeout(30000)});
   check();
   if(action==='download'&&r.ok)return r.blob();
   const j=await r.json();if(!r.ok||!j.success){const e=new Error(j.message||'요청에 실패했습니다.');e.code=j.error;throw e;}return j.data;
 }
 function ensure(){
   if(root)return;
   root=document.createElement('section');root.id='lesson-log-page';root.style.display='none';root.setAttribute('aria-label','수업일지 관리');
   document.body.append(root);
   window.registerPortalWorkspacePage?.(root);
   root.addEventListener('input',e=>{const key=e.target.dataset.field;if((!key&&!e.target.matches('[data-student-search]'))||locked||!record||!ownsRecord()||record.status!=='draft')return;if(e.target.matches('[data-student-search]'))updateStudentMatch(e.target);else record.content[key]=e.target.value;record.dirty=true;record.localAt=Date.now();persist().then(()=>{message('기기에 보관됨 · 서버 저장 대기');schedule();}).catch(storageError);});
   root.addEventListener('focusout',()=>flush());
   root.addEventListener('change',e=>{if(e.target.dataset.queueFilter){queueFilter[e.target.dataset.queueFilter]=e.target.value;queueCursor=null;queuePrevious=[];showQueue().catch(error=>notice(error.message));return;}if(e.target.matches('[data-queue-check]')){if(e.target.checked)queueSelected.add(e.target.dataset.queueCheck);else queueSelected.delete(e.target.dataset.queueCheck);updateQueueSelection();return;}if(e.target.matches('[data-queue-all]')){queueSelected=new Set(e.target.checked?queueRows.filter(r=>r.status==='sync_failed').map(r=>r.id):[]);root.querySelectorAll('[data-queue-check]').forEach(el=>el.checked=queueSelected.has(el.dataset.queueCheck));updateQueueSelection();return;}if(e.target.matches('[data-files]'))addFiles(e.target.files).catch(storageError);if(e.target.dataset.filter){listFilter[e.target.dataset.filter]=e.target.value;list().catch(error=>notice(error.message));}});
   root.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)handle(b.dataset.action,b.dataset.id,b.dataset.local).catch(error=>notice(error.message));});
 }
 function storageError(){message('기기 저장 실패','error');notice('브라우저 저장 공간을 확인해 주세요. 저장 확인 전에는 창을 닫지 마세요.');}
 async function persist(){if(record&&record.uid===uid()&&ownsRecord())await put(record);}
 function schedule(){clearTimeout(timer);timer=setTimeout(()=>flush(),1300);}
 const filloutIcon='<img class="ll-fillout-icon" src="https://www.fillout.com/favicon.ico" alt="" width="20" height="20" referrerpolicy="no-referrer">';
 function loading(){return '<div class="ll-loading" role="status" aria-live="polite"><span class="ll-loading-book" aria-hidden="true"><i></i><i></i><i></i></span><strong>수업의 기록을 불러오고 있어요</strong><p>저장된 초안과 제출 내역을 안전하게 확인합니다.</p><span class="ll-loading-track" aria-hidden="true"></span></div>';}
 function chrome(title,sub){return `<header class="ll-head"><div><h1>${title}</h1><p>${sub}</p>${context?.verification?'<p role="status"><strong>테스트 전용 · 별도 Notion 테스트 DB에만 전송됩니다. 실제 수업 내용이나 개인 자료는 입력하지 마세요.</strong></p>':''}</div><button data-action="list" class="ll-secondary" ${initializing?'disabled aria-disabled="true"':''}>${!initializing&&!context?.actor?'다시 불러오기':'수업일지 제출 목록'}</button></header><div class="ll-notice" data-notice role="alert" hidden></div>`;}
 async function list(){
   if(initializing)return;
   if(!context?.actor)return window.openPortalLessonLogs();
   journalTab='drafts';const epoch=++trackingEpoch;
   if(record){await persist();await flush();}record=null;conflict=false;clearInterval(poll);
   root.innerHTML=chrome('수업일지 관리','작성 중인 내용부터 전송 결과까지, 한곳에서 확인하세요.')+`<div class="ll-list-tools"><button class="ll-primary" data-action="new">＋ 내 수업일지 작성</button><button data-action="legacy" class="ll-secondary">${filloutIcon} Fillout 열기 ↗</button><span data-save role="status" aria-live="polite"></span></div><div data-summary class="ll-summary"></div><div data-list class="ll-draft-list">${loading()}</div>`;
   const filters=document.createElement('div');filters.className='ll-list-tools';filters.innerHTML=`<label>상태<select data-filter="status"><option value="">전체 상태</option>${Object.entries(labels).map(([key,label])=>`<option value="${key}" ${listFilter.status===key?'selected':''}>${label}</option>`).join('')}</select></label>${context.actor.admin?`<label>강사<select data-filter="ownerUid"><option value="">전체 강사</option>${(context.teachers||[]).map(t=>`<option value="${escape(t.uid)}" ${listFilter.ownerUid===t.uid?'selected':''}>${escape(t.name)}</option>`).join('')}</select></label>`:''}`;root.querySelector('[data-list]').before(filters);
   root.querySelector('.ll-head').insertAdjacentHTML('afterend',journalTabs());
   root.querySelector('.ll-head button')?.remove();
   const local=(await all()).filter(r=>localMatches(r,uid(),listFilter)&&!(context.deletedIds||[]).includes(r.id)),rows=new Map();
   local.forEach(r=>{rows.set(r.id,{...r,local:true});});
   try{const result=await api('list',listFilter);if(epoch!==trackingEpoch)return;context.deletedIds=[...new Set([...(context.deletedIds||[]),...(result.deletedIds||[])])];context.deletedIds.forEach(id=>rows.delete(id));result.rows.forEach(r=>{if(!rows.has(r.id)||!rows.get(r.id).dirty)rows.set(r.id,{...r,local:rows.has(r.id)});});window.lessonLogNextCursor=result.cursor;
     if(result.cursor){const b=document.createElement('button');b.textContent='이전 내역 더 보기';b.dataset.action='more';b.className='ll-secondary';root.append(b);}}
   catch(e){if(epoch!==trackingEpoch)return;notice('서버 목록을 가져오지 못했습니다. 이 기기에 남은 초안만 표시합니다.');}
   if(epoch!==trackingEpoch)return;
   paintRows([...rows.values(),...local.filter(r=>r.dirty&&!(context.deletedIds||[]).includes(r.id)&&rows.get(r.id)?.key!==r.key).map(r=>({...r,local:true,title:(r.content.title||'초안')+' · 별도 기기 복구본'}))]);
 }

 const syncErrors={NOTION_ID_PROPERTY_MISSING:'Notion 중복 방지 속성 누락 · 관리자 설정 확인 필요',NOTION_SCHEMA_SETUP_REQUIRED:'Notion DB 필수 항목 확인 필요',NOTION_ACCESS_REQUIRED:'Notion 연결 권한 확인 필요',NOTION_VALIDATION_FAILED:'Notion 입력 형식 확인 필요',NOTION_RATE_LIMITED:'Notion 요청량 초과',NOTION_TEMPORARY_ERROR:'Notion 일시적 서버 오류',NOTION_NETWORK_ERROR:'Notion 연결 지연',NOTION_RESULT_UNCERTAIN:'전송 결과 확인 필요 · 중복 방지를 위해 새 전송 중지',NOTION_DUPLICATE_REVIEW:'중복된 Notion 일지 확인 필요',DESTINATION_REVIEW_REQUIRED:'Notion 전송 대상 확인 필요',NOTION_FILE_PENDING:'첨부 처리 대기',NOTION_SYNC_FAILED:'전송 오류 · 재확인 필요'};
 const syncError=code=>syncErrors[code]||'전송 결과 확인 중';
 const queueTime=value=>value?new Date(value).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
 function updateQueueSelection(){
   const b=root.querySelector('[data-action="queue-retry"]');if(b){b.disabled=queueBusy||!queueSelected.size;b.textContent=queueBusy?'재처리 요청 중…':`선택 ${queueSelected.size}건 재처리`;}
   const all=root.querySelector('[data-queue-all]'),count=queueRows.filter(r=>r.status==='sync_failed').length;
   if(all){all.checked=count>0&&queueSelected.size===count;all.indeterminate=queueSelected.size>0&&queueSelected.size<count;}
 }
 async function showQueue(){
   if(!context?.actor?.admin)return;
   await persist();await flush();record=null;clearInterval(poll);journalTab='sync';
   const epoch=++trackingEpoch;queueSelected.clear();
   root.innerHTML=chrome('미전송 관리','제출된 원본 중 Notion 전송이 끝나지 않은 일지를 모았습니다.')+journalTabs()+
     `<div class="ll-list-tools ll-queue-tools"><label>상태<select data-queue-filter="status"><option value="">전체 미전송</option><option value="sync_failed" ${queueFilter.status==='sync_failed'?'selected':''}>확인 필요</option><option value="submitting" ${queueFilter.status==='submitting'?'selected':''}>전송·재시도 대기</option></select></label><label>강사<select data-queue-filter="ownerUid"><option value="">전체 강사</option>${(context.teachers||[]).map(t=>`<option value="${escape(t.uid)}" ${queueFilter.ownerUid===t.uid?'selected':''}>${escape(t.name)}</option>`).join('')}</select></label><button class="ll-secondary" data-action="queue-refresh">새로고침</button></div><p class="ll-muted">작성 중인 초안은 제외합니다. 재처리는 제출된 원본으로 진행하며, 완료 여부는 새로고침으로 확인하세요.</p><p class="ll-queue-result" data-queue-result role="status">${escape(queueResult)}</p><div data-queue-content>${loading()}</div>`;
   root.querySelector('.ll-head button')?.remove();
   try{const result=await api('syncQueue',{...queueFilter,cursor:queueCursor});if(epoch!==trackingEpoch||journalTab!=='sync')return;queueRows=result.rows;queueNext=result.cursor;
     const el=root.querySelector('[data-queue-content]');
     el.innerHTML=`<div class="ll-queue-actions"><strong>현재 페이지 ${queueRows.length}건</strong><button class="ll-primary" data-action="queue-retry" disabled>선택 0건 재처리</button></div>${queueRows.length?`<div class="ll-queue-scroll" role="region" aria-label="미전송 수업일지 표" tabindex="0"><table class="ll-queue-table"><thead><tr><th><input type="checkbox" data-queue-all aria-label="현재 페이지의 확인 필요 일지 모두 선택"></th><th>수업일 / 제목</th><th>강사 / 학생</th><th>전송 상태 / 사유</th><th>제출 / 최근 확인</th><th>시도</th><th>원본</th></tr></thead><tbody>${queueRows.map(r=>`<tr><td><input type="checkbox" data-queue-check="${escape(r.id)}" aria-label="${escape(r.title||'제목 없는 일지')} 선택" ${r.status!=='sync_failed'?'disabled':''}></td><td><span>${escape(r.lessonDate)}</span><strong>${escape(r.title||'제목 없는 일지')}</strong></td><td><strong>${escape(r.teacherName)}</strong><span>${escape(r.studentName||'학생 확인 필요')}</span></td><td><span class="ll-state" data-state="${escape(r.status)}">${r.status==='sync_failed'?'확인 필요':r.nextAttemptAt?'자동 재시도 대기':'전송 중'}</span><small>${escape(r.lastError?syncError(r.lastError):'Notion 전송 결과 확인 중')}${r.nextAttemptAt?'<br>다음 시도 '+escape(queueTime(r.nextAttemptAt)):''}</small></td><td><span>${escape(queueTime(r.submittedAt))}</span><small>${escape(queueTime(r.updatedAt))}</small></td><td>${Number(r.attempts)||0}회</td><td><button class="ll-secondary" data-action="resume" data-id="${escape(r.id)}">보기</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="ll-empty"><h2>미전송 일지가 없습니다</h2><p>현재 조건에 해당하는 미전송 일지가 없습니다.</p></div>'}<nav class="ll-list-tools" aria-label="미전송 목록 페이지"><button class="ll-secondary" data-action="queue-prev" ${queuePrevious.length?'':'disabled'}>이전</button><span>${queuePrevious.length+1}페이지 · 최대 40건</span><button class="ll-secondary" data-action="queue-next" ${queueNext?'':'disabled'}>다음</button></nav>`;
   }catch(e){if(epoch!==trackingEpoch)return;queueRows=[];root.querySelector('[data-queue-content]').innerHTML='<div class="ll-empty"><h2>미전송 목록을 불러오지 못했습니다</h2><p>새로고침을 눌러 다시 확인해 주세요.</p></div>';notice(e.message);}
 }
 async function retryQueue(){
   if(queueBusy||!queueSelected.size||!context?.actor?.admin)return;
   queueBusy=true;const epoch=trackingEpoch,ids=[...queueSelected];
   root.querySelectorAll('[data-queue-check],[data-queue-all],[data-queue-filter],[data-action^="queue-"]').forEach(el=>el.disabled=true);updateQueueSelection();
   try{const result=await api('retryBatch',{ids});if(epoch!==trackingEpoch)return;
     const queued=result.results.filter(r=>r.queued).length,failed=result.results.filter(r=>r.error).length,skipped=result.results.length-queued-failed;
     queueResult=`${queued}건 재처리 접수 · ${skipped}건 이미 처리 중 또는 완료 · ${failed}건 접수 실패. 접수는 Notion 전송 완료를 의미하지 않습니다.`;
   }catch(e){if(epoch!==trackingEpoch)return;queueResult='접수 결과를 확인하지 못했습니다. 목록을 새로고침해 상태를 확인한 뒤 다시 시도해 주세요.';}
   finally{queueBusy=false;if(epoch===trackingEpoch)await showQueue();}
 }

 async function showTracking(){
   await persist();await flush();record=null;clearInterval(poll);
   syncViewedTeacher(journalTab!=='missing'&&!trackingFilter.ownerUid);
   const epoch=++trackingEpoch;
   root.innerHTML=chrome('수업일지 관리','기존 Notion 일지와 전송 완료된 실제 수업을 함께 확인하세요.')+journalTabs()+
     '<div class="ll-list-tools ll-tracking-tools"><label>시작일<input type="date" data-tracking="start" value="'+escape(trackingFilter.start)+'"></label><label>종료일<input type="date" data-tracking="end" value="'+escape(trackingFilter.end)+'"></label>'+
     (context.actor.admin&&journalTab==='missing'?'<label>강사<select data-tracking="ownerUid"><option value="">전체 강사</option>'+[...new Map((context.teachers||[]).map(t=>[t.uid,t])).values()].map(t=>'<option value="'+escape(t.uid)+'" '+(trackingFilter.ownerUid===t.uid?'selected':'')+'>'+escape(t.name)+'</option>').join('')+'</select></label>':'<p class="ll-owner-note">'+escape(trackingTeacherName())+(context.actor.admin?' · 선택한 강사의 기록':' · 로그인한 계정의 기록')+'</p>')+
     '<button class="ll-primary" data-action="tracking-refresh">조회</button></div><div data-tracking-results>'+loading()+'</div>';
   root.querySelector('.ll-head button')?.remove();
   try{const result=await api('tracking',{...trackingFilter,view:journalTab});if(epoch!==trackingEpoch)return;trackingResult=result;paintTracking();}
   catch(e){if(epoch!==trackingEpoch)return;root.querySelector('[data-tracking-results]').innerHTML='<div class="ll-empty"><h2>기록을 불러오지 못했어요</h2><p>조회 기간은 최대 3개월로 선택하고 다시 조회해 주세요.</p></div>';notice(e.message);}
 }
 function overviewStats(rows){
   const schools=new Map(),students=new Set();let matched=0,missing=0,waiting=0,minutes=0;
   for(const r of rows){
     if(r.status==='matched')matched++;else if(r.status==='missing')missing++;else waiting++;
     minutes+=Number(r.minutes)||0;
     if(!r.studentId)continue;
     students.add(r.studentId);const school=r.studentSchool||'학교 미등록';
     if(!schools.has(school))schools.set(school,new Set());schools.get(school).add(r.studentId);
   }
   return {matched,missing,waiting,minutes,students:students.size,total:rows.length,rate:matched+missing?Math.round(matched/(matched+missing)*100):null,schools:[...schools].map(([name,ids])=>({name,count:ids.size})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ko'))};
 }
 function syncViewedTeacher(force=false){
   const viewed=typeof viewTeacherName==='string'?viewTeacherName:'';
   if(!force&&viewed===lastViewedTeacher)return;
   lastViewedTeacher=viewed;
   const normalized=name=>String(name||'').replace(/\s*T$/i,'').trim();
   const candidates=(context.teachers||[]).filter(t=>normalized(t.name)===normalized(viewed));
   trackingFilter.ownerUid=context.actor.admin&&candidates.length===1?candidates[0].uid:context.actor.uid;
 }
 function trackingTeacherName(){return context.actor.admin?(context.teachers||[]).find(t=>t.uid===trackingFilter.ownerUid)?.name||context.actor.name:context.actor.name;}
 function paintOverview(el,result){
   const s=overviewStats(result.rows),ready=result.source==='connected',rate=ready?s.rate:null;
   const chartRate=rate??0,schoolMax=s.schools[0]?.count||1;
   el.innerHTML=`<div class="ll-overview-heading"><div><h2>${escape(trackingTeacherName())} 선생님의 수업 기록</h2><p>수업의 흐름과 남은 기록을 한눈에 확인하세요.</p></div><span class="ll-sync-pill">${ready?'동기화 완료':'동기화 확인 필요'}</span></div>
   <div class="ll-insights"><section class="ll-completion" aria-label="수업일지 작성률"><h3>수업일지 작성률</h3><p>전송 완료된 학생별 수업 기준</p><div class="ll-ring-layout"><div class="ll-ring" role="img" aria-label="${rate===null?'작성률 집계 대기':`작성률 ${rate}%, 작성 완료 ${s.matched}건, 미작성 ${s.missing}건`}"><svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="82" class="ll-ring-track"/><circle cx="100" cy="100" r="82" class="ll-ring-value" pathLength="100" stroke-dasharray="${chartRate} ${100-chartRate}" transform="rotate(-90 100 100)"/></svg><div><strong>${rate===null?'—':rate+'<small>%</small>'}</strong><span>${rate===null?'집계 대기':'작성 완료'}</span></div></div><dl class="ll-chart-legend"><div><dt><i class="ll-dot done"></i>작성 완료</dt><dd>${ready?s.matched:'—'}<small>건</small></dd></div><div><dt><i class="ll-dot missing"></i>미작성</dt><dd>${ready?s.missing:'—'}<small>건</small></dd></div><div><dt><i class="ll-dot waiting"></i>확인·동기화 대기</dt><dd>${s.waiting}<small>건</small></dd></div></dl></div><p class="ll-chart-caption">작성 완료 ÷ (작성 완료 + 미작성) · 확인 대기는 계산에서 제외합니다.</p><button class="ll-secondary" data-action="overview-missing">내 미작성 수업 확인</button></section>
   <section class="ll-schools" aria-label="학교별 수업 학생"><div class="ll-school-heading"><div><h3>학교별 수업 학생</h3><p>선택 기간에 수업한 학생 · 학교별 중복 제외</p></div><strong>${s.students}<small>명</small></strong></div><div class="ll-school-bars">${s.schools.map(school=>`<div class="ll-school-bar"><span>${typeof renderPortalSchool_==='function'?renderPortalSchool_(school.name):escape(school.name)}</span><div class="ll-bar-track" aria-hidden="true"><i style="width:${school.count/schoolMax*100}%"></i></div><b>${school.count}<small>명</small></b></div>`).join('')||'<p class="ll-chart-empty">선택 기간에 전송 완료된 수업이 없습니다.</p>'}</div><p class="ll-chart-caption">현재 담당 배정 명단이 아닌, 선택 기간의 실제 수업을 기준으로 표시합니다.</p></section></div>
   <div class="ll-overview-footer"><span>학생별 수업 <b>${s.total}건</b></span><span>수업 시수 <b>${(s.minutes/60).toLocaleString('ko-KR',{maximumFractionDigits:1})}시간</b></span><span>${result.lastSyncedAt?'최근 동기화 '+escape(new Date(result.lastSyncedAt).toLocaleString('ko-KR')):'아직 동기화되지 않았습니다.'}</span></div>${!ready?'<p class="ll-notice" role="status">최신 Notion 기록을 확인할 수 없어 작성률과 미작성 수를 표시하지 않습니다. 동기화 후 다시 조회해 주세요.</p>':''}`;
 }
 function paintTracking(){
   const result=trackingResult;if(!result)return;
   const el=root.querySelector('[data-tracking-results]');if(!el)return;
   if(journalTab==='overview')return paintOverview(el,result);
   const rows=(journalTab==='history'?result.history:result.rows.filter(r=>r.status==='missing')).slice().sort((a,b)=>b.classDate.localeCompare(a.classDate));
   const unknown=result.rows.filter(r=>['unknown','review'].includes(r.status)).length;
   const current=rows.slice(trackingPage*40,(trackingPage+1)*40);
   const status=result.source==='connected'?'S-LMS와 동일한 대조 기준 · 동기화 '+new Date(result.lastSyncedAt).toLocaleString('ko-KR'):'Notion 동기화가 최신 상태가 아닙니다. 미작성 판정을 잠시 중지합니다.';
   el.innerHTML='<p class="ll-tracking-note" role="status">'+escape(status)+'</p><p class="ll-tracking-note">'+rows.length+'건 · '+(journalTab==='history'?'선택 기간의 기존 Notion 일지 (Fillout 포함)':'전송 완료된 실제 수업 중 일지가 확인되지 않은 수업')+(unknown?' · 확인/동기화 대기 '+unknown+'건은 미작성에서 제외':'')+'</p>'+
     '<div class="ll-table-scroll" tabindex="0" role="region" aria-label="일지 목록 · 가로 스크롤"><div class="ll-table-head ll-history-grid"><span>수업 제목</span><span>강사</span><span>학생</span><span>학교</span><span>수업일</span><span>시간</span><span>상태</span><span>원본 / 과목</span></div>'+current.map(r=>{
       const teacher=typeof renderPortalTeacher_==='function'?renderPortalTeacher_(r.teacherName,r.subject):escape(r.teacherName);
       const student=typeof renderPortalStudentName_==='function'?renderPortalStudentName_(r.studentName,r):escape(r.studentName);
       const candidates=context.students.filter(s=>s.name===r.studentName),schoolName=r.studentSchool||(candidates.length===1?candidates[0].school:'');
       const school=schoolName?(typeof renderPortalSchool_==='function'?renderPortalSchool_(schoolName):escape(schoolName)):'—';
       const url=r.url||r.notionUrl||'',safe=/^https:\/\/(?:app\.)?notion\.(?:so|com)\//.test(url);
       return '<article class="ll-tracking-row ll-history-grid"><strong title="'+escape(r.title||'')+'">'+escape(r.title||r.classDate+' 수업')+'</strong><span class="ll-person">'+teacher+'</span><span class="ll-person">'+student+'</span><span class="ll-school">'+school+'</span><span>'+escape(r.classDate)+'</span><span>'+escape(r.start&&r.end?r.start+'–'+r.end:'—')+'</span><span class="ll-state" data-state="'+(journalTab==='history'?'submitted':'sync_failed')+'">'+(journalTab==='history'?'작성 완료':'미작성')+'</span>'+(safe?'<a class="ll-secondary ll-notion-link" href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">Notion 일지 열기 ↗</a>':'<span>'+escape(r.subject||'—')+'</span>')+'</article>';
     }).join('')+'</div>'+(!rows.length?'<div class="ll-empty"><h2>'+ (result.source==='connected'?'해당 기간에 표시할 내역이 없습니다':'최신 동기화를 기다리고 있습니다')+'</h2><p>조회 기간을 확인해 주세요.</p></div>':'')+
     '<nav class="ll-list-tools" aria-label="일지 목록 페이지"><button class="ll-secondary" data-action="tracking-page" data-id="-1" '+(trackingPage===0?'disabled':'')+'>이전</button><span>'+(trackingPage+1)+' / '+Math.max(1,Math.ceil(rows.length/40))+'</span><button class="ll-secondary" data-action="tracking-page" data-id="1" '+((trackingPage+1)*40>=rows.length?'disabled':'')+'>다음</button></nav>';
 }
 function paintRows(rows,append=false){
   const el=root.querySelector('[data-list]');if(!el||journalTab!=='drafts')return;
   const html=rows.map(r=>{
     const student=context.students.find(s=>s.studentId===(r.studentId||r.content?.studentId));
     const name=r.studentName||student?.name||'학생 선택 전',teacher=r.teacherName||context.actor.name;
     const teacherLabel=typeof renderPortalTeacher_==='function'?renderPortalTeacher_(teacher):escape(teacher);
     const studentLabel=typeof renderPortalStudentName_==='function'?renderPortalStudentName_(name,student):escape(name);
     const school=student?.school?(typeof renderPortalSchool_==='function'?renderPortalSchool_(student.school):escape(student.school)):'';
     const date=r.lessonDate||r.content?.lessonDate||'날짜 선택 전';
     const saved=r.localAt?'기기 저장 '+new Date(r.localAt).toLocaleString('ko-KR'):r.updatedAt?new Date(r.updatedAt).toLocaleString('ko-KR'):'저장 확인 중';
     const state=r.dirty?'기기 복구본 있음':r.status==='draft'&&Date.now()-new Date(r.updatedAt||r.localAt).getTime()>7*86400000?'7일 이상 미제출':labels[r.status]||'작성 중';
     return `<button class="ll-draft ll-draft-grid" data-action="resume" data-id="${escape(r.id)}" data-local="${escape(r.local?r.key||'':'')}"><strong title="${escape(r.title||r.content?.title||'제목 없는 초안')}">${escape(r.title||r.content?.title||'제목 없는 초안')}</strong><span class="ll-person">${teacherLabel}</span><span class="ll-person">${studentLabel}</span><span class="ll-school">${school||'—'}</span><span>${escape(date)}</span><span>${escape(r.lessonType||r.content?.lessonType||'—')}</span><span>첨부 ${r.attachmentCount??r.content?.attachmentIds?.length??0}개</span><span>${escape(saved)}</span><span class="ll-state" data-state="${escape(r.status)}">${state}</span><span aria-hidden="true">›</span></button>`;
   }).join('')||'<div class="ll-empty"><h2>표시할 일지가 없어요</h2><p>필터를 확인하거나 새 수업일지를 작성해 주세요. 입력 내용은 자동 저장됩니다.</p></div>';
   el.classList.add('ll-table-scroll');el.tabIndex=0;el.setAttribute('aria-label','초안 목록 · 가로 스크롤');
   if(append)el.insertAdjacentHTML('beforeend',html);else el.innerHTML='<div class="ll-table-head ll-draft-grid"><span>수업 제목</span><span>강사</span><span>학생</span><span>학교</span><span>수업일</span><span>유형</span><span>첨부</span><span>마지막 저장</span><span>상태</span><span></span></div>'+html;
   const summary=root.querySelector('[data-summary]');
   if(summary){const states=[...el.querySelectorAll('.ll-state')].map(n=>n.dataset.state);summary.innerHTML=`<span class="ll-summary-caption">불러온 ${states.length}건 기준</span>`+[['draft','작성 중'],['submitted','제출 완료'],['sync_failed','전송 확인 필요']].map(([key,label])=>`<span><b>${states.filter(s=>s===key).length}</b> ${label}</span>`).join('');}
 }
 async function fresh(){conflict=false;const draftId=id();record={key:`${uid()}:${draftId}:${branch}`,uid:uid(),ownerUid:uid(),id:draftId,content:empty(),status:'draft',revision:0,dirty:false,created:false,files:[],localAt:Date.now(),teacherName:context.actor.name};await persist();render();await flush();}
 async function resume(draftId,localKey){
   await persist();await flush();clearInterval(poll);
   const locals=(await all()).filter(r=>r.uid===uid()&&r.id===draftId).sort((a,b)=>b.localAt-a.localAt);
   let remote;try{remote=await api('get',{id:draftId});}catch(e){if(!locals.length||['NOT_FOUND','PRIVATE_DRAFT_ACCESS_DENIED','UNAUTHENTICATED'].includes(e.code))throw e;}
   let local=(localKey&&locals.find(r=>r.key===localKey))||locals.find(r=>r.dirty||r.pending)||locals[0];
   // Older local records lacked ownerUid. Upgrade only after server ownership is verified.
   if(local&&remote&&remote.ownerUid===uid()&&!local.ownerUid)local={...local,ownerUid:remote.ownerUid};
   if(local&&remote&&JSON.stringify(local.content)===JSON.stringify(remote.content)){
     local={...local,dirty:false,pending:null,revision:remote.revision,created:true};await put(local);
   }
   if(local&&(local.dirty||local.pending||!remote)){record=local;record.key=`${uid()}:${draftId}:${branch}`;conflict=!!remote&&remote.revision!==local.revision&&!local.pending;}
   else{record={...remote,uid:uid(),key:`${uid()}:${draftId}:${branch}`,dirty:false,created:true,files:[...(local?.files||[]),...(remote.files||[]).filter(f=>!local?.files?.some(l=>l.id===f.id))],localAt:Date.now()};conflict=false;}
   // A previously submitted record must never be reopened as an editable local draft.
   if(remote&&remote.status!=='draft'){
     if(local?.dirty&&local.ownerUid===uid()){const recoveryId=id();await put({...local,key:`${uid()}:${recoveryId}:${branch}`,id:recoveryId,status:'draft',revision:0,created:false,pending:null,files:local.files.map(f=>({...f,uploaded:false})),recoveredFrom:draftId,localAt:Date.now()});await put({...local,dirty:false,pending:null});}
     record={...record,...remote,dirty:false,pending:null};conflict=false;
   }
   render();if(conflict)notice('다른 창에서 저장된 버전과 다릅니다. 기기 복구본은 유지됩니다. 아래에서 복구 방법을 선택하세요.');
   if(record.status==='submitting'){const opened=record.id;poll=setInterval(async()=>{if(!record||record.id!==opened)return;try{const data=await api('get',{id:opened});if(data.status!=='submitting'){clearInterval(poll);record={...record,...data};render();}}catch{}},8000);}
   if(record.status==='draft'&&!conflict)schedule();
 }
 function render(){
   if(!record||record.uid!==uid())return;
   const r=record,c=r.content,readonly=!ownsRecord()||r.status!=='draft',disabled=readonly?'disabled':'';
   root.innerHTML=chrome(readonly?'수업일지 확인':'수업일지 작성',!ownsRecord()?'읽기 전용 · 최종 제출된 내용만 재전송할 수 있습니다.':readonly?'최종 제출한 원본을 확인합니다. 수정 없이 안전하게 보관됩니다.':'입력한 내용은 자동으로 보관됩니다. 제출은 모든 내용을 확인한 뒤 눌러 주세요.')+`
     <div class="ll-save-bar"><span class="ll-state" data-state="${r.status}">${labels[r.status]}</span>${!readonly?`<span class="ll-backup" data-backup data-mode="${!online()?'offline':conflict?'paused':'active'}" aria-hidden="true">${journalIcon('sync')}</span>`:''}<div class="ll-save-copy">${!readonly?'<strong>자동 백업</strong>':''}<span data-save role="status" aria-live="polite">${!online()?'오프라인 · 기기 보관':r.dirty?'기기 복구본 있음':r.created?'저장됨':'초안 준비 중'}</span></div><button data-action="save" class="ll-text" ${disabled}>지금 저장</button></div>
     ${conflict?'<div class="ll-conflict"><strong>두 버전이 있습니다</strong><p>덮어쓰지 않고 복구본을 새 초안으로 보존할 수 있습니다.</p><button class="ll-secondary" data-action="copy">기기 복구본을 새 초안으로</button><button class="ll-secondary" data-action="server">서버 버전 열기</button></div>':''}
     <div class="ll-form ll-editor-layout"><fieldset class="ll-context" ${disabled}><legend>수업 정보</legend><p class="ll-section-help">누구와 함께한 수업인가요?</p><div class="ll-meta"><label>강사<input value="${escape(r.teacherName||context.actor.name)}" disabled></label><label>학생 이름 *<input data-student-search list="ll-student-options" autocomplete="off" aria-describedby="ll-student-match" value="${escape(r.studentQuery??context.students.find(s=>s.studentId===c.studentId)?.name??r.studentName??'')}" placeholder="학생 이름을 입력하세요" required><datalist id="ll-student-options">${context.students.map(s=>`<option value="${escape(studentOption(s))}"></option>`).join('')}</datalist><small id="ll-student-match" data-student-match role="status" data-matched="${!!c.studentId}">${c.studentId?'학생 연결됨':'이름이 같은 학생은 학교·학년으로 구분해 주세요.'}</small></label><label>수업일 *<input type="date" data-field="lessonDate" value="${escape(c.lessonDate)}" required></label><label>수업 유형<select data-field="lessonType">${context.lessonTypes.map(v=>`<option ${c.lessonType===v?'selected':''}>${escape(v)}</option>`).join('')}</select></label></div></fieldset>
     <fieldset class="ll-writing" ${disabled}><legend>수업 기록</legend><p class="ll-section-help">배운 내용과 다음 수업에 필요한 기록을 남겨 주세요.</p><div class="ll-writing-fields">${Object.entries(fieldLabels).map(([key,label])=>`<label class="ll-field-${key}">${label}${['title','content'].includes(key)?' *':''}${key==='title'?`<input data-field="title" maxlength="200" value="${escape(c[key])}" placeholder="예: 함수의 극한 · 개념과 대표 문항" required>`:`<textarea data-field="${key}" maxlength="12000" rows="${key==='content'?8:3}" ${key==='content'?'required':''} placeholder="${key==='materials'?'교재명 또는 자료 링크':key==='content'?'오늘 다룬 개념, 풀이한 문제, 학생의 이해도를 기록해 주세요.':label+'을 입력하세요.'}">${escape(c[key])}</textarea>`}</label>`).join('')}</div></fieldset>
     <fieldset ${disabled}><legend>사진 · PDF 첨부</legend><p class="ll-muted">JPG, PNG, PDF · 파일당 10MB · 최대 10개. 업로드 완료 후 제출됩니다.</p>${!readonly?'<label class="ll-file-picker">＋ 파일 선택<input data-files type="file" accept="image/jpeg,image/png,application/pdf" multiple></label>':''}<ul class="ll-files">${c.attachmentIds.map(fileId=>{const f=r.files.find(f=>f.id===fileId)||r.snapshot?.files?.find(f=>f.id===fileId);return `<li><span>${escape(f?.name||'첨부 자료')}</span><small>${f?.uploaded||readonly?'첨부됨':'전송 대기'}</small>${!readonly?`<button data-action="remove" data-id="${fileId}" type="button">제외</button>`:''}</li>`;}).join('')}</ul></fieldset></div>
     ${readonly?`<div class="ll-read-files">${c.attachmentIds.map((fileId,i)=>`<button class="ll-secondary" data-action="download" data-id="${fileId}">첨부 ${i+1} 내려받기</button>`).join('')}</div>`:''}
     <footer class="ll-actions"><p>${r.status==='sync_failed'?'원본은 안전하게 보관 중입니다. Notion 전송만 다시 확인합니다.':'제출 후에는 내용이 잠깁니다. 시수 동의와는 별개입니다.'}</p>${!readonly?'<button data-action="archive" class="ll-secondary">초안 보관</button><button data-action="submit" class="ll-primary">수업일지 제출</button>':r.status==='sync_failed'?'<button data-action="retry" class="ll-primary">Notion 전송 재확인</button>':''}</footer>`;
   if(r.notionPageId&&/^[a-f0-9-]{32,36}$/i.test(r.notionPageId)){const a=document.createElement('a');a.textContent='Notion 수업일지 열기 ↗';a.href='https://www.notion.so/'+r.notionPageId.replace(/-/g,'');a.target='_blank';a.rel='noopener';a.className='ll-secondary';root.querySelector('.ll-actions').append(a);}
   if(r.lastError)notice(syncError(r.lastError)+'. 원본은 안전하게 보관되어 있습니다.');
 }
 async function flush(){
   clearTimeout(timer);
   if(!record||record.uid!==uid()||!ownsRecord()||record.status!=='draft'||conflict)return;
   if(busy)return;const r=record,opened=session;
   if(!online()){message('오프라인 임시 저장','offline');await persist();return;}
   busy=true;message('저장 중');
   try{
     if(!r.created){await api('create',{id:r.id});r.created=true;await put(r);}
     if(!r.pending&&r.dirty){r.pending={mutationId:id(),revision:r.revision,content:structuredClone(r.content)};await put(r);}
     if(r.pending){const sent=r.pending,result=await api('save',{id:r.id,...sent});r.revision=result.revision;r.pending=null;r.dirty=JSON.stringify(r.content)!==JSON.stringify(sent.content);await put(r);}
     await uploadFiles(r);
     if(record===r&&session===opened){message(r.dirty?'저장 중':'저장됨','saved');if(r.dirty)schedule();}
   }catch(e){await put(r).catch(storageError);if(record===r){if(e.code==='REVISION_CONFLICT'){conflict=true;render();notice('다른 창의 변경을 발견했습니다. 기기 복구본을 새 초안으로 보존하거나 서버 버전을 확인하세요.');}else{message(online()?'저장 실패 · 기기 보관됨':'오프라인 임시 저장','error');notice(e.message);}}}
   finally{busy=false;if(record&&record!==r)schedule();}
 }
 async function addFiles(files){
   if(!record||record.status!=='draft'||!ownsRecord())return;
   for(const file of files){if(record.content.attachmentIds.length>=10||file.size>10*1024*1024||!['image/jpeg','image/png','application/pdf'].includes(file.type)){notice('JPG·PNG·PDF 파일만, 10MB 이하로 최대 10개까지 첨부할 수 있습니다.');continue;}
     const fileId=id();record.files.push({id:fileId,name:file.name,mime:file.type,blob:file,uploaded:false});record.content.attachmentIds.push(fileId);record.dirty=true;record.localAt=Date.now();}
   await persist();render();schedule();
 }
 async function uploadFiles(r){for(const f of r.files.filter(f=>r.content.attachmentIds.includes(f.id)&&!f.uploaded)){
   if(!f.blob&&r.recoveredFrom)f.blob=await api('download',{id:r.recoveredFrom,fileId:f.id});
   if(!f.blob)throw Error('첨부 파일 원본을 다시 선택해 주세요. 작성 내용은 보관 중입니다.');
   message('첨부 파일 전송 중');const bytes=new Uint8Array(await f.blob.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));
   await api('upload',{id:r.id,fileId:f.id,name:f.name,base64:btoa(text)});f.uploaded=true;await put(r);}}
 async function handle(action,value,localKey){
   if(action!=='legacy'){
     if(initializing)return;
     if(!context?.actor)return window.openPortalLessonLogs();
   }
   if(queueBusy&&action.startsWith('queue-'))return;
   if(action==='queue-refresh')return showQueue();
   if(action==='queue-retry')return retryQueue();
   if(action==='queue-next'&&queueNext){queuePrevious.push(queueCursor);queueCursor=queueNext;return showQueue();}
   if(action==='queue-prev'&&queuePrevious.length){queueCursor=queuePrevious.pop();return showQueue();}
   if(action==='overview-missing'){journalTab='missing';trackingPage=0;return showTracking();}
   if(action==='journal-tab'){if(value==='drafts')return list();if(value==='sync')return showQueue();journalTab=value;trackingPage=0;return showTracking();}
   if(action==='tracking-refresh'){for(const input of root.querySelectorAll('[data-tracking]'))trackingFilter[input.dataset.tracking]=input.value;trackingPage=0;return showTracking();}
   if(action==='tracking-page'){trackingPage+=Number(value);return paintTracking();}
   if(locked)return;
   if((action==='submit'||action==='confirm-submit')&&!record?.content.studentId){notice('학생 이름을 정확히 입력하거나 학교·학년이 표시된 검색 결과를 선택해 주세요.');root.querySelector('[data-student-search]')?.focus();return;}
   if(action==='submit'||action==='archive'){
     const n=root.querySelector('[data-notice]');n.hidden=false;n.innerHTML=action==='submit'?'<strong>제출 후에는 내용을 수정할 수 없습니다.</strong><p>모든 내용을 확인했나요?</p><button class="ll-primary" data-action="confirm-submit">확인하고 제출</button>':'<strong>내용을 삭제하지 않고 보관합니다.</strong><button class="ll-secondary" data-action="confirm-archive">초안 보관 확인</button>';
     n.tabIndex=-1;n.focus();n.scrollIntoView({block:'center',behavior:'smooth'});return;
   }
   if(action==='confirm-submit')action='submit';if(action==='confirm-archive')action='archive';
   if(action==='list')return list();if(action==='new')return fresh();if(action==='resume'){trackingEpoch++;return resume(value,localKey);}
   if(action==='legacy'){window.openPortalLegacyLog?.();return;}
   if(action==='more'){const data=await api('list',{...listFilter,cursor:window.lessonLogNextCursor});paintRows(data.rows,true);window.lessonLogNextCursor=data.cursor;if(!data.cursor)root.querySelector('[data-action="more"]')?.remove();return;}
   if(action==='save')return flush();
   if(action==='server'){await put({...record,key:record.key+':recovery:'+id()});const data=await api('get',{id:record.id});record={...record,...data,dirty:false,pending:null,created:true};conflict=false;render();notice('기존 기기 복구본은 보존되어 있습니다. 서버 버전을 보고 있습니다.');return;}
   if(action==='copy'){const original=structuredClone(record);await fresh();record.content=original.content;record.files=original.files.map(f=>({...f,uploaded:false}));record.recoveredFrom=original.id;record.dirty=true;await persist();render();schedule();return;}
   if(action==='remove'){record.content.attachmentIds=record.content.attachmentIds.filter(x=>x!==value);record.dirty=true;await persist();render();schedule();return;}
   if(action==='download'){const blob=await api('download',{id:record.id,fileId:value});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=record.snapshot?.files?.find(f=>f.id===value)?.name||'수업자료';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);return;}
   if(action==='archive'){await flush();if(busy||record.dirty||record.pending||conflict)throw Error('저장이 완료된 뒤 보관해 주세요.');await api('archive',{id:record.id,revision:record.revision});record.status='archived';await persist();return list();}
   if(action==='retry'){const result=await api('retry',{id:record.id});record.status=result.status;return resume(record.id);}
   if(action==='submit'){
     if(busy||conflict)return notice('저장 중이거나 충돌이 있습니다. 저장 상태를 먼저 확인해 주세요.');
     locked=true;root.querySelectorAll('fieldset,button').forEach(el=>el.disabled=true);
     try{await flush();if(record.dirty||record.pending||!record.created||conflict)throw Error('초안 저장을 완료한 뒤 제출해 주세요.');await uploadFiles(record);const result=await api('submit',{id:record.id,revision:record.revision});record.status=result.status;await persist();await resume(record.id);}
     finally{locked=false;render();}
   }
 }
 window.openPortalLessonLogs=async function(){
   ensure();root.style.display='block';
   if(initializing&&boundUid===uid())return;
   const opened=++session;record=null;context=null;initializing=true;boundUid=uid();listFilter={};queueFilter={};queueCursor=null;queuePrevious=[];queueResult='';queueSelected.clear();trackingEpoch++;
   root.innerHTML=chrome('수업일지 관리','작성과 저장, 제출까지 한곳에서.')+loading();
   try{if(!uid())throw Error('먼저 로그인해 주세요.');
     let nextContext;
     try{nextContext=await api('init');}
     catch(e){if(online())throw e;const cached=(await all()).find(r=>r.key==='init:'+uid());if(!cached)throw e;nextContext=cached.context;}
     if(opened!==session)return;
     if(!nextContext?.actor||!Array.isArray(nextContext.students))throw Error('수업일지 계정 정보를 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.');
     context=nextContext;
     await put({key:'init:'+uid(),uid:uid(),context});
     if(opened!==session)return;
     initializing=false;
     syncViewedTeacher(true);
     await list();}
   catch(e){if(opened!==session)return;initializing=false;context=null;root.innerHTML=chrome('수업일지 관리','연결을 확인해 주세요.')+'<button data-action="legacy" class="ll-primary">'+filloutIcon+' Fillout 열기 ↗</button>';notice(e.message);}
 };
 window.refreshPortalJournalTeacher=function(){if(initializing||!context?.actor?.admin)return;syncViewedTeacher(true);trackingEpoch++;trackingPage=0;if(root&&root.style.display!=='none'&&!record&&!['drafts','sync'].includes(journalTab))showTracking();};
 window.addEventListener('online',()=>flush());
 window.addEventListener('offline',()=>{if(record?.status==='draft')message('오프라인 · 기기에 임시 보관','offline');});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){persist().catch(storageError);flush();}});
 window.addEventListener('pagehide',()=>{persist().catch(()=>{});/* Network delivery is never assumed at pagehide. */});
 window.addEventListener('beforeunload',e=>{if(record?.dirty||record?.pending){persist().catch(()=>{});e.preventDefault();e.returnValue='';}});
 // Authentication changes must never leave the previous teacher's private editor visible.
 setInterval(()=>{if(boundUid&&boundUid!==uid()){record=null;context=null;initializing=false;boundUid=null;session++;trackingEpoch++;queueRows=[];queueSelected.clear();queueResult='';if(root){root.innerHTML='';root.style.display='none';}clearInterval(poll);clearTimeout(timer);}},1000);
 window.lessonLogLocalRecovery={open:window.openPortalLessonLogs};
})();
