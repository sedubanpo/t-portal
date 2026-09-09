const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:['/Users/anjongseong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules']}));
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage(); const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 await page.route('https://icons.test/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="#4569af"/></svg>'}));
 await page.setContent(source.match(/<style>[\s\S]*?<\/style>/)[0]+'<main id="fixture" style="padding:20px;background:white"></main>');
 await page.evaluate(()=>{
  window.listeners=[];window.stopCount=0; window.firebase={firestore:{FieldPath:{documentId:()=> '__name__'}}};
  window.initializeTeacherPortalFirebaseAuth_=()=>Promise.resolve({auth:{onAuthStateChanged:cb=>{window.authChange=cb;cb({uid:'test'});}},firestore:{collection:name=>({where:(field,op,values)=>({onSnapshot:cb=>{const l={name,field,values,cb};listeners.push(l);return ()=>{stopCount++;};}})})}});
 });
 await page.addScriptTag({path:path.join(__dirname,'../student-gender-icons.js')});
 await page.evaluate(()=>{
  fixture.innerHTML=[11,15,22].map(size=>'<p style="font-size:'+size+'px">'+PortalStudentGender.render('학생A')+' · '+PortalStudentGender.render('학생B')+' · '+PortalStudentGender.render('미선택')+'</p>').join('')+'<p id="teacher">학생A 강사</p>';
 });
 await page.waitForFunction(()=>listeners.length===3);
 await page.evaluate(()=>{
  const doc=(id,d)=>({id,data:()=>d});
  listeners.find(l=>l.name==='sharedIconAssets').cb({docs:[doc('male',{lookupKey:'student-gender:male',imageUrl:'https://icons.test/one.svg',updatedAtMs:1}),doc('female',{lookupKey:'student-gender:female',imageUrl:'https://icons.test/two.svg',updatedAtMs:1})]});
  listeners.filter(l=>l.name==='students').forEach(l=>l.cb({docs:[doc('a',{studentName:'학생A',gender:'male'}),doc('b',{studentName:'학생B',gender:'female'}),doc('c',{studentName:'미선택',gender:''})]}));
 });
 await page.waitForFunction(()=>document.querySelectorAll('.portal-student-gender-icon').length===6);
 assert.equal(await page.locator('#teacher img').count(),0);
 assert.equal(await page.locator('[data-gender-name="미선택"] img').count(),0);
 for(const width of [390,1280]){await page.setViewportSize({width,height:844});const dims=await page.locator('.portal-student-gender-icon').evaluateAll(imgs=>imgs.map(i=>({width:i.getBoundingClientRect().width,font:parseFloat(getComputedStyle(i.parentElement).fontSize)})));dims.forEach(d=>assert.equal(d.width,d.font));}
 await page.evaluate(()=>listeners.find(l=>l.name==='sharedIconAssets').cb({docs:[{id:'new',data:()=>({lookupKey:'student-gender:male',imageUrl:'https://icons.test/latest.svg',updatedAtMs:2})}]}));
 await page.waitForFunction(()=>document.querySelectorAll('img[src="https://icons.test/latest.svg"]').length===3);
 assert.equal(await page.locator('.portal-student-gender-icon').count(),3);
 await page.evaluate(()=>listeners.filter(l=>l.name==='students').forEach(l=>l.cb({docs:[{id:'a',data:()=>({studentName:'학생A',gender:''})}]})));
 await page.waitForFunction(()=>!document.querySelector('.portal-student-gender-icon'));
 await page.evaluate(()=>authChange(null));
 assert.equal(await page.evaluate(()=>stopCount),3);
 console.log('PASS live updates, unset removes icons, no teacher decoration, 1em at 390/1280, deduplicated listeners, logout cleanup');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
