'use strict';
const {fail} = require('./model');
const rt = value => {const text=String(value||'');return Array.from({length:Math.ceil(text.length/1800)},(_,i)=>({type:'text',text:{content:text.slice(i*1800,(i+1)*1800)}}));};
function pagePayload(id,snapshot,dataSourceId,uploads) {
  const c=snapshot.content;
  const properties={
    'Portal draft ID':{rich_text:rt(id)},
    '수업 제목(클릭)':{title:rt(c.title)},'날짜':{date:{start:c.lessonDate}},
    '강사명':{relation:[{id:snapshot.notionTeacherId}]},'학생명':{relation:[{id:snapshot.notionStudentId}]},
    '수업유형':{select:{name:c.lessonType}},' 숙제':{rich_text:rt(c.homework)},
    '지난 숙제 피드백':{rich_text:rt(c.feedback)},'수업내용':{rich_text:rt(c.content)},
    '학생명(검색용)':{rich_text:rt(snapshot.studentName)}
  };
  const children=[];
  for(const [label,value] of [['수업 내용',c.content],['수업 자료 / 링크',c.materials],['숙제',c.homework],['지난 숙제 피드백',c.feedback],['테스트 · 평가',c.assessment]]) {
    if(!value)continue;
    children.push({object:'block',type:'heading_2',heading_2:{rich_text:rt(label)}});
    // One bounded paragraph per field, including multiline plain text, no HTML execution.
    children.push({object:'block',type:'paragraph',paragraph:{rich_text:rt(value)}});
  }
  for(const f of snapshot.files){const type=f.mime==='application/pdf'?'file':'image';children.push({object:'block',type,[type]:{type:'file_upload',file_upload:{id:uploads[f.id]},caption:rt(f.name)}});}
  return {parent:{type:'data_source_id',data_source_id:dataSourceId},properties,children};
}
function createNotion({token,dataSourceId,fetcher=fetch}) {
  let materialOptions=new Set();
  async function request(path,body,form) {
    const response=await fetcher('https://api.notion.com/v1/'+path,{method:body||form?'POST':'GET',headers:{Authorization:'Bearer '+token,'Notion-Version':'2025-09-03',...(form?{}:{'Content-Type':'application/json'})},body:form|| (body?JSON.stringify(body):undefined),signal:AbortSignal.timeout(25000)});
    if(!response.ok)fail('NOTION_REQUEST_FAILED',502);return response.json();
  }
  return {
    async preflight(){
      const schema=await request('data_sources/'+dataSourceId);
      const expected={'Portal draft ID':'rich_text','수업 제목(클릭)':'title','날짜':'date','강사명':'relation','학생명':'relation','수업유형':'select',' 숙제':'rich_text','지난 숙제 피드백':'rich_text','수업내용':'rich_text','학생명(검색용)':'rich_text'};
      if(Object.entries(expected).some(([key,type])=>schema.properties?.[key]?.type!==type))fail('NOTION_SCHEMA_SETUP_REQUIRED',409);
      materialOptions=new Set((schema.properties['수업자료']?.multi_select?.options||[]).map(o=>o.name));
    },
    async find(id){const r=await request('data_sources/'+dataSourceId+'/query',{filter:{property:'Portal draft ID',rich_text:{equals:id}},page_size:2});if(r.has_more||r.results.length>1)fail('NOTION_DUPLICATE_REVIEW',409);return r.results[0]?.id||null;},
    async upload(file,bytes){const created=await request('file_uploads',{mode:'single_part',filename:file.name,content_type:file.mime});const form=new FormData();form.append('file',new Blob([bytes],{type:file.mime}),file.name);const sent=await request('file_uploads/'+created.id+'/send',null,form);if(sent.status!=='uploaded')fail('NOTION_FILE_PENDING',502);return {id:created.id,expiresAt:Date.parse(sent.expiry_time||created.expiry_time)||Date.now()+50*60*1000};},
    create:(id,snapshot,uploads)=>{
      const payload=pagePayload(id,snapshot,dataSourceId,uploads);
      const names=[...new Set(snapshot.content.materials.split(/\n/).map(s=>s.trim()).filter(s=>materialOptions.has(s)))];
      if(names.length)payload.properties['수업자료']={multi_select:names.map(name=>({name}))};
      return request('pages',payload);
    }
  };
}
module.exports={rt,pagePayload,createNotion};
