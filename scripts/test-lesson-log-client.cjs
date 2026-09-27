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
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.__qa={localMatches};})();'),sandbox);
const matches=sandbox.window.__qa.localMatches;
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
