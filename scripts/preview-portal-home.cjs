// Full incumbent DOM + synthetic data. No production auth or API calls.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const root=path.join(__dirname,'..');
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(['/favicon.svg','/portal-home.js','/portal-home.css','/hours-history.css','/class-checkout.css','/enrollment-grades.css'].includes(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.js')?'text/javascript':'text/css');return res.end(fs.readFileSync(path.join(root,url.pathname)));}
 const admin=url.searchParams.has('admin');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 const setup=`<style>#login-section{display:none!important}#dashboard-section{display:flex!important}.portal-version-badge{display:none}#admin-panel{display:${admin?'block':'none'}}</style><script>
 let currentUser={uid:'fixture',name:'예시 강사',staffReadOnly:false},viewTeacherName='예시 강사',isAdminMode=${admin},currentYear=2026,currentMonth=8,monthlyData=[{status:'보강'}];
 function getTeacherPortalFirebaseIdToken_(){return Promise.resolve('fixture')}function normalizeTeacherName(v){return v}function renderPortalStudentName_(v){return '<span class="material-icons-round">person_outline</span>'+v}
 function getTeacherScopeCacheForRequest(){return null}function fetchTeacherMonthlyEntriesDirect_(){return Promise.resolve(Array.from({length:31},()=>({hours:72/31})))}function parseTeacherDataEntries(v){return v}function getCalculatedHours(v){return v.hours}
 function openHoursModal(){document.getElementById('hours-modal').style.display='flex'}function closeHoursModal(){document.getElementById('hours-modal').style.display='none'}function changeMonth(n){currentMonth+=n;renderPortalHome()}function toggleHoursHistory(){}function selectDate(){}function loadHoursDashboardData(o){o.onDone?.()}
 window.fetch=async(u,o)=>({ok:true,json:async()=>JSON.parse(o.body).mode==='lmsNotices'?{success:true,rows:[{content:'합성 공지: 담당 학생 상담 내용을 LMS에 입력해 주세요.',updatedAt:'2026-09-21'}]}:{success:true,date:'2026-09-20',signed:false,rows:['가상학생 가','가상학생 나','가상학생 다'].map((student,i)=>({student,start:'17:00',end:'19:00',hours:2,className:'과학 개별',status:'출석'}))}});
 document.body.classList.add('dashboard-active'${admin?',"admin-mode"':''});document.getElementById('user-name-disp').textContent='예시 강사';document.getElementById('user-subject-disp').textContent='과학';document.getElementById('mobile-greeting-card').classList.add('bg-pm1');document.getElementById('mobile-gc-title-text').textContent='좋은 하루예요!';document.getElementById('mobile-gc-sub-text').textContent='오늘도 학생들의 성장을 위해 애써주셔서 감사합니다.';document.getElementById('kpi-class-count').textContent='33건';document.getElementById('kpi-hours').textContent='76.5H';document.getElementById('kpi-missing-log').textContent='2건';
 document.getElementById('desktop-event-grid').innerHTML=Array.from({length:35},(_,i)=>'<div class="desktop-event-day">'+(i%30+1)+'</div>').join('');
 </script><script src="/portal-home.js"></script><script>renderPortalHome({classCount:33,hours:76.5})</script>`;
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html.replace('</body>',setup+'</body>'));
}).listen(4179,'127.0.0.1',()=>console.log('Synthetic home preview http://127.0.0.1:4179'));
