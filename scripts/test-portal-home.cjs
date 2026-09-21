const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {projectNotices,projectLatestHours}=require('../portal-functions/home-data');
const src=fs.readFileSync(require('node:path').join(__dirname,'../portal-home.js'),'utf8');
const ctx={window:{},document:{getElementById:()=>null,addEventListener:()=>{}},module:{exports:{}}};
vm.runInNewContext(src,ctx);
const {effectiveHours,esc}=ctx.module.exports;
assert.equal(ctx.module.exports.clockText('17:00'),'오후 5:00');
assert.equal(ctx.module.exports.clockText('00:30'),'오전 12:30');
assert.match(ctx.module.exports.deltaMarkup(4.5,'H'),/trending_up.*\+4.5H/);
assert.match(ctx.module.exports.deltaMarkup(-2,'건'),/trending_down.*-2건/);
assert.match(ctx.module.exports.deltaMarkup(0,'H'),/trending_flat/);
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../portal-release-notes.js'),'utf8'),ctx);
assert.equal(ctx.window.PortalReleaseNotes[0].version,'v537');
assert(ctx.window.PortalReleaseNotes.some(p=>p.version==='v534'));
assert.equal(effectiveHours({status:'당일취소',hours:3}),0);
assert.equal(effectiveHours({status:'결석예고',hours:3}),0);
assert.equal(effectiveHours({status:'결석예고 · 실제 대체수업',hours:3}),3);
assert.equal(effectiveHours({status:'출석',hours:'2.5'}),2.5);
assert.equal(esc('<script>'), '&lt;script&gt;');
const {weeklyTotals,dayShift,hoursText}=ctx.module.exports;
assert.equal(hoursText(2),'2시간');assert.equal(hoursText(2.5),'2.5시간');
assert.equal(dayShift('2026-01-03',-13),'2025-12-21');
const weekly=weeklyTotals([
 {dateKey:'2025-12-21',hours:2},{dateKey:'2025-12-27',hours:3},
 {dateKey:'2025-12-28',hours:4},{dateKey:'2026-01-03',hours:2.5},
 {dateKey:'2026-01-03',hours:4,status:'당일취소'},
 {dateKey:'2026-01-04',hours:9},{dateKey:'2025-12-20',hours:9}
],'2026-01-03');
assert.equal(weekly.recent.count,2);assert.equal(weekly.recent.hours,6.5);
assert.equal(weekly.previous.count,2);assert.equal(weekly.previous.hours,5);
assert.equal(weekly.start,'2025-12-28');
assert(src.includes('request!==comparisonRequest'),'weekly response must respect newer requests');
assert(src.includes("window.portalSetView=mode=>"));
assert(!src.includes('지난달 전체 대비'));
assert.deepEqual(projectNotices({items:[{content:'비공개',active:false},{content:' '},null,{content:'공지',updatedAt:'2026-09-20',updatedByUid:'private'}]}),[{content:'공지',updatedAt:'2026-09-20'}]);
assert.deepEqual(projectNotices({content:'숨긴 옛 공지',active:false}),[]);
const date='2026-09-20';
const result=projectLatestHours({success:true,attendanceRows:[{class_date:date,student_name:'가상학생',hours:2,privateField:'private'},{class_date:'2026-09-19',student_name:'이전 수업'}],signatureRows:[{class_date:date,signed:true}]},date);
assert.equal(result.rows.length,1);assert.equal(result.signed,true);assert(!('privateField' in result.rows[0]));
assert.throws(()=>projectLatestHours({success:false},date));
assert(src.includes('summary.after(sign)'));assert(src.includes('sign.after(lower)'));
assert(src.includes("i<2?openHoursModal()"));
assert(!src.includes('submitDailyClassLogs('),'home CTA must only open review, never submit');
assert(src.includes('id!==latestRequest||scope()!==key'),'late response must not cross teacher scope');
console.log('PASS home projection, notices visibility, actual hours, escaping, review-first signing, stale teacher guard');
