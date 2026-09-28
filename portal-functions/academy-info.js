const {inactive}=require('./staff-access');
function canEdit(account){return ['ADMIN','SUPER_ADMIN'].includes(String(account.user.role||'').toUpperCase())&&![account.user,account.profile,account.access].some(inactive);}
function validate(input){
  if(!Number.isSafeInteger(input.revision)||input.revision<0||!Array.isArray(input.items)||input.items.length>40)throw Object.assign(Error('입력 형식을 확인해 주세요.'),{statusCode:400});
  return input.items.map(row=>{
    if(!row||typeof row.label!=='string'||typeof row.value!=='string'||!row.label.trim()||!row.value.trim()||row.label.length>80||row.value.length>4000)throw Object.assign(Error('항목 제목과 내용을 확인해 주세요. 제목은 80자, 내용은 4,000자까지 입력할 수 있습니다.'),{statusCode:400});
    return {label:row.label.trim(),value:row.value.trim()};
  });
}
async function handle(db,account,input){
  const ref=db.collection('portalSettings').doc('academyInfo');
  const editable=canEdit(account);
  if(input.mode==='academyInfoSave'){
    if(!editable)throw Object.assign(Error('관리자만 학원 정보를 수정할 수 있습니다.'),{statusCode:403});
    const items=validate(input);
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref),old=snap.data()||{};
      if((old.revision||0)!==input.revision)throw Object.assign(Error('다른 관리자가 내용을 변경했습니다. 입력 내용을 복사한 뒤 다시 불러와 주세요.'),{statusCode:409});
      const next={items,revision:input.revision+1,updatedAt:new Date().toISOString(),updatedBy:account.uid};
      tx.set(ref.collection('revisions').doc(String(next.revision)),{previous:old,...next});
      tx.set(ref,next);
    });
  }
  const snap=await ref.get(),data=snap.data()||{};
  return {success:true,editable,items:data.items||[],revision:data.revision||0,updatedAt:data.updatedAt||null};
}
module.exports={handle,canEdit,validate};
