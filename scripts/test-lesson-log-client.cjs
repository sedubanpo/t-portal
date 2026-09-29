const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../lesson-log-editor.js'),'utf8');
const sandbox={
 window:{addEventListener(){}},document:{addEventListener(){}},
 location:{hostname:'localhost'},sessionStorage:{getItem(){return 'qa-branch';},setItem(){}},
 indexedDB:{open(){return {};}},
 setInterval(){},setTimeout(){},clearInterval(){},clearTimeout(){},
};
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.__qa={teacherGroups,trackingOwner,teacherControl,statusButtons,setContext:value=>{context=value},localMatches,matchStudent,studentOption,overviewStats,handle,list,chrome,setInitializing:value=>{initializing=value}};})();'),sandbox);
test('slow initialization blocks list, new draft, and tab actions without actor access',async()=>{
 const qa=sandbox.window.__qa;qa.setInitializing(true);
 for(const action of ['list','new','journal-tab','tracking-refresh'])await qa.handle(action,'overview');
 await qa.list();assert.match(qa.chrome('test','test'),/disabled aria-disabled="true"/);
 qa.setInitializing(false);
});
test('missing context retries initialization instead of dereferencing actor',async()=>{
 const original=sandbox.window.openPortalLessonLogs;let retries=0;
 sandbox.window.openPortalLessonLogs=async()=>{retries++;};
 try{await sandbox.window.__qa.handle('list');await sandbox.window.__qa.handle('new');await sandbox.window.__qa.list();assert.equal(retries,3);assert.match(sandbox.window.__qa.chrome('test','test'),/다시 불러오기/);}
 finally{sandbox.window.openPortalLessonLogs=original;}
});
const matches=sandbox.window.__qa.localMatches;
test('overview counts unique students per school and excludes unknown results from completion rate',()=>{
 const stats=sandbox.window.__qa.overviewStats([{studentId:'a',studentSchool:'가상고',status:'matched',minutes:60},{studentId:'a',studentSchool:'가상고',status:'missing',minutes:60},{studentId:'b',studentSchool:'가상중',status:'review',minutes:60}]);
 assert.equal(stats.students,2);assert.equal(stats.schools.length,2);assert.equal(stats.schools[0].count,1);assert.equal(stats.rate,50);assert.equal(stats.waiting,1);assert.equal(stats.minutes,180);
 assert.equal(sandbox.window.__qa.overviewStats([]).rate,null);
 assert.equal(sandbox.window.__qa.overviewStats([{status:'unknown'}]).rate,null);
});
test('student matching uses a unique exact identity, never a partial or ambiguous name',()=>{
 const {matchStudent,studentOption}=sandbox.window.__qa;
 const students=[{studentId:'a',name:'가상학생',school:'가상고',grade:'1'},{studentId:'b',name:'동명학생',school:'가상중',grade:'2'},{studentId:'c',name:'동명학생',school:'가상고',grade:'3'}];
 assert.equal(matchStudent(students,' 가상학생 ').studentId,'a');
 for(const query of ['','가상','동명학생','없는학생'])assert.equal(matchStudent(students,query),null);
 assert.equal(matchStudent(students,studentOption(students[2])).studentId,'c');
 assert.equal(matchStudent([...students,{...students[2],studentId:'d'}],studentOption(students[2])),null);
});
test('local recovery rows respect both admin owner and status filters',()=>{
 const row={uid:'admin',ownerUid:'admin',id:'draft',content:{title:'QA'},status:'draft',dirty:true};
 assert.equal(matches(row,'admin',{}),true);
 assert.equal(matches(row,'admin',{ownerUid:'other'}),false);
 assert.equal(matches(row,'admin',{status:'submitted'}),false);
 assert.equal(matches(row,'admin',{ownerUid:'admin',status:'draft'}),true);
 assert.equal(matches(row,'other',{}),false);
});
test('cached init records cannot appear as drafts; old own records stay discoverable',()=>{
 assert.equal(matches({uid:'admin',context:{}},'admin',{}),false);
 assert.equal(matches({uid:'admin',id:'legacy',content:{},status:'draft'},'admin',{ownerUid:'admin'}),true);
});

test('teacher chooser groups by real subject, searches, sorts, and deduplicates UIDs',()=>{
 const groups=sandbox.window.__qa.teacherGroups([{uid:'b',name:'나',subject:'수학'},{uid:'a',name:'가',subject:'수학'},{uid:'s',name:'다',subject:'물리'},{uid:'h',name:'라',subject:'한국사'},{uid:'u',name:'마',subject:''},{uid:'a',name:'가',subject:'수학'}]);
 assert.equal(groups.map(g=>g.group).join(','),'수학,과학,사회,기타');assert.equal(groups[0].teachers.map(t=>t.name).join(','),'가,나');
 assert.equal(sandbox.window.__qa.teacherGroups([{uid:'a',name:'가',subject:'수학'}],'수학')[0].teachers.length,1);
 assert.equal(sandbox.window.__qa.teacherGroups([{uid:'a',name:'가',subject:'수학'}],'없는이름').length,0);
});
test('teacher filters are administrator-only, and per-tab scope stays isolated',()=>{
 const qa=sandbox.window.__qa,owners={overview:'teacher-b',history:'',missing:''};
 for(const tab of ['overview','history','missing'])assert.equal(qa.trackingOwner({uid:'self',admin:false},tab,owners),'self');
 assert.equal(qa.trackingOwner({uid:'admin',admin:true},'overview',owners),'teacher-b');
 for(const tab of ['history','missing'])assert.equal(qa.trackingOwner({uid:'admin',admin:true},tab,owners),'');
 qa.setContext({actor:{uid:'self',admin:false},teachers:[]});assert.equal(qa.teacherControl('drafts'),'');
 qa.setContext({actor:{uid:'admin',admin:true},teachers:[]});assert.match(qa.teacherControl('drafts'),/aria-haspopup="dialog"/);qa.setContext(null);
 assert.equal((qa.statusButtons().match(/data-action="status-filter"/g)||[]).length,6);assert.match(qa.statusButtons(),/aria-pressed="true"/);
});
