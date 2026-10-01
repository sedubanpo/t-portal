const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const P=require('../portal-period.js'),A=require('../portal-admin-ui.js');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function extract(name){const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  function ',start+4);assert(start>=0,name);return source.slice(start,end<0?undefined:end);}
test('rolling pairs cover the year boundary, leap month and reject invalid end month',()=>{
 assert.deepEqual(P.fromKey('2026-01').map(m=>m.monthKey),['2025-12','2026-01']);
 assert.deepEqual(P.range('2024-02'),{start:'2024-01-01',end:'2024-02-29'});
 assert.equal(P.label(2026,9),'2026년 9–10월');assert.equal(P.label(2026,0),'2025년 12월–2026년 1월');
 assert.throws(()=>P.fromKey('2026-13'));assert.throws(()=>P.fromKey('garbage'));
 assert(P.contains({dateKey:'2026-09-01'},2026,9));assert(!P.contains({dateKey:'2026-08-31'},2026,9));assert(!P.contains({dateKey:'2026-11-01'},2026,9));
});
const row=(id,date,count=1,extra={})=>({canonicalStudentId:id,student:'가상 학생',school:'가상고',grade:'2',totalCount:count,attendedCount:count,absentCount:0,teachers:{강사:count},subjects:{수학:count},lessonTypes:{개별:true},lessonTypeCounts:{개별:count},lessonClassDetails:{one:{count,hours:count*2,attendedCount:count,attendanceBase:count}},latestRow:{dateKey:date},rows:[],...extra});
test('two months merge canonical students, retain homonyms and recompute summed detail data without mutations',()=>{
 const a=row('one','2026-09-30',3),b=row('one','2026-10-01',1,{student:'가상 학생 새 표기'}),homonym=row('two','2026-10-01',2);
 const original=JSON.stringify([a,b,homonym]);const result=P.mergeStudents([{monthKey:'2026-09',rows:[a]},{monthKey:'2026-10',rows:[b,homonym]}]);
 assert.equal(result.length,2);assert.equal(result[0].totalCount,4);assert.equal(result[0].teachers.강사,4);assert.equal(result[0].lessonClassDetails.one.hours,8);assert.equal(result[0].latestRow.dateKey,'2026-10-01');assert.equal(result[0].student,b.student);
 assert.deepEqual(result[0].periodCounts,{'2026-09':3,'2026-10':1});assert.equal(JSON.stringify([a,b,homonym]),original);
 const ambiguous=P.mergeStudents([{monthKey:'2026-09',rows:[row('','2026-09-30')]},{monthKey:'2026-10',rows:[row('','2026-10-01',1,{school:'다른고'})]}]);assert.equal(ambiguous.length,2);
});
test('gap and recent sort compare actual dates across month/year boundaries',()=>{
 assert.equal(P.gapDays({latestRow:{dateKey:'2026-09-30'}},'2026-10',new Date('2026-10-01T09:00:00Z')),1);
 assert.equal(P.gapDays({latestDateKey:'2025-12-28'},'2026-01',new Date('2026-01-03T09:00:00Z')),6);
 assert.equal(P.gapDays({latestRow:{dateKey:'2024-01-31'}},'2024-02',new Date('2026-01-01')),29);
 assert.equal(P.gapDays({},'2026-10'),null);
 const sorted=A.sortRows([row('one','2026-09-30',1,{latestDay:30}),row('two','2026-10-01',1,{latestDay:1})],'recent');assert.equal(sorted[0].canonicalStudentId,'two');
});
test('failed month reads stay distinct from an empty successful month; audit totals require both reads',async()=>{
 const entries=await P.loadMonths(P.months(2026,9),async m=>{if(m.month0===8)throw Error('offline');return []});
 assert.equal(entries[0].loaded,false);assert.equal(entries[1].loaded,true);assert.equal(entries[0].error,'offline');
 assert.throws(()=>P.mergeOverviews([{success:true,dayMap:{}},null]));
 assert.deepEqual(Object.keys(P.mergeOverviews([{success:true,dayMap:{'2026-09-01':{}}},{success:true,dayMap:{'2026-10-01':{}}}]).dayMap),['2026-09-01','2026-10-01']);
});
test('period reads use separate monthly caches, share requests, and reject stale account results',async()=>{
 const pending=[];let reads=0;const context={PortalPeriod:P,Promise,currentUser:{uid:'one'},portalPeriodPending_:{},getTeacherDataScopeKey:r=>[r.year,r.month0,r.teacherName].join('|'),getTeacherScopeCacheForRequest:()=>null,setTeacherScopeCache:()=>{},dedupeTeacherDataEntries:v=>v,fetchTeacherMonthlyEntriesDirect_:r=>{reads++;return new Promise(resolve=>pending.push(()=>resolve([{dateKey:r.monthKey+'-01'}])));}};
 vm.runInNewContext(extract('fetchTeacherPeriodEntries_'),context);
 const first=context.fetchTeacherPeriodEntries_({year:2026,month0:9,teacherName:'강사'},false),second=context.fetchTeacherPeriodEntries_({year:2026,month0:9,teacherName:'강사'},false);
 assert.equal(reads,2);pending.splice(0).forEach(fn=>fn());assert.equal((await first).length,2);await second;
 const stale=context.fetchTeacherPeriodEntries_({year:2026,month0:9,teacherName:'강사'},true);context.currentUser.uid='two';pending.splice(0).forEach(fn=>fn());await assert.rejects(stale,/로그인 계정/);
});
test('period scope responses cannot overwrite a newer view or teacher projection',async()=>{
 const callbacks=[],renders=[];const context={currentUser:{uid:'one'},viewTeacherName:'강사',portalPeriodScopeGeneration_:0,fetchTeacherPeriodEntries_:()=>new Promise(resolve=>callbacks.push(resolve)),parseTeacherDataEntries:v=>v,showLoading:()=>{},showToast:()=>{}};
 vm.runInNewContext(extract('ensureTeacherPeriodScope_'),context);
 const one=context.ensureTeacherPeriodScope_({},v=>renders.push(v),{}),two=context.ensureTeacherPeriodScope_({},v=>renders.push(v),{});callbacks[1](['latest']);await two;callbacks[0](['old']);await one;assert.deepEqual(renders,[['latest']]);
 const three=context.ensureTeacherPeriodScope_({},v=>renders.push(v),{});context.viewTeacherName='다른 강사';callbacks[2](['wrong']);await three;assert.equal(renders.length,1);
});
test('each operating calendar keeps equal day numbers in separate months',()=>{
 const elements={},el=id=>elements[id]||(elements[id]={value:'ALL',innerHTML:'',innerText:'',style:{setProperty(){}}});
 const c={PortalPeriod:P,document:{getElementById:el,querySelectorAll:()=>[]},tcsYear:2026,tcsMonth:9,tcsPeriodRows_:[{year:2026,month:8,day:1,dateKey:'2026-09-01',teacher:'강사',student:'학생',category:'수학'},{year:2026,month:9,day:1,dateKey:'2026-10-01',teacher:'강사',student:'학생',category:'수학'}],tcsTeacherSearchQuery:'',tcsHighlightState:{weekday:null},tcsSelectedKey:'',TCS_SUBJECT_ORDER:['수학'],toYmdKey:(y,m,d)=>P.key(y,m)+'-'+String(d).padStart(2,'0'),toDateKey:()=> '2026-10-01',getTcsSubjectGroup:()=> '수학',getTcsDensityChipStyle:()=>'',getTcsSubjectClass:()=>'',escapeHtml_:String,renderPortalSubject_:String,renderTcsTypeSummary:()=>'',buildTcsTypeCountMap:()=>({}),renderTeacherClassStatusDetail:()=>{}};
 vm.runInNewContext(extract('renderTeacherClassStatusCalendar'),c);c.renderTeacherClassStatusCalendar();
 assert.equal(c.tcsDayMap['2026-09-01'].items.length,1);assert.equal(c.tcsDayMap['2026-10-01'].items.length,1);
 assert.match(el('tcs-grid').innerHTML,/data-tcs-date="2026-09-01"/);assert.match(el('tcs-grid').innerHTML,/data-tcs-date="2026-10-01"/);
 assert.equal((el('tcs-grid').innerHTML.match(/data-tcs-date=/g)||[]).length,61);
});
test('monthly signing and long-term trend boundaries stay unchanged while journal defaults start in prior month',()=>{
 assert.match(source,/monthlyData = allTeacherData\.filter/);assert.match(source,/d\.month === currentMonth && d\.year === currentYear/);
 assert.match(source,/getStudentMonthlyStatsTargets_\(selectedMonthKey, 13\)/);
 const journal=fs.readFileSync(path.join(__dirname,'../lesson-log-editor.js'),'utf8');assert.match(journal,/PortalPeriod\.range\(todayKST\(\)\.slice\(0,7\)\)\.start/);
 const signing=extract('submitDailyClassLogs');assert(!signing.includes('PortalPeriod'),'signing continues to address one date');
});

test('home totals sum both months, preserve monthly detail, and ignore a switched account',async()=>{
 const calls=[],pending=[];let monthlyDetail;
 const note={innerHTML:''};const c={PortalPeriod:P,currentUser:{uid:'one',name:'강사'},viewTeacherName:'강사',currentYear:2026,currentMonth:9,desktopPeriodLoadId_:0,window:{},document:{getElementById:()=>note},buildHoursKpiDetail:v=>{monthlyDetail=v},renderDesktopKpi:v=>calls.push(v),fetchTeacherPeriodEntries_:()=>new Promise(resolve=>pending.push(resolve)),parseTeacherDataEntries:v=>v,normalizeTeacherName:String,getCalculatedHours:r=>r.hours,paintDesktopPeriodKpis_:v=>calls.push(v)};
 vm.runInNewContext(extract('updateDesktopKpiCards'),c);c.updateDesktopKpiCards({total:0});assert.equal(monthlyDetail.total,0);
 pending.shift()([{teacher:'강사',dateKey:'2026-09-30',hours:2},{teacher:'강사',dateKey:'2026-10-01',hours:1,status:'보강'},{teacher:'다른 강사',dateKey:'2026-10-01',hours:9}]);await new Promise(r=>setImmediate(r));
 assert.equal(calls.at(-1).total,3);assert.equal(calls.at(-1).classCount,2);assert.equal(calls.at(-1).makeupCount,1);assert.match(note.innerHTML,/2026-09: 2.0H/);
 c.updateDesktopKpiCards({total:0});c.currentUser.uid='two';const length=calls.length;pending.shift()([{teacher:'강사',dateKey:'2026-10-01',hours:90}]);await new Promise(r=>setImmediate(r));assert.equal(calls.length,length);assert.equal(c.window.portalHoursPeriodProjection.pending,true);
});
test('failed period navigation restores the completed anchor and stale failures do not affect a new login',async()=>{
 let reject;const c={currentUser:{uid:'one'},viewTeacherName:'강사',portalPeriodScopeGeneration_:0,fetchTeacherPeriodEntries_:()=>new Promise((r,j)=>{reject=j}),parseTeacherDataEntries:v=>v,showLoading:()=>{},showToast:()=>{}};let failures=0;
 vm.runInNewContext(extract('ensureTeacherPeriodScope_'),c);
 let request=c.ensureTeacherPeriodScope_({},()=>{}, {onError:()=>failures++});reject(Error('offline'));await request;assert.equal(failures,1);
 request=c.ensureTeacherPeriodScope_({},()=>{}, {onError:()=>failures++});c.currentUser.uid='two';reject(Error('offline'));await request;assert.equal(failures,1);
 assert.match(extract('changeTotalClassAnalysisMonth'),/tcaYear=previousYear; tcaMonth=previousMonth/);assert.match(extract('changeHomeroomMonth'),/homeroomYear=previousYear; homeroomMonth=previousMonth/);
});
test('audit and analysis render every date in both months with distinct headings',()=>{
 const els={},el=id=>els[id]||(els[id]={innerHTML:'',value:'',style:{}});
 const c={PortalPeriod:P,document:{getElementById:el,querySelectorAll:()=>[]},classLogAuditYear:2026,classLogAuditMonth:9,classLogAuditSelectedKey:'2026-10-01',classLogAuditTeacherQuery:'',classLogAuditData:{dayMap:{}},toYmdKey:(y,m,d)=>P.key(y,m)+'-'+String(d).padStart(2,'0'),toDateKey:()=> '2026-10-01',getAuditDayStats:()=>({teachers:[]}),isClassLogDayUnentered:()=>true,renderClassLogAgreementTeacherChips:()=>'',renderClassLogAuditDetail:()=>{},renderClassLogAuditSummaryCards:()=>{},renderClassLogAuditRanking:()=>{},renderClassLogAuditBottomTable:()=>{},renderClassLogAuditTeacherSearch:()=>{},tcaYear:2026,tcaMonth:9,escapeHtml_:String};
 for(const name of ['renderClassLogAuditCalendar','renderTotalClassAnalysisDailyCalendar','makeTcaBucket','roundTcaHours','getTcaTopSubject'])vm.runInNewContext(extract(name),c);
 c.renderClassLogAuditCalendar();assert.equal((el('cla-grid').innerHTML.match(/data-date=/g)||[]).length,61);assert.match(el('cla-grid').innerHTML,/2026년 9월/);assert.match(el('cla-grid').innerHTML,/2026년 10월/);
 const html=c.renderTotalClassAnalysisDailyCalendar({byDate:{}});assert.equal((html.match(/class="tca-daily-day(?: today)?"/g)||[]).length,61);assert.equal((html.match(/portal-period-month-heading/g)||[]).length,2);
});

test('student detail summarizes both months while retaining monthly tuition and calendar, without polluting all-teacher cache',async()=>{
 const note={textContent:'',innerHTML:''},reads=[],pending=[];const c={PortalPeriod:P,document:{getElementById:()=>note},currentUser:{uid:'one'},scStudentName:'가상 학생',scYear:2026,scMonth:9,getCalculatedHours:r=>r.hours,fetchStudentCalendarScopedData:(y,m,name,opts,done)=>{reads.push([y,m,name]);pending.push(()=>done({success:true,rows:[{student:name,dateKey:P.key(y,m)+'-01',hours:2}]}))}};
 vm.runInNewContext(extract('refreshStudentPeriodSummary_'),c);const request=c.refreshStudentPeriodSummary_();assert.equal(reads.length,2);pending.forEach(done=>done());await request;assert.match(note.innerHTML,/2건 · 4.0H/);assert.match(note.innerHTML,/changeStudentMonth\(-1\)/);assert.match(note.innerHTML,/수강료 분석은 10월 상세/);assert(!extract('refreshStudentPeriodSummary_').includes('setTeacherScopeCache'));
});

test('homeroom timeout shows unavailable totals, late successful reads rerender, failed pairs settle promptly',()=>{
 let timeout,periodDone,periodFail,bootstrapDone;const states=[],els={},el=id=>els[id]||(els[id]={style:{},innerHTML:'',value:''});
 const c={currentYear:2026,currentMonth:9,currentUser:{name:'강사'},viewTeacherName:'강사',homeroomOpenRequestToken:0,homeroomPeriodRows_:[],document:{getElementById:el},showLoading:()=>{},showToast:()=>{},setTimeout:fn=>{timeout=fn;return 1},clearTimeout:()=>{},ensureHomeroomBootstrapData:done=>{bootstrapDone=done},ensureTeacherPeriodScope_:(req,done,opts)=>{periodDone=done;periodFail=opts.onError},renderHomeroomDashboard:()=>states.push(c.homeroomPeriodReadState_)};
 vm.runInNewContext(extract('openHomeroomModal'),c);c.openHomeroomModal();bootstrapDone({success:true});timeout();assert.equal(states.at(-1),'loading');periodDone([{dateKey:'2026-09-01'}]);assert.equal(states.at(-1),'ready');assert.equal(c.homeroomPeriodRows_.length,1);
 c.openHomeroomModal();bootstrapDone({success:true});periodFail();assert.equal(states.at(-1),'error');assert.equal(el('homeroom-modal').style.display,'flex');
 assert.match(extract('renderHomeroomDashboard'),/homeroomPeriodReadState_!=='ready'/);assert.match(extract('renderHomeroomDashboard'),/수업 집계/);
});

test('successful homeroom month navigation exits a prior error state',()=>{
 const c={homeroomYear:2026,homeroomMonth:9,homeroomPeriodReadState_:'error',currentUser:{name:'강사'},viewTeacherName:'강사',showLoading:()=>{},ensureTeacherPeriodScope_:(req,done)=>done([{dateKey:'2026-10-01'}]),renderHomeroomDashboard:()=>{}};
 vm.runInNewContext(extract('changeHomeroomMonth'),c);c.changeHomeroomMonth(1);assert.equal(c.homeroomPeriodReadState_,'ready');assert.equal(c.homeroomMonth,10);assert.equal(c.homeroomPeriodRows_.length,1);
});
