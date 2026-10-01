const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||'/tmp/portal-period-preview');
execFileSync(process.execPath,[path.join(__dirname,'build-admin-ui-preview.cjs'),out]);
const source=fs.readFileSync(path.join(repo,'index.html'),'utf8');
const extract=name=>{const a=source.indexOf('  function '+name+'('),b=source.indexOf('\n  function ',a+4);if(a<0)throw Error(name);return source.slice(a,b<0?undefined:b)};
let html=fs.readFileSync(path.join(out,'index.html'),'utf8');
const functions=['refreshStudentStats','getStudentStatsGapDays','getStudentStatsRisk','enrichStudentStatsRow'].map(extract).join('\n');
const fixture=`<script>
currentUser={uid:'preview'};window.appState={studentStatsByMonth:{},studentStatsSnapshotMetaByMonth:{}};let fixtureFailure=false;
const fixtureRows=allStatsData.map((r,i)=>({...r,canonicalStudentId:'fixture-'+i,latestRow:{dateKey:'2026-09-28',category:'수학',hours:2},latestDateKey:'2026-09-28'}));
const STUDENT_STATS_SCHEMA_VERSION='v291';function getTcsSubjectGroup(){return '수학'}
function ensureStudentStatsCacheState(){}function syncStatsMonthInputs(){document.getElementById('stats-month-picker-inline').value=document.getElementById('stats-month-picker').value;}
function syncStatsMonthFromInline(){document.getElementById('stats-month-picker').value=document.getElementById('stats-month-picker-inline').value;refreshStudentStats();}
function isValidStudentStatsCache(v){return Array.isArray(v)}function isFreshStudentStatsMemoryCache(){return true;}
function showStudentStatsLoading(a,b){document.getElementById('stats-list-container').textContent=a;}
function setStudentStatsRefreshState_(state,text){document.getElementById('student-stats-refresh-state').textContent=text;}
function hydrateStudentMonthlyStatsMonth_(target,force,done){const end=document.getElementById('stats-month-picker').value,prev=PortalPeriod.fromKey(end)[0].monthKey;done(!(fixtureFailure&&target.monthKey===end),target.monthKey===prev?fixtureRows.map(r=>({...r,latestRow:{...r.latestRow,dateKey:prev+'-28'},latestDateKey:prev+'-28'})):[]);}
function fetchTeacherMonthlyEntriesDirect_(){return Promise.reject(Error('검증용 조회 실패'));}
function formatStatsShortDate(v){return v.slice(5).replace('-','/')}function formatStatsGradeShort(v){return v+'학년'}function formatStatsSchoolName(v){return v}function getCalculatedHours(r){return Number(r.hours||0)}
${functions}
document.getElementById('stats-month-picker').value='2026-10';refreshStudentStats();
const controls=document.querySelector('.preview-controls');controls.innerHTML='가상 데이터 · 이번 달 0건 / 지난달 6명 <button type="button" onclick="fixtureFailure=!fixtureFailure;refreshStudentStats()">일부 조회 실패 전환</button><a href="calendars.html">두 달 달력 검증</a>';
</script>`;
html=html.replace('</body>',fixture+'</body>');fs.writeFileSync(path.join(out,'index.html'),html);
// Actual calendar renderers with synthetic metrics; daily selection callbacks are read-only fixture stubs.
const css=source.match(/<style>[\s\S]*?<\/style>/)[0];
const calendarFunctions=['renderTeacherClassStatusCalendar','selectTeacherClassStatusDay','renderClassLogAuditCalendar','selectClassLogAuditDate','renderTotalClassAnalysisDailyCalendar','makeTcaBucket','roundTcaHours','getTcaTopSubject'].map(extract).join('\n');
const calendars=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>연속 2개월 달력 · 가상 데이터 검증</title>${css}<link rel="stylesheet" href="portal-period.css"><style>body{padding:18px;background:#f8fafc}main{width:100%;max-width:1440px;margin:auto}section{margin:20px 0;background:white;padding:16px;overflow:auto}button{min-height:44px;padding:8px 14px}h1{font-size:22px}.preview-hidden{display:none}#tcs-grid,#cla-grid,.tca-daily-calendar{min-width:700px}#tcs-grid .tcs-day{min-height:100px}</style><main><h1>연속 2개월 조회 · 가상 데이터 검증</h1><p>같은 ‘1일’의 수업이 9월·10월에 각각 표시됩니다.</p><button onclick="switchCalendar('tcs')">과목 스케줄</button><button onclick="switchCalendar('cla')">출결 검토</button><button onclick="switchCalendar('tca')">수업 분석</button><a href="index.html">재원생 목록</a><section id="tcs"><h2 id="tcs-month-title"></h2><select id="tcs-teacher-filter"><option>ALL</option></select><select id="tcs-subject-filter"><option>ALL</option></select><div id="tcs-grid" class="tcs-grid"></div><div id="tcs-detail"></div></section><section id="cla" class="preview-hidden"><h2>출결 검토 · 2026년 9–10월</h2><div id="cla-grid" class="cla-grid"></div><div id="cla-detail"></div><div id="cla-ranking"></div><div id="cla-summary-cards"></div><div id="cla-bottom-table-wrap"></div><input id="cla-teacher-search-input" hidden></section><section id="tca" class="preview-hidden"><h2>전체 수업 분석 · 2026년 9–10월</h2><div id="tca-daily" class="tca-daily-calendar"></div></section></main><script src="portal-period.js"></script><script>
let tcsYear=2026,tcsMonth=9,tcsTeacherSearchQuery='',tcsHighlightState={weekday:null},tcsSelectedKey='',tcsMonthFilteredData=[],tcsDayMap={};
let classLogAuditYear=2026,classLogAuditMonth=9,classLogAuditSelectedKey='',classLogAuditTeacherQuery='';
let tcaYear=2026,tcaMonth=9;const TCS_SUBJECT_ORDER=['수학'];
const escapeHtml_=PortalPeriodEscape=v=>String(v||'').replace(/</g,'&lt;');
const toYmdKey=(y,m,d)=>PortalPeriod.key(y,m)+'-'+String(d).padStart(2,'0'),toDateKey=()=> '2026-10-01';
function getTcsSubjectGroup(){return '수학'}function getTcsDensityChipStyle(){return ''}function getTcsSubjectClass(){return 'math'}function renderPortalSubject_(v){return v}function renderTcsTypeSummary(){return '개별 1'}function buildTcsTypeCountMap(){return {regular:1}}
function renderTeacherClassStatusDetail(key){document.getElementById('tcs-detail').textContent='선택 일자: '+key;}
function getAuditDayStats(day){return {teachers:day.teachers||[]}}function isClassLogDayUnentered(){return false}function renderClassLogAgreementTeacherChips(key,day){return day.teachers.length?'가상 강사 · 시수 동의 필요':''}
function renderClassLogAuditDetail(key){document.getElementById('cla-detail').textContent='선택 일자: '+key}function renderClassLogAuditSummaryCards(){}function renderClassLogAuditRanking(){}function renderClassLogAuditBottomTable(){}function renderClassLogAuditTeacherSearch(){}
const tcsPeriodRows_=['2026-09-01','2026-10-01'].map(dateKey=>({dateKey,year:2026,month:Number(dateKey.slice(5,7))-1,day:1,teacher:'가상 강사',student:'가상 학생',category:'수학'}));
const classLogAuditData={dayMap:Object.fromEntries(tcsPeriodRows_.map(r=>[r.dateKey,{teachers:[{teacher:'가상 강사',taught:1,hoursAgreementSigned:false}]}]))};
${calendarFunctions}
function switchCalendar(name){for(const id of ['tcs','cla','tca'])document.getElementById(id).classList.toggle('preview-hidden',id!==name)}
renderTeacherClassStatusCalendar();renderClassLogAuditCalendar();
const bucket=()=>({...makeTcaBucket(),hours:2,lessons:1,typeHours:{regular:2},teachers:{'가상 강사':true},students:{'가상 학생':true},subjects:{수학:2}});
document.getElementById('tca-daily').innerHTML=renderTotalClassAnalysisDailyCalendar({byDate:Object.fromEntries(tcsPeriodRows_.map(r=>[r.dateKey,bucket()]))});
</script></html>`;
fs.writeFileSync(path.join(out,'calendars.html'),calendars);console.log('Period preview generated (synthetic data only)');
