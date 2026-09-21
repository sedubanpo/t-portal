/* Published intranet history only. Authorization is enforced by the database. */
(function () {
  'use strict';
  let rows = [], total = 0, request = 0, busy = false, error = '', filter = 'all';
  const fields = { class_date:'수업일', student_name:'학생', subject:'과목', category:'구분', lesson_type:'수업 유형', status:'출결', start_time_text:'시작', end_time_text:'종료', hours:'인정 시수' };
  const labels = {published:'반영', changed:'변경', removed:'삭제·배정 해제'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value = (key, v) => v == null || v === '' ? '—' : String(v) + (key === 'hours' ? ' H' : '');
  function differences(row) {
    return Object.keys(fields).filter(k => row.before == null || row.after == null || String(row.before[k] ?? '') !== String(row.after[k] ?? ''));
  }
  function scope() { return {teacherName:viewTeacherName || currentUser.name || '', monthKey:currentYear + '-' + String(currentMonth + 1).padStart(2,'0')}; }
  function active() { return document.getElementById('hours-modal').classList.contains('hh-open'); }
  function card(row) {
    const data = row.after || row.before || {};
    const stamp = new Date(row.changedAt);
    const when = Number.isNaN(stamp.getTime()) ? '반영 시각 정보 없음' : '포털 반영 '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(stamp);
    const kind = labels[row.kind] ? row.kind : 'changed';
    const keys = differences(row);
    return `<article class="hh-event hh-${kind}"><div class="hh-event-top"><span class="hh-kind">${labels[kind]}</span><time>${esc(when)} · KST</time></div><h4>${esc(data.student_name || '학생 정보 없음')}<span>${esc(data.class_date)} · ${esc(data.subject || '과목 확인')}</span></h4><p class="hh-actor">전송·반영 담당자 <strong>${esc(row.actor || '담당자 정보 없음')}</strong></p><details ${kind === 'changed' ? 'open' : ''}><summary>${kind === 'changed' ? keys.length + '개 항목 변경' : kind === 'removed' ? '이전에 배정된 수업 보기' : '반영된 수업 보기'}</summary><div class="hh-diff"><div class="hh-diff-head"><span>항목</span><span>변경 전</span><span>변경 후</span></div>${keys.map(k=>`<div class="hh-diff-row"><span>${fields[k]}</span><span>${esc(value(k,row.before?.[k]))}</span><strong>${esc(value(k,row.after?.[k]))}</strong></div>`).join('')}</div></details></article>`;
  }
  function render() {
    const root = document.getElementById('hours-history');
    const s = scope();
    const shown = rows.filter(r => filter === 'all' || r.kind === filter);
    root.innerHTML = `<header class="hh-header"><div><p class="hh-eyebrow">HOURS ACTIVITY</p><h3>시수 변경 이력</h3><p>${esc(s.teacherName)} 선생님 · ${esc(s.monthKey)} 수업 기준</p></div><button type="button" onclick="refreshHoursHistory()" ${busy?'disabled':''}>새로고침</button></header><div class="hh-month"><button type="button" onclick="changeMonth(-1)" aria-label="이전 달">‹</button><strong>${esc(s.monthKey)}</strong><button type="button" onclick="changeMonth(1)" aria-label="다음 달">›</button><span>전체 ${total}건</span></div><p class="hh-explain">인트라넷에서 포털에 반영한 기록입니다. ‘반영’은 최초 입력이 아닌 재배정일 수도 있습니다. 삭제·배정 해제된 수업도 확인할 수 있습니다.</p><div class="hh-filters" aria-label="이력 종류">${['all','changed','published','removed'].map(k=>`<button type="button" aria-pressed="${filter===k}" onclick="filterHoursHistory('${k}')">${k==='all'?'전체':labels[k]}</button>`).join('')}</div><div role="status" class="hh-status">${busy?'변경 이력을 불러오고 있습니다…':error?esc(error):`${rows.length} / ${total}건 불러옴`}</div>${error?'<button type="button" onclick="refreshHoursHistory()">다시 시도</button>':''}<div class="hh-timeline">${shown.map(card).join('')}${!busy&&!error&&!shown.length?'<div class="hh-empty"><strong>표시할 변경 이력이 없습니다.</strong><p>저장된 반영 기록부터 표시합니다. 이전 기록이나 아직 전송하지 않은 변경은 포함되지 않습니다.</p></div>':''}</div>${rows.length<total?`<button class="hh-more" type="button" onclick="loadMoreHoursHistory()" ${busy?'disabled':''}>이전 기록 더 보기</button>`:''}<p class="hh-footnote">수정·삭제는 인트라넷에서 처리합니다. 변경 담당자의 현재 등록 이름을 표시하며, 등록 정보가 없으면 이름을 추정하지 않습니다.</p>`;
  }
  async function load(append) {
    if (!active() || (append && busy)) return;
    const id = ++request, s = scope();
    if (!append) { rows=[]; total=0; }
    busy=true; error=''; render();
    try {
      const token = await getTeacherPortalFirebaseIdToken_(false);
      if (id !== request) return;
      const response = await fetch('https://asia-northeast3-fir-lms-prod.cloudfunctions.net/teacherPortalBootstrap', {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({mode:'hoursHistory',...s,offset:rows.length}),signal:AbortSignal.timeout(25000)});
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.message || '변경 이력을 불러오지 못했습니다.');
      if (id !== request) return;
      rows = append ? rows.concat(result.rows || []) : result.rows || [];
      total = Number(result.total) || 0;
    } catch(e) { if (id === request) error = e.name === 'TimeoutError' ? '조회 시간이 길어지고 있습니다. 다시 시도해 주세요.' : e.message; }
    finally { if (id === request) { busy=false; render(); } }
  }
  window.toggleHoursHistory = function () {
    const open = !active();
    document.getElementById('hours-modal').classList.toggle('hh-open',open);
    document.getElementById('hours-history').hidden = !open;
    const button=document.getElementById('hh-toggle');
    button.setAttribute('aria-expanded',String(open)); button.textContent=open?'캘린더로 돌아가기':'변경 이력';
    if (open) load(false); else ++request;
  };
  window.resetHoursHistory = function () { if(active()) window.toggleHoursHistory(); };
  window.refreshHoursHistory = function () { return load(false); };
  window.loadMoreHoursHistory = function () { return load(true); };
  window.filterHoursHistory = function (next) {filter=next;render();};
  if(typeof module !== 'undefined')module.exports={differences,esc,card};
})();
