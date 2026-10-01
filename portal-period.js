(function(root){
 'use strict';
 const key=(y,m)=>`${y}-${String(m+1).padStart(2,'0')}`;
 function months(year,month0){
   if(!Number.isInteger(year)||!Number.isInteger(month0)||month0<0||month0>11)throw Error('조회 월이 올바르지 않습니다.');
   const previous=new Date(Date.UTC(year,month0-1,1));
   return [{year:previous.getUTCFullYear(),month0:previous.getUTCMonth(),monthKey:key(previous.getUTCFullYear(),previous.getUTCMonth())},{year,month0,monthKey:key(year,month0)}];
 }
 function fromKey(value){const match=/^(\d{4})-(\d{2})$/.exec(String(value));if(!match)throw Error('조회 월이 올바르지 않습니다.');return months(Number(match[1]),Number(match[2])-1);}
 function label(year,month0){const [a,b]=months(year,month0);return a.year===b.year?`${b.year}년 ${a.month0+1}–${b.month0+1}월`:`${a.year}년 ${a.month0+1}월–${b.year}년 ${b.month0+1}월`;}
 function range(endMonth){const [a,b]=fromKey(endMonth),next=new Date(Date.UTC(b.year,b.month0+1,0));return {start:a.monthKey+'-01',end:next.toISOString().slice(0,10)};}
 function rowDate(row){if(/^\d{4}-\d{2}-\d{2}$/.test(String(row?.dateKey||'')))return row.dateKey;if(Number.isInteger(row?.year)&&Number.isInteger(row?.month)&&Number(row.day)>0)return key(row.year,row.month)+'-'+String(row.day).padStart(2,'0');return '';}
 function contains(row,year,month0){return months(year,month0).some(m=>rowDate(row).slice(0,7)===m.monthKey);}
 function gapDays(row,endMonth,now=new Date(Date.now()+9*3600000)){
   const end=range(endMonth).end,today=now.toISOString().slice(0,10),reference=today<end?today:end;
   const latest=String(row?.latestDateKey||row?.latestRow?.dateKey||'');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(latest))return null;
   return Math.max(0,Math.floor((Date.parse(reference+'T00:00:00Z')-Date.parse(latest+'T00:00:00Z'))/86400000));
 }
 function mergeOverviews(entries){
   if(!entries.every(e=>e&&e.success&&e.dayMap))throw Error('두 달의 조회 결과를 모두 확인하지 못했습니다. 다시 조회해 주세요.');
   return Object.assign({},entries.at(-1),{dayMap:Object.assign({},...entries.map(e=>e.dayMap)),periodMonths:entries.map(e=>e.monthKey||'')});
 }
 function mergeStudents(entries){
   const map=new Map(),counters=['totalCount','rawCount','attendedCount','absentCount','makeupCount','cancelCount'];
   const addMap=(target,source)=>Object.entries(source||{}).forEach(([k,v])=>{target[k]=(target[k]||0)+Number(v||0)});
   for(const {rows,monthKey} of entries)for(const row of rows||[]){
     const identity=row.canonicalStudentId?`id:${row.canonicalStudentId}`:String(row.key||'').startsWith('id:')?row.key:['composite',row.student,row.school,row.grade].join('|');
     if(!map.has(identity))map.set(identity,{...row,key:identity,teachers:{},subjects:{},lessonTypes:{},lessonTypeCounts:{},lessonTypeDetails:{},lessonClassDetails:{},rows:[],latestRow:null,latestDay:0,latestDateKey:'',periodCounts:{},...Object.fromEntries(counters.map(k=>[k,0]))});
     const target=map.get(identity);counters.forEach(k=>target[k]+=Number(row[k]||0));
     ['teachers','subjects','lessonTypeCounts'].forEach(k=>addMap(target[k],row[k]));Object.assign(target.lessonTypes,row.lessonTypes);
     for(const name of ['lessonTypeDetails','lessonClassDetails'])for(const [k,detail] of Object.entries(row[name]||{})){
       if(!target[name][k])target[name][k]={...detail,teachers:{},subjects:{},count:0,hours:0,attendedCount:0,attendanceBase:0};
       const item=target[name][k];['count','hours','attendedCount','attendanceBase'].forEach(f=>item[f]+=Number(detail[f]||0));addMap(item.teachers,detail.teachers);addMap(item.subjects,detail.subjects);
     }
     target.rows.push(...(row.rows||[]));target.periodCounts[monthKey]=Number(row.totalCount||0);
     const latest=String(row.latestRow?.dateKey||row.latestDateKey||'');
     if(latest>target.latestDateKey){target.student=row.student;target.school=row.school;target.grade=row.grade;target.level=row.level;target.latestDateKey=latest;target.latestRow=row.latestRow||null;target.latestDay=Number(latest.slice(-2));}
   }
   return [...map.values()];
 }
 async function loadMonths(targets,read){
   const results=await Promise.allSettled(targets.map(t=>read(t)));
   return results.map((r,i)=>({monthKey:targets[i].monthKey,rows:r.status==='fulfilled'?r.value:[],loaded:r.status==='fulfilled',error:r.status==='rejected'?String(r.reason?.message||r.reason):''}));
 }
 const api={key,months,fromKey,label,range,rowDate,contains,gapDays,mergeOverviews,mergeStudents,loadMonths};
 root.PortalPeriod=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
