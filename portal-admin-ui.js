(function(root){
  'use strict';
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normal=v=>String(v??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  const safePhoto=value=>{
    let src=String(value||'').trim().replace(/&amp;/g,'&');
    if(/^https?:\/\/github\.com\//i.test(src))src=src.replace(/^https?:\/\/github\.com\//i,'https://raw.githubusercontent.com/').replace('/blob/','/').replace(/\?raw=true$/i,'');
    try{const u=new URL(src);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}
  };
  const missing=v=>!String(v||'').trim()||['-','확인필요','정보없음'].includes(String(v).trim());
  const selectedValues=select=>Array.from(select?.selectedOptions||[]).map(o=>o.value).filter(v=>v&&v!=='All');
  function matchesSchool(row,values){return !values.length||values.some(v=>String(v).trim()===String(row.school||'').trim());}
  function matchesMeta(row,value){return value==='school'?missing(row.school):value==='grade'?missing(row.grade):true;}
  function sortRows(rows,order='count'){
    const name=(a,b)=>String(a.student||'').localeCompare(String(b.student||''),'ko');
    return rows.slice().sort((a,b)=>order==='name'?name(a,b):order==='school'?String(a.school||'').localeCompare(String(b.school||''),'ko')||String(a.grade||'').localeCompare(String(b.grade||''),'ko',{numeric:true})||name(a,b):order==='recent'?Number(b.latestDay||0)-Number(a.latestDay||0)||name(a,b):Number(b.totalCount||0)-Number(a.totalCount||0)||name(a,b));
  }
  function schoolGroups(rows,values,query=''){
    const groups=new Map(),counts=new Map(),levels=new Map();
    rows.forEach(r=>{if(missing(r.school))return;const name=String(r.school).trim();counts.set(name,(counts.get(name)||0)+1);if(!levels.has(name))levels.set(name,r.level||'기타');});
    [...new Set([...counts.keys(),...values])].sort((a,b)=>a.localeCompare(b,'ko')).forEach(name=>{
      const level=levels.get(name)||'선택 월에 없음';if(query&&!normal(name+' '+level).includes(normal(query)))return;
      if(!groups.has(level))groups.set(level,[]);groups.get(level).push({name,count:counts.get(name)||0});
    });
    return ['초등','중등','고등','기타','선택 월에 없음'].filter(k=>groups.has(k)).map(label=>({label,options:groups.get(label)}));
  }
  const specs={
    'filter-teacher':{label:'담당 강사',icon:'person_search'},'filter-subject':{label:'과목',icon:'menu_book'},
    'filter-level':{label:'학교급',icon:'school'},'filter-school':{label:'학교',icon:'apartment',multiple:true},
    'filter-grade':{label:'학년',icon:'stairs'},'filter-status':{label:'출석 상태',icon:'fact_check'},
    'filter-count':{label:'수업 횟수',icon:'event_repeat'},'filter-meta':{label:'정보 확인',icon:'manage_search'}
  };
  let adapter=null,choiceDialog=null,activeId='',draft=[],opener=null;
  function enhanceStats(rows){
    if(!root.document)return;
    Object.entries(specs).forEach(([id,spec])=>{
      const select=document.getElementById(id);if(!select)return;
      let button=document.getElementById(id+'-trigger');
      if(!button){
        button=document.createElement('button');button.type='button';button.id=id+'-trigger';button.className='pau-filter-trigger';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
        select.classList.add('pau-source-select');select.setAttribute('aria-hidden','true');select.tabIndex=-1;select.after(button);button.addEventListener('click',()=>openChoice(id));
      }
      const values=selectedValues(select),selected=Array.from(select.selectedOptions||[]).filter(o=>o.value!=='All'),text=selected.map(o=>o.textContent).join(', ');
      button.classList.toggle('is-selected',!!values.length);button.setAttribute('aria-label',spec.label+': '+(text||'전체'));
      button.innerHTML=`<span class="material-icons-round" aria-hidden="true">${spec.icon}</span><span class="pau-filter-copy"><span>${spec.label}</span><strong>${escape(values.length>1?values.length+'개 선택':text||'전체')}</strong></span><span class="material-icons-round pau-chevron" aria-hidden="true">expand_more</span>`;
    });
    if(choiceDialog?.open){draft=selectedValues(document.getElementById(activeId));renderChoices();}
  }
  function attach(options){adapter=options;}
  function ensureChoice(){
    if(choiceDialog)return;
    choiceDialog=document.createElement('dialog');choiceDialog.className='pau-choice-dialog';choiceDialog.setAttribute('aria-labelledby','pau-choice-title');
    choiceDialog.innerHTML=`<header class="pau-dialog-header"><div><h2 id="pau-choice-title"></h2><p id="pau-choice-note"></p></div><button type="button" class="pau-icon-button" aria-label="필터 선택 닫기" data-close><span class="material-icons-round" aria-hidden="true">close</span></button></header><label class="pau-search"><span class="material-icons-round" aria-hidden="true">search</span><input type="search" id="pau-choice-search" aria-label="필터 선택지 검색" autocomplete="off" placeholder="이름으로 검색"></label><div class="pau-choice-tools"><button type="button" data-clear>전체 보기</button><span id="pau-choice-selection" aria-live="polite"></span></div><div id="pau-choice-list" class="pau-choice-list"></div><footer class="pau-choice-footer"><button type="button" class="pau-secondary" data-close>취소</button><button type="button" class="pau-primary" data-apply>적용</button></footer>`;
    document.body.append(choiceDialog);
    choiceDialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>choiceDialog.close());
    choiceDialog.querySelector('[data-clear]').onclick=()=>{draft=[];if(!specs[activeId].multiple)applyChoice();else renderChoices();};
    choiceDialog.querySelector('[data-apply]').onclick=applyChoice;
    choiceDialog.querySelector('input').oninput=renderChoices;
    choiceDialog.addEventListener('close',()=>{opener?.setAttribute('aria-expanded','false');opener?.focus();});
    choiceDialog.addEventListener('click',e=>{const r=choiceDialog.getBoundingClientRect();if(e.target===choiceDialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))choiceDialog.close();});
  }
  function openChoice(id){
    if(!adapter?.canUse())return;
    ensureChoice();activeId=id;opener=document.getElementById(id+'-trigger');draft=selectedValues(document.getElementById(id));
    const spec=specs[id];choiceDialog.querySelector('#pau-choice-title').textContent=spec.label+' 선택';
    choiceDialog.querySelector('#pau-choice-note').textContent=spec.multiple?'학교를 검색하고 여러 곳을 함께 선택하세요. 인원은 선택 월 기준입니다.':'이름을 검색해 선택하세요. 전체 보기를 누르면 필터를 해제합니다.';
    choiceDialog.querySelector('input').value='';choiceDialog.querySelector('input').placeholder=spec.label+' 검색';
    choiceDialog.querySelector('.pau-choice-footer').hidden=!spec.multiple;
    choiceDialog.querySelector('[data-clear]').textContent=spec.multiple?'선택 모두 해제':'전체 보기';
    renderChoices();opener.setAttribute('aria-expanded','true');choiceDialog.showModal();choiceDialog.querySelector('input').focus();
  }
  function renderChoices(){
    const select=document.getElementById(activeId),spec=specs[activeId],query=choiceDialog.querySelector('input').value;
    let groups;
    if(spec.multiple)groups=schoolGroups(adapter.rows(),[...selectedValues(select),...draft],query);
    else groups=[{label:'',options:Array.from(select.options).filter(o=>o.value!=='All'&&normal(o.textContent).includes(normal(query))).map(o=>({name:o.textContent,value:o.value}))}];
    const list=choiceDialog.querySelector('#pau-choice-list');list.replaceChildren();
    let count=0;
    groups.forEach(group=>{
      if(!group.options.length)return;count+=group.options.length;
      const section=document.createElement('section');if(group.label){const title=document.createElement('h3');title.textContent=group.label;section.append(title);}
      const wrap=document.createElement('div');wrap.className='pau-choice-options';section.append(wrap);
      group.options.forEach(o=>{
        const value=o.value??o.name,selected=draft.includes(value),button=document.createElement('button');button.type='button';button.className='pau-choice-option';button.dataset.value=value;button.setAttribute('aria-pressed',String(selected));
        button.innerHTML=`<span class="material-icons-round" aria-hidden="true">${spec.multiple?(selected?'check_box':'check_box_outline_blank'):(selected?'check_circle':'radio_button_unchecked')}</span><span>${escape(o.name)}</span>${o.count!==undefined?`<small>${o.count}명</small>`:''}`;
        button.onclick=()=>{if(spec.multiple){draft=selected?draft.filter(v=>v!==value):[...draft,value];renderChoices();Array.from(list.querySelectorAll('button')).find(b=>b.dataset.value===value)?.focus();}else{draft=[value];applyChoice();}};wrap.append(button);
      });list.append(section);
    });
    if(!count){const note=document.createElement('p');note.className='pau-empty';note.textContent=adapter.rows().length?'검색 결과가 없습니다. 검색어를 바꿔 보세요.':'선택 월에 조회할 항목이 없습니다. 다른 월을 선택해 주세요.';list.append(note);}
    choiceDialog.querySelector('#pau-choice-selection').textContent=spec.multiple?draft.length+'개 학교 선택':'';
    choiceDialog.querySelector('[data-apply]').textContent=draft.length?draft.length+'개 학교 적용':'전체 학교 보기';
  }
  function applyChoice(){
    const select=document.getElementById(activeId);Array.from(select.options).forEach(o=>o.selected=draft.length?draft.includes(o.value):o.value==='All');
    choiceDialog.close();adapter.changed();
  }
  function schoolChips(select){return selectedValues(select).map(value=>`<span class="sdb-filter-chip">학교: ${escape(value)} <button type="button" data-pau-remove-school="${escape(value)}" aria-label="${escape(value)} 학교 필터 해제"><span class="material-icons-round" aria-hidden="true">close</span></button></span>`);}
  function removeSchool(value){const select=document.getElementById('filter-school'),left=selectedValues(select).filter(v=>v!==value);Array.from(select.options).forEach(o=>o.selected=left.length?left.includes(o.value):o.value==='All');adapter.changed();}
  function teacherMarkup(teachers,current,query='',subject='All',groupLabel){
    const order=['국어','영어','수학','과학','사회','기타'];let count=0;
    const html=order.map(label=>{
      if(subject!=='All'&&subject!==label)return '';
      const rows=teachers.map((t,index)=>({...t,index})).filter(t=>groupLabel(t.subject)===label&&normal(t.name+' '+(t.subject||'')).includes(normal(query))).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ko'));
      if(!rows.length)return '';count+=rows.length;
      return `<section class="pau-teacher-group" data-subject="${label}"><h3>${label}<span>${rows.length}명</span></h3><div class="pau-teacher-grid">${rows.map(t=>{
        const photo=safePhoto(t.profileImage),active=t.name===current;
        return `<button type="button" class="pau-teacher-option" data-teacher-index="${t.index}" aria-pressed="${active}"><span class="pau-avatar"><span class="material-icons-round" aria-hidden="true">person</span>${photo?`<img src="${escape(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}</span><span class="pau-teacher-copy"><strong>${escape(t.name)}</strong><span>${escape(t.subject||'과목 미등록')}</span></span><span class="material-icons-round pau-teacher-check" aria-hidden="true">${active?'check_circle':'chevron_right'}</span></button>`;
      }).join('')}</div></section>`;
    }).join('');
    return {html:html||'<p class="pau-empty">검색 결과가 없습니다. 이름이나 과목을 확인해 주세요.</p>',count};
  }
  const api={escape,safePhoto,missing,selectedValues,matchesSchool,matchesMeta,sortRows,schoolGroups,teacherMarkup,attach,enhanceStats,schoolChips,removeSchool};
  root.PortalAdminUI=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
