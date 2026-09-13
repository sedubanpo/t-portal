(function(global) {
  'use strict';
  // Only the authenticated Firebase function determines student/teacher scope.
  global.getPortalBootstrapDirect_ = async function(payload) {
    const config=getPortalSupabaseRuntimeConfig_();
    const auth=await getValidatedPortalSupabaseToken_(config,{allowOutsideCanary:true});
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch('https://asia-northeast3-fir-lms-prod.cloudfunctions.net/teacherPortalBootstrap',{
        method:'POST',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},
        body:JSON.stringify({includeStudentList:payload.includeStudentList!==false,includeStudentAliases:payload.includeStudentAliases===true,includeHomeroom:payload.includeHomeroom!==false,includeSlms:payload.includeSlms!==false}),signal:controller.signal
      });
      if(!response.ok) throw new Error('로그인 초기정보 조회에 실패했습니다. 다시 시도해 주세요.');
      const result=await response.json();
      if(!result.success)throw new Error(result.message||'초기정보 조회 실패');
      const [common,notices]=await Promise.all([
        payload.includeCommon===false?[]:requestPortalSupabaseRows_(config,'portal_basic_info?select=label,value&active=eq.true&order=sort_order.asc',auth.token),
        payload.includeNotices===false?[]:requestPortalSupabaseRows_(config,'portal_notices?select=notice_type,content&active=eq.true&order=sort_order.asc',auth.token)
      ]);
      return Object.assign(result,{common,notices:notices.map(r=>({type:r.notice_type,content:r.content}))});
    } finally {clearTimeout(timer);}
  };
  global.getPortalUpdateLogsDirect_ = async function(action,payload) {
    const config=getPortalSupabaseRuntimeConfig_();
    const auth=await getValidatedPortalSupabaseToken_(config,{allowOutsideCanary:true});
    const fields='id,title,version,category,publishedAt:published_at,authorName:author_name,authorType:author_type,summary';
    const detail=action==='getPortalUpdateLogDetail';
    const query='portal_update_logs?select='+encodeURIComponent(fields+(detail?',body':''))+'&published=eq.true'+(detail?'&id=eq.'+encodeURIComponent(String(payload.id||''))+'&limit=1':'&order=published_at.desc,id.desc&limit=100');
    const rows=await requestPortalSupabaseRows_(config,query,auth.token);
    if(detail&&!rows.length)throw new Error('업데이트 일지를 찾을 수 없습니다.');
    return detail?{success:true,post:rows[0]}:{success:true,posts:rows};
  };
})(window);
