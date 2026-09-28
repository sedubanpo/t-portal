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
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.__qa={localMatches,matchStudent,studentOption,overviewStats};})();'),sandbox);
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
