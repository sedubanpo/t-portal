(function(){
  'use strict';
  const page=document.getElementById('info-modal');
  let data=null,editing=false,busy=false,sequence=0;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<span class="material-icons-round" aria-hidden="true">${name}</span>`;
  const kind=label=>/와이파이|Wi-Fi/i.test(label)?'wifi':/전화|연락/.test(label)?'call':/주소|위치/.test(label)?'place':/시간/.test(label)?'schedule':/비밀번호|비번/.test(label)?'lock':'info';
  async function request(mode,extra={}){
    const token=await getTeacherPortalFirebaseIdToken_(false);
    const response=await fetch('https://asia-northeast3-fir-lms-prod.cloudfunctions.net/teacherPortalBootstrap',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({mode,...extra}),signal:AbortSignal.timeout(20000)});
    const result=await response.json();
    if(!response.ok||!result.success)throw Error(result.message||'연결을 확인한 뒤 다시 시도해 주세요.');
    return result;
  }
  function render(message=''){
    page.innerHTML=`<section class="ai-page" aria-label="학원 정보 및 연락처"><header class="ai-head"><div><h2>학원 정보 및 연락처</h2><p>수업에 필요한 연락처와 이용 안내를 확인하세요.</p></div>${data?.editable&&!editing?`<button data-action="edit" aria-label="학원 정보 설정">${icon('settings')}<span>설정</span></button>`:''}</header><div class="ai-notice" role="status">${esc(message)}</div><div class="ai-body"></div></section>`;
    const body=page.querySelector('.ai-body');
    if(!data){body.innerHTML='<div class="ai-empty">안내를 불러오고 있습니다.</div>';return;}
    if(editing){
      body.innerHTML=`<form class="ai-form"><h3>안내 편집</h3><p>저장하면 모든 강사에게 반영됩니다. 항목별 제목과 내용을 입력하세요.</p><div class="ai-fields"></div><button type="button" data-action="add">${icon('add')}항목 추가</button><footer><button type="button" data-action="cancel">취소</button><button class="ai-primary" type="submit">${icon('cloud_upload')}저장하기</button></footer></form>`;
      data.items.forEach(addRow);
      if(!data.items.length)addRow({label:'',value:''});
      body.querySelector('form').onsubmit=save;
    }else{
      body.innerHTML=data.items.length?`<div class="ai-directory">${data.items.map((item,i)=>`<article class="ai-entry"><div class="ai-entry-icon">${icon(kind(item.label))}</div><div><h3>${esc(item.label)}</h3><p>${esc(item.value)}</p></div><button data-copy="${i}" aria-label="${esc(item.label)} 복사">${icon('content_copy')}</button></article>`).join('')}</div>`:`<div class="ai-empty">${icon('business')}<h3>등록된 안내가 없습니다</h3><p>${data.editable?'오른쪽 위 설정에서 연락처와 학원 이용 안내를 등록해 주세요.':'관리자가 안내를 등록하면 여기에 표시됩니다.'}</p></div>`;
      body.insertAdjacentHTML('beforeend',`<footer class="ai-meta">${icon('cloud_done')}서버에서 불러온 안내${data.updatedAt?' · '+esc(new Date(data.updatedAt).toLocaleString('ko-KR')):''}<button data-action="reload">${icon('refresh')}새로고침</button></footer>`);
    }
  }
  function addRow(item){
    const row=document.createElement('fieldset');row.className='ai-field';
    row.innerHTML=`<legend>안내 항목</legend><label>제목<input name="label" required maxlength="80" value="${esc(item.label)}" placeholder="예: 데스크 연락처"></label><label>내용<textarea name="value" required maxlength="4000" rows="3" placeholder="강사에게 안내할 내용을 입력하세요">${esc(item.value)}</textarea></label><button type="button" data-action="remove" aria-label="이 항목 삭제">${icon('delete_outline')}항목 삭제</button>`;
    page.querySelector('.ai-fields').append(row);
  }
  async function load(){
    const id=++sequence;data=null;editing=false;render();page.setAttribute('aria-busy','true');
    try{const result=await request('academyInfoRead');if(id!==sequence)return;data=result;render();}
    catch(error){if(id!==sequence)return;render(error.message);page.querySelector('.ai-body').innerHTML='<div class="ai-empty"><h3>안내를 불러오지 못했습니다</h3><button data-action="reload">다시 시도</button></div>';}
    finally{if(id===sequence)page.removeAttribute('aria-busy');}
  }
  async function save(event){
    event.preventDefault();if(busy)return;
    const items=[...page.querySelectorAll('.ai-field')].map(row=>({label:row.querySelector('input').value,value:row.querySelector('textarea').value}));
    busy=true;page.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
    page.querySelector('.ai-notice').textContent='변경 내용을 저장하고 있습니다.';
    try{data=await request('academyInfoSave',{revision:data.revision,items});editing=false;render('저장했습니다. 강사 화면에도 변경된 안내가 표시됩니다.');}
    catch(error){page.querySelector('.ai-notice').textContent=error.message;}
    finally{busy=false;page.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);}
  }
  page.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||busy)return;
    const action=button.dataset.action;
    if(action==='edit'&&data?.editable){editing=true;render();page.querySelector('input')?.focus();}
    if(action==='cancel'){editing=false;render();}
    if(action==='add'&&page.querySelectorAll('.ai-field').length<40)addRow({label:'',value:''});
    if(action==='remove')button.closest('fieldset').remove();
    if(action==='reload')load();
    if(button.dataset.copy!==undefined){try{await navigator.clipboard.writeText(data.items[Number(button.dataset.copy)].value);page.querySelector('.ai-notice').textContent='복사했습니다.';}catch{page.querySelector('.ai-notice').textContent='복사하지 못했습니다. 내용을 직접 선택해 복사해 주세요.';}}
  });
  window.openInfoModal=function(){page.style.display='flex';load();};
  window.addEventListener('beforeunload',event=>{if(editing){event.preventDefault();event.returnValue='';}});
})();
