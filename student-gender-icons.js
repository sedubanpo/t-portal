/* Shared Firestore student gender decoration. No inference from names; no writes. */
(function(root) {
  'use strict';
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();
  const url = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; } };
  const stamp = data => { const t=data.updatedAt || data.createdAt; return t && typeof t.toMillis==='function' ? t.toMillis() : t && typeof t.seconds==='number' ? t.seconds*1000+(t.nanoseconds||0)/1e6 : Number(data.updatedAtMs||data.createdAtMs)||Date.parse(t)||0; };
  function assets(docs) {
    const latest = new Map();
    docs.forEach(doc => { const d=doc.data(), k=d.lookupKey; if (!/^student-gender:(male|female)$/.test(k)) return;
      const prev=latest.get(k); if (!prev || stamp(d)>stamp(prev.data) || (stamp(d)===stamp(prev.data)&&doc.id>prev.id)) latest.set(k,{id:doc.id,data:d});
    });
    return new Map([...latest].map(([k,v])=>[k, String(v.data.status||'ACTIVE').toUpperCase()==='ACTIVE' ? url(v.data.imageUrl) : '']));
  }
  function index(docs) {
    const ids=new Map(), names=new Map();
    docs.forEach(doc=>{const d=doc.data();
      for(const id of new Set([doc.id,d.studentId,d.canonicalStudentId].filter(Boolean))){if(!ids.has(id))ids.set(id,[]);ids.get(id).push(doc);}
      for(const n of new Set([d.studentName,d.name].map(key).filter(Boolean))){if(!names.has(n))names.set(n,[]);names.get(n).push(doc);}
    }); return {ids,names};
  }
  function resolve(record, docs) {
    const lookup=Array.isArray(docs)?index(docs):docs;
    const id=String(record.id||''), name=key(record.name);
    let found=lookup.ids.get(id)||[];
    if (!found.length) {
      found=lookup.names.get(name)||[];
      if (found.length>1 && record.school) found=found.filter(d=>key(d.data().school||d.data().studentSchool)===key(record.school));
      if (found.length>1 && record.grade) found=found.filter(d=>key(d.data().grade||d.data().studentGrade)===key(record.grade));
    }
    if (found.length!==1) return ''; // Never guess between same-name students.
    const g=found[0].data().gender; return g==='male'||g==='female' ? g : '';
  }
  function render(name, record, display) {
    record=record||{};
    return '<span class="portal-student-name" data-gender-name="'+escape(name)+'" data-gender-id="'+escape(record.canonicalStudentId||record.firebaseStudentId||record.studentId||record.student_id||'')+'" data-gender-school="'+escape(record.school||record.studentSchool||record.student_school||'')+'" data-gender-grade="'+escape(record.grade||record.studentGrade||record.student_grade||'')+'">'+escape(display==null?name:display)+'</span>';
  }
  const api={render,resolve,assets,index}; root.PortalStudentGender=api;
  if (!root.document) return;
  let db=null, generation=0, assetMap=new Map(), snapshots=new Map(), subscribed=new Set(), stops=[], frame=0;
  function nodes() { return [...document.querySelectorAll('.portal-student-name[data-gender-name]')]; }
  function repaint() {
    frame=0; const docs=new Map(); snapshots.forEach(s=>s.forEach(d=>docs.set(d.id,d))); const records=index([...docs.values()]);
    nodes().forEach(el=>{
      const gender=resolve({id:el.dataset.genderId,name:el.dataset.genderName,school:el.dataset.genderSchool,grade:el.dataset.genderGrade},records);
      const src=assetMap.get('student-gender:'+gender)||''; let img=el.querySelector('.portal-student-gender-icon');
      if (!src) { if(img) img.remove(); return; }
      if (img && img.getAttribute('src')===src) return;
      if (!img) { img=document.createElement('img'); img.className='portal-student-gender-icon'; img.decoding='async'; img.addEventListener('error',()=>{img.hidden=true;}); el.prepend(img); }
      img.hidden=false; img.alt=gender==='male'?'남학생':'여학생'; img.src=src;
    });
    if (!db) return;
    const names=[...new Set(nodes().map(el=>el.dataset.genderName).filter(n=>n&&n!=='-'))].filter(n=>!subscribed.has(n));
    const epoch=generation;
    for(let i=0;i<names.length;i+=10){const batch=names.slice(i,i+10);batch.forEach(n=>subscribed.add(n));
      for(const field of ['studentName','name']) {
        const label=field+':'+JSON.stringify(batch);
        stops.push(db.collection('students').where(field,'in',batch).onSnapshot(s=>{if(epoch!==generation)return;snapshots.set(label,s.docs);schedule();},()=>{if(epoch!==generation)return;snapshots.delete(label);schedule();}));
      }
    }
    const ids=[...new Set(nodes().map(el=>el.dataset.genderId).filter(id=>id&&!id.includes('/')))].filter(id=>!subscribed.has('id:'+id));
    for(let i=0;i<ids.length;i+=10){const batch=ids.slice(i,i+10);batch.forEach(id=>subscribed.add('id:'+id));const label='ids:'+JSON.stringify(batch);
      stops.push(db.collection('students').where(root.firebase.firestore.FieldPath.documentId(),'in',batch).onSnapshot(s=>{if(epoch!==generation)return;snapshots.set(label,s.docs);schedule();},()=>{if(epoch!==generation)return;snapshots.delete(label);schedule();}));
    }
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(repaint);}
  function connect(state) {
    state.auth.onAuthStateChanged(user=>{
      generation++; stops.forEach(stop=>stop()); stops=[]; subscribed.clear(); snapshots.clear(); assetMap.clear(); db=user?state.firestore:null; schedule();
      if (!db) return; const epoch=generation;
      stops.push(db.collection('sharedIconAssets').where('lookupKey','in',['student-gender:male','student-gender:female']).onSnapshot(s=>{if(epoch!==generation)return;assetMap=assets(s.docs);schedule();},()=>{if(epoch!==generation)return;assetMap.clear();schedule();}));
    });
  }
  function start(){
    new MutationObserver(changes=>{if(changes.some(c=>[...c.addedNodes].some(n=>n.nodeType===1&&(n.matches('.portal-student-name')||n.querySelector('.portal-student-name')))))schedule();}).observe(document.body,{childList:true,subtree:true});
    if(typeof initializeTeacherPortalFirebaseAuth_==='function')initializeTeacherPortalFirebaseAuth_().then(connect).catch(()=>{});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof window==='undefined'?globalThis:window);
