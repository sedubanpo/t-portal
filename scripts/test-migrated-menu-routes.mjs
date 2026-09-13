import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const c=vm.createContext({window:{},currentUser:{uid:'existing',isAdmin:true},isAdminMode:true,console,API_PERFORMANCE_LOG_LIMIT:80,
 gasJsonpRequestWithRetry:()=>{throw new Error('GAS must not run');},gasPostMessageRequestWithRetry:()=>{throw new Error('GAS write must not run');}});
vm.runInContext(fs.readFileSync(new URL('../portal-runtime-config.js',import.meta.url),'utf8'),c);
vm.runInContext(source.match(/\/\/ PORTAL_API_ROUTER_START[\s\S]*?\/\/ PORTAL_API_ROUTER_END/)[0],c);
const api=c.window.portalApi;
let calls=0;
api.registerBackend('supabase',async()=>{calls++;return {success:true};});
for(const action of c.window.__TPORTAL_SUPABASE_PUBLIC_CONFIG__.authoritativeReadActions){
 assert.equal(api.getRoute(action),'supabase','direct before canary initialization');
 api.setRoute(action,'canary');
 await api.call(action,{year:2026,month:9,forceRefresh:true});
 api.clearRoute(action);
 assert.equal(api.getRoute(action),'supabase','bootstrap clearing routes cannot undo migration');
}
assert.equal(calls,c.window.__TPORTAL_SUPABASE_PUBLIC_CONFIG__.authoritativeReadActions.length);
api.registerBackend('supabase',async()=>{throw new Error('direct outage');});
await assert.rejects(api.call('getClassCheckoutDashboardData',{year:2026,month:9}),/direct outage/);
await assert.rejects(api.call('getTeacherHoursDashboardData',{year:2026,month:9}),/direct outage/);
const extract=name=>{const a=source.indexOf('  function '+name+'(');assert(a>=0);return source.slice(a,source.indexOf('\n  function ',a+1));};
for(const name of ['fetchTeacherScopeToCache','ensureTeacherDataScope','loadHoursDashboardData']){
 assert.doesNotMatch(extract(name),/google.script.run|fetchAllDataForSmartFill|requestHoursScope/);
}
assert.doesNotMatch(extract('getPortalClassLogOverviewFromSupabase_'),/select=id,source,status,metadata,/,'do not download historical snapshot blobs');
assert.doesNotMatch(extract('getPortalClassLogOverviewFromSupabase_'),/SUPABASE_CLASS_LOG_LEGACY_REQUIRED/);
vm.runInContext(fs.readFileSync(new URL('../class-log-overview-direct.js',import.meta.url),'utf8'),c);
const attendance=[{class_date:'2026-09-11',sourceSystem:'intranet',teacher_name:'test',student_name:'test',status:'출석',hours:2,category:'수학',import_batch_id:'intranet-part'}];
const batches=[{id:'old-access',source:'access-daily',status:'completed',row_count:50,imported_at:'2026-09-11',metadata:{sourceDates:['2026-09-11']}}];
const result=c.window.PortalClassLogOverviewEngine.build(attendance,[],[],2026,9,{batches,compact:true});
assert.equal(result.directFallbackRequired,false,'intranet replacement is not an incomplete Access upload');
assert.equal(result.dayMap['2026-09-11'].teachers[0].taughtCount,1);
console.log('PASS production routing, forced refresh, outage no GAS fallback, common monthly reads, intranet and no logs');
