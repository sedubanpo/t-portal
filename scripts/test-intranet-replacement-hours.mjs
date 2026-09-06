import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('  function getCalculatedHours(');const end=source.indexOf('  function getNameColorStyle(',start);assert.ok(start>0&&end>start);
const ctx={calculateDuration:()=>2};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
assert.equal(ctx.getCalculatedHours({status:'결석예고',hours:2}),0);
assert.equal(ctx.getCalculatedHours({status:'당일취소',hours:2}),0);
assert.equal(ctx.getCalculatedHours({status:'결석예고 · 실제 대체수업',hours:2}),2);


assert.equal(ctx.getCalculatedHours({status:'보충',hours:0.5}),0.5);
assert.equal(ctx.getCalculatedHours({status:'프리',hours:0.25}),0.25);
console.log('Intranet absence/replacement hours: 5 checks passed');
