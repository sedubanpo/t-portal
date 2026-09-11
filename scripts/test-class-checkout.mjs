import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=name=>{const a=source.indexOf('  function '+name+'(');assert(a>=0,name);return source.slice(a,source.indexOf('\n  function ',a+1));};
const elements=new Map();
const el=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',style:{setProperty(k,v){this[k]=v;}}});return elements.get(id);};
const ctx={Date,Map,Set,console,document:{getElementById:el,querySelectorAll:()=>[]},
  classLogAuditYear:2026,classLogAuditMonth:8,classLogAuditSelectedKey:'2026-09-11',classLogAuditTeacherQuery:'',
  classLogAuditData:{dayMap:{}},
  escapeHtml_:v=>String(v??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll("'",'&#39;'),
  toYmdKey:(y,m,d)=>`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
  toDateKey:()=> '2026-09-11',
  getAuditDayStats:day=>({teachers:day.teachers.map(t=>({...t,taught:t.taughtCount})),taught:day.teachers.length}),
  getCompactStatusText:s=>s,getAuditStatusClass:()=>'',getClassLogReasonText:()=>'',
  getAgreementClass:()=>'',getAgreementText:t=>t.hoursAgreementSigned?'동의':'미동의',
  formatClassLogLessonMetric:()=>({main:'1건 · 2H'}),renderClassLogNoteButton:()=>'',
  renderClassLogAuditSummaryCards:()=>{},renderClassLogAuditRanking:()=>{},renderClassLogAuditBottomTable:()=>{},renderClassLogAuditTeacherSearch:()=>{}
};
vm.createContext(ctx);
['renderClassLogAgreementTeacherChips','isClassLogDayUnentered','renderClassLogAuditCalendar','selectClassLogAuditDate','renderClassLogAuditDetail'].forEach(n=>vm.runInContext(extract(n),ctx));
ctx.classLogAuditData.dayMap['2026-09-11']={teachers:[
 {teacher:'동의강사',taughtCount:1,hoursAgreementSigned:true,portalStatus:'기록없음',status:'제출 완료',notionLogCount:1},
 {teacher:'미동의강사',taughtCount:1,hoursAgreementSigned:false,portalStatus:'제출 완료',portalSubmittedCount:1}
]};
ctx.renderClassLogAuditCalendar();
assert.equal(el('cla-grid').style['--cla-weeks'],5);
const grid=el('cla-grid').innerHTML;
assert.equal((grid.match(/data-date=/g)||[]).length,30);
assert.match(grid,/data-date="2026-09-11"[\s\S]*?openClassLogTeacherDetail\('2026-09-11'/);
assert.match(grid,/cla-chip-ok[^>]+>동의강사/);
assert.match(grid,/cla-chip-miss[^>]+>미동의강사/);
const detail=el('cla-detail').innerHTML;
assert.doesNotMatch(detail,/Notion|노션/);
assert.match(detail,/포털 일지 완료 1\/2명/,'Notion must not contribute to portal total');
assert.match(detail,/미동의 1명/);
ctx.classLogAuditMonth=7;ctx.renderClassLogAuditCalendar();
assert.equal(el('cla-grid').style['--cla-weeks'],6,'six-week month must retain every date');
assert.equal((el('cla-grid').innerHTML.match(/data-date=/g)||[]).length,31);
const before=el('cla-grid').innerHTML;
ctx.selectClassLogAuditDate('2026-08-02');assert.equal(el('cla-grid').innerHTML,before,'selection must retain focus and cell scroll');

// Exercise the real submit handler with an isolated backend, never production writes.
let request,stamped=0,toasts=[];
Object.assign(ctx,{classLogSubmitInFlight:new Set(),monthlyData:[
 {day:11,student:'가상학생',dateKey:'2026-09-11',status:'출석',hours:2},
 {day:11,student:'취소학생',dateKey:'2026-09-11',status:'당일취소',hours:0}],
 viewTeacherName:'가상강사',currentUser:{name:'가상강사'},getCalculatedHours:r=>r.hours,
 getClassRowKey:r=>r.student,ensureLogDraft:()=>({logStatus:'제출'}),showToast:m=>toasts.push(m),showLoading:()=>{},
 clearClassLogOverviewCacheForRows:()=>{},playSubmitStamp:()=>stamped++,
 saveClassLogRowsDirect_:(payload,ok,fail)=>{request={payload,ok,fail};}
});
['submitDailyClassLogs','resetDailyClassLogSubmitButton'].forEach(n=>vm.runInContext(extract(n),ctx));
ctx.submitDailyClassLogs(11);assert.equal(request.payload.rows.length,1);
const first=request;ctx.submitDailyClassLogs(11);assert.equal(request,first,'double click must not write twice');
request.ok({success:true,supabaseSynced:true});assert.equal(stamped,0,'missing signature proof must not show success');
assert.equal(el('daily-class-log-submit-11').disabled,false);
ctx.submitDailyClassLogs(11);request.fail({code:'SUPABASE_TIMEOUT'});assert.equal(stamped,0);assert.equal(ctx.classLogSubmitInFlight.size,0);
ctx.submitDailyClassLogs(11);request.ok({success:true,supabaseSynced:true,hoursAgreement:{signed:true,date:'2026-09-11'}});assert.equal(stamped,1);
assert.equal(ctx.classLogSubmitInFlight.size,0);
console.log('PASS checkout: five/six-week dates, consent grouping, portal-only detail, stable selection, submit success/failure/double-click');
