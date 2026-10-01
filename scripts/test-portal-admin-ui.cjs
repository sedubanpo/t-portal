const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ui=require('../portal-admin-ui');
test('multiple schools form a union while another filter still narrows the result',()=>{
 const rows=[{student:'가',school:'학교A',subjects:{수학:1}},{student:'나',school:'학교B',subjects:{수학:1}},{student:'다',school:'학교B',subjects:{국어:1}},{student:'라',school:'학교C',subjects:{수학:1}}];
 assert.deepEqual(rows.filter(r=>ui.matchesSchool(r,['학교A','학교B'])&&r.subjects.수학).map(r=>r.student),['가','나']);
 assert.equal(rows.filter(r=>ui.matchesSchool(r,[])).length,4);
});
test('school search groups the current month and preserves a selected school with no rows',()=>{
 const rows=[{school:'세화고',level:'고등'},{school:'세화고',level:'고등'},{school:'세화여중',level:'중등'},{school:'-',level:'기타'}];
 assert.deepEqual(ui.schoolGroups(rows,[],'세 화').map(g=>[g.label,g.options[0].count]),[['중등',1],['고등',2]]);
 assert.deepEqual(ui.schoolGroups(rows,['이전학교'],'이전'),[{label:'선택 월에 없음',options:[{name:'이전학교',count:0}]}]);
});
test('missing metadata and named sorts use actual row values',()=>{
 const rows=[{student:'나',school:'-',grade:'확인필요',totalCount:4,latestDay:1},{student:'가',school:'학교',grade:'2',totalCount:8,latestDay:2}];
 assert.equal(ui.matchesMeta(rows[0],'school'),true);assert.equal(ui.matchesMeta(rows[1],'grade'),false);
 assert.deepEqual(ui.sortRows(rows,'name').map(r=>r.student),['가','나']);assert.equal(ui.sortRows(rows,'recent')[0].latestDay,2);
});
test('teacher portraits are safe, grouped, searchable, and always have an icon fallback',()=>{
 const teachers=[{name:'안준성',subject:'반포관 원장',profileImage:'https://example.com/director.png'},{name:'검토강사',subject:'수학',profileImage:'javascript:alert(1)'},{name:"' <script>",subject:'수학'}];
 const label=s=>s==='수학'?'수학':'기타';
 const result=ui.teacherMarkup(teachers,'안준성','안 준성','All',label);assert.equal(result.count,1);assert.match(result.html,/director.png/);assert.match(result.html,/aria-pressed="true"/);
 const math=ui.teacherMarkup(teachers,'','수학','수학',label);assert.equal(math.count,2);assert(!math.html.includes('javascript:'));assert(!math.html.includes('<script>'));assert(math.html.includes('person'));
 assert.equal(ui.safePhoto('https://github.com/org/repo/blob/main/a.png?raw=true'),'https://raw.githubusercontent.com/org/repo/main/a.png');
});
test('inline scripts parse and the enrollment filters keep month selections',()=>{
 const source=fs.readFileSync(require.resolve('../index.html'),'utf8');
 for(const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
 const start=source.indexOf('  function populateFilter('),end=source.indexOf('\n  function ',start+1),fn=source.slice(start,end);
 const options=[{value:'All',outerHTML:'all'},{value:'학교A',selected:true}],select={options,selectedOptions:[options[1]],set innerHTML(v){this.options=[{value:'All'}];},appendChild(o){this.options.push(o);},add(o){this.options.push(o);}};
 const c=vm.createContext({document:{getElementById:()=>select,createElement:()=>({})},Option:function(text,value){this.text=text;this.value=value;}});vm.runInContext(fn+'\npopulateFilter("filter-school", ["학교B"]);',c);
 assert.equal(select.options.find(o=>o.value==='학교A').selected,true);assert.equal(select.options.find(o=>o.value==='All').selected,false);
});
