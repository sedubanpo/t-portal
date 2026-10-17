const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function fn(name){const start=source.indexOf('  function '+name+'(');assert(start>=0);return source.slice(start,source.indexOf('\n  function ',start+4));}
const modal={style:{display:'flex'}},search={value:'old'},pending=[],painted=[];
const c={weekTimetableLoadToken:0,weekTimetableData:['old'],timetableSelectedStudent:'old',teacher:'A',studentMetaReady:true,studentMetaMap:new Map([['x',{}]]),performance:{now:()=>0},document:{body:{dataset:{}},getElementById:id=>id==='timetable-modal'?modal:id==='tt-search'?search:{}},getWeekTimetableMonthRequests:()=>[{teacherName:c.teacher}],getWeekTimetableCachedRows:()=>null,mergeWeekTimetableRows:groups=>groups.flat(),fetchWeekTimetableMonthDirect:req=>new Promise(resolve=>pending.push({teacher:req.teacherName,resolve})),renderWeekTimetable:()=>painted.push(c.weekTimetableData.slice()),renderWeekTimetableLoading:()=>{},showToast:()=>{},console};
vm.createContext(c);['refreshWeekTimetableTeacher','loadWeekTimetableData'].forEach(n=>vm.runInContext(fn(n),c));
(async()=>{
 c.refreshWeekTimetableTeacher();assert.equal(pending[0].teacher,'A');assert.equal(search.value,'');assert.equal(c.timetableSelectedStudent,'');assert.equal(c.weekTimetableData.length,0);
 c.teacher='B';c.refreshWeekTimetableTeacher();pending[1].resolve(['B']);await new Promise(setImmediate);assert.equal(c.weekTimetableData[0],'B');
 pending[0].resolve(['A']);await new Promise(setImmediate);assert.equal(c.weekTimetableData[0],'B');assert.equal(painted.length,1,'late A response must not paint');
 modal.style.display='none';c.refreshWeekTimetableTeacher();assert.equal(pending.length,2,'closed view must not fetch');assert.equal(c.weekTimetableData.length,0);
 assert.match(fn('changeTeacherView'),/viewTeacherName = selectedName;\s*refreshWeekTimetableTeacher\(\)/);
 console.log('PASS: teacher selection refresh, cleared filters, stale-response rejection, no hidden-view fetch');
})().catch(e=>{console.error(e);process.exitCode=1;});
