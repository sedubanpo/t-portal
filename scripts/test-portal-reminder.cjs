const test=require('node:test'),assert=require('node:assert/strict');
const {summarize,monthRange,shift,eligible,snoozed}=require('../portal-reminder');
const row=(date,status='matched')=>({classDate:date,status,minutes:60});
test('calendar separates agreement from journal completion and retains partial totals',()=>{
 const d=summarize([row('2026-10-01'),row('2026-10-01','missing'),row('2026-10-02')],{'2026-10-01':true,'2026-10-02':false},'2026-10','2026-10-11');
 assert.equal(d['2026-10-01'].hours,'done');assert.equal(d['2026-10-01'].journal,'pending');assert.equal(d['2026-10-01'].matched,1);assert.equal(d['2026-10-01'].count,2);assert.equal(d['2026-10-02'].hours,'pending');assert.equal(d['2026-10-02'].journal,'done');
});
test('unavailable signatures and stale/ambiguous journals are unknown, not missing',()=>{
 for(const status of ['unknown','review']){const d=summarize([row('2026-10-01',status)],null,'2026-10','2026-10-11')['2026-10-01'];assert.equal(d.hours,'unknown');assert.equal(d.journal,'unknown');assert.equal(d.missing,0);}
});
test('only elapsed lesson dates in selected month with positive minutes are included',()=>{
 const d=summarize([row('2026-09-30'),row('2026-10-12'),row('2026-10-11'),{...row('2026-10-10'),minutes:0}],{},'2026-10','2026-10-11');assert.deepEqual(Object.keys(d),['2026-10-11']);
});
test('cross-year and leap-month calendar range',()=>{assert.equal(shift('2026-01',-1),'2025-12');assert.equal(shift('2025-12',1),'2026-01');assert.deepEqual(monthRange('2028-02'),{start:'2028-02-01',end:'2028-02-29'});});
test('only teacher sessions auto-open; exact 24-hour expiration',()=>{for(const u of [null,{}, {uid:'a',isAdmin:true},{uid:'a',staffReadOnly:true}])assert.equal(eligible(u),false);assert.equal(eligible({uid:'t',isAdmin:false}),true);assert.equal(snoozed(1000+86400000,1000),true);assert.equal(snoozed(1000,1000),false);assert.equal(snoozed('bad',1000),false);});
