(() => {
  const dialog = document.getElementById('missing-hours');
  const form = document.getElementById('missing-hours-form');
  const field = name => form.elements.namedItem(name);
  const feedback = document.getElementById('mh-feedback');
  const submit = form.querySelector('[type=submit]');
  let owner = '', pending = false, requestId = '', previousInput = '';

  function choices(id, name, options) {
    const host = document.getElementById(id);
    for (const value of options) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = name;
      radio.value = value;
      radio.required = true;
      const caption = document.createElement('span');
      caption.textContent = value;
      label.append(radio, caption);
      host.append(label);
    }
  }
  choices('mh-types', 'lessonType', ['개별정규','1:1','2:1','3:1','4:1','특강','추가수업','무료보충','직전보강']);
  choices('mh-statuses', 'attendanceStatus', ['출석','당일취소','결석예고','결석보강','당취보충']);

  function minutes(value, end = false) {
    const match = value.trim().match(/^(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return NaN;
    const h = Number(match[1]), m = Number(match[2] || 0);
    if (end && h === 24 && m === 0) return 1440;
    return h < 24 && m < 60 ? h * 60 + m : NaN;
  }
  function clock(n) {
    return [Math.floor(n / 60), n % 60].map(x => String(x).padStart(2, '0')).join(':');
  }
  for (const name of ['start','end']) {
    field(name).addEventListener('blur', () => {
      const n = minutes(field(name).value, name === 'end');
      if (Number.isFinite(n)) field(name).value = clock(n);
    });
  }
  form.querySelectorAll('[data-duration]').forEach(button => button.onclick = () => {
    const start = minutes(field('start').value);
    if (!Number.isFinite(start)) {
      feedback.textContent = '시작 시간을 먼저 입력하세요. 예: 16 또는 1630';
      field('start').focus();
      return;
    }
    const end = start + Number(button.dataset.duration);
    if (end > 1440) { feedback.textContent = '종료 시간은 당일 24:00까지 입력할 수 있습니다.'; return; }
    field('end').value = clock(end);
    feedback.textContent = '';
  });

  const ownAccount = () => currentUser?.uid && !isAdminMode && currentUser.name === viewTeacherName;
  document.getElementById('missing-hours-open').onclick = () => {
    if (!ownAccount() || pending) return;
    owner = currentUser.uid;
    previousInput = '';
    form.reset();
    feedback.textContent = '';
    const today = new Date();
    const day = selectedDay || (today.getFullYear() === currentYear && today.getMonth() === currentMonth ? today.getDate() : 1);
    field('lessonDate').value = [currentYear,currentMonth + 1,day].map(v => String(v).padStart(2,'0')).join('-');
    dialog.showModal();
    field('student').focus();
  };
  form.querySelector('[data-dismiss]').onclick = () => { if (!pending) dialog.close(); };
  dialog.addEventListener('cancel', e => { if (pending) e.preventDefault(); });
  form.onsubmit = async event => {
    event.preventDefault();
    if (pending || !ownAccount() || currentUser.uid !== owner) return;
    const data = Object.fromEntries(new FormData(form));
    const student = data.student.trim(), start = minutes(data.start), end = minutes(data.end,true);
    if (!student || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      feedback.textContent = '학생명과 시간을 확인하세요. 종료 시간은 시작 시간보다 늦어야 합니다.';
      return;
    }
    const serialized = JSON.stringify(data);
    if (serialized !== previousInput) { requestId = createPortalUuid_(); previousInput = serialized; }
    const note = data.note.trim();
    const payload = {
      clientRequestId: requestId, teacherName: currentUser.name, studentName: student,
      lessonDate: data.lessonDate, subject: currentUser.subject || '', lessonType: data.lessonType,
      attendanceStatus: data.attendanceStatus, startTime: clock(start), endTime: clock(end),
      hours: Number(((end-start)/60).toFixed(2)), issueCategory: 'hours_time',
      lessonFingerprint: 'missing:' + JSON.stringify([data.lessonDate,student.normalize('NFKC'),start,end,data.lessonType]),
      issueText: ['[시수 추가 요청] '+student, clock(start)+'–'+clock(end)+' · '+data.lessonType+' · '+data.attendanceStatus, note].filter(Boolean).join('\n'),
      sourceSnapshot: {requestKind:'missing_lesson', note, appVersion:APP_VERSION}
    };
    pending = true;
    form.inert = true;
    submit.disabled = true;
    feedback.textContent = '접수 중…';
    try {
      portalApi.setRoute('submitTeacherHoursIssueReport','supabase');
      const result = await portalApi.call('submitTeacherHoursIssueReport',payload,{timeoutMs:30000,retries:1});
      if (!result?.success || !result.report?.id) throw Error('접수 결과를 확인하지 못했습니다.');
      dialog.close();
      if (currentUser.uid !== owner) return;
      const report = normalizeTeacherHoursIssueReport_(result.report);
      const month = currentYear+'-'+String(currentMonth+1).padStart(2,'0');
      if (report.lessonDate.startsWith(month+'-')) {
        teacherHoursIssueRows = teacherHoursIssueRows.filter(row => row.id !== report.id).concat(report);
        rebuildTeacherHoursIssueMap_();
      }
      showToast(result.duplicate ? '이미 접수된 추가 요청입니다.' : '시수 추가 요청을 접수했습니다.');
    } catch (error) {
      feedback.textContent = error.message || '접수에 실패했습니다. 다시 시도해 주세요.';
    } finally {
      pending = false;
      form.inert = false;
      submit.disabled = false;
    }
  };
})();
