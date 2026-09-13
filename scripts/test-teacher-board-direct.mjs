import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(source,/onclick="loadTeacherClassStatusMonthDirect_\(true\)"/,'refresh must bypass cached month');
const extract = name => {
  const start = source.indexOf('  function ' + name + '(');
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n  function ', start + 1));
};
let requests = [], applied = [], loading = [], alerts = [], resolveRead;
const c = vm.createContext({
  isAdminMode:true, tcsYear:2026, tcsMonth:11,
  getPortalSupabaseRuntimeConfig_:()=>({url:'test'}),
  getValidatedPortalSupabaseToken_:async()=>({token:'session'}),
  reuseSupabaseAccessRead_:(_c,_t,_k,_f,read)=>read(),
  requestPortalSupabasePagedRows_:async(_c,path)=>{requests.push(path);return [{class_date:'2026-12-01',sourceSystem:'intranet',intranetStudentId:'canonical',student_id:'other',student_name:'test',hours:2}];},
  setTimeout:()=>1, clearTimeout:()=>{},
  showLoading:state=>loading.push(state),
  applyTeacherDataEntries:entries=>applied.push(entries),
  getTeacherDataScopeKey:r=>`${r.year}-${r.month0}`,
  showAdminManagementModal:()=>{},setupTeacherClassStatusFilters:()=>{},renderTeacherClassStatusCalendar:()=>{},
  alert:message=>alerts.push(message)
});
vm.runInContext(['normalizeStudentStatsAttendanceRow_','fetchTeacherClassStatusMonthDirect_','fetchTeacherMonthlyEntriesDirect_','loadTeacherClassStatusMonthDirect_'].map(extract).join('\n'),c);
const rows=await c.fetchTeacherClassStatusMonthDirect_(2026,11,false);
assert.equal(rows[0].studentId,'canonical');
assert.match(requests[0],/class_date=gte.2026-12-01&class_date=lt.2027-01-01/);
assert.match(requests[0],/order=class_date.asc,id.asc/);
assert(!requests[0].includes(',raw_row,'));
await assert.rejects(c.fetchTeacherClassStatusMonthDirect_(2026,12,false));
c.isAdminMode=false;
await assert.rejects(c.fetchTeacherClassStatusMonthDirect_(2026,11,false));
c.isAdminMode=true;
await c.loadTeacherClassStatusMonthDirect_(false);
assert.equal(applied.length,1);
assert.equal(loading.at(-1),false);
// A later month wins even when the earlier response arrives last.
c.fetchTeacherClassStatusMonthDirect_=()=>new Promise(resolve=>{resolveRead=resolve;});
const old=c.loadTeacherClassStatusMonthDirect_(false), finishOld=resolveRead;
c.tcsMonth=10;
const recent=c.loadTeacherClassStatusMonthDirect_(false);
resolveRead([]);await recent;
finishOld(rows);await old;
assert.equal(applied.length,2);
assert.equal(applied[1].length,0,'empty month is successful');
c.fetchTeacherClassStatusMonthDirect_=async()=>{throw new Error('offline');};
c.tcsMonth=9;
await c.loadTeacherClassStatusMonthDirect_(false);
assert.equal(c.tcsMonth,10,'failed month restores previous selection');
assert.equal(applied.length,2,'failure must not replace rows with empty results');
assert.equal(alerts.length,1);
assert.equal(loading.at(-1),false);
let expire;
c.setTimeout=callback=>{expire=callback;return 2;};
c.fetchTeacherClassStatusMonthDirect_=()=>new Promise(resolve=>{resolveRead=resolve;});
const timedOut=c.loadTeacherClassStatusMonthDirect_(false);
expire();await timedOut;
resolveRead(rows);await Promise.resolve();
assert.equal(applied.length,2,'late response after deadline must not apply');
assert.equal(alerts.length,2);
assert.equal(loading.at(-1),false,'deadline releases loading overlay');
for(const name of ['openTeacherClassStatusModal','changeTeacherClassStatusMonth','loadTeacherClassStatusMonthDirect_']){
  assert.doesNotMatch(extract(name),/ensureTeacherDataScope|google.script.run|fetchAllDataForSmartFill/);
}
for(const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
console.log('PASS teacher board direct: scope, identity, empty month, authorization, races, failure recovery, inline syntax');
