import {installSso} from './hub-client.mjs';

const workspace = 'https://sedubanpo.github.io/sso/workspace/?app=teacher-portal';

async function start() {
  if (!new URLSearchParams(location.search).has('hub_nonce')) return;
  // A completed hub connection will not exchange a second ticket for the old nonce.
  if (window.top === window && performance.getEntriesByType('navigation')[0]?.type === 'reload') {
    location.replace(workspace);
    return;
  }
  const status = document.getElementById('portal-auth-status');
  const recover = () => { status.textContent = '허브에서 강사 포털을 다시 열어 주세요.'; };
  const timeout = setTimeout(recover, 30000);
  try {
    const cleanup = await installSso({
      appId: 'teacher-portal',
      brokerUrl: 'https://asia-northeast3-fir-lms-prod.cloudfunctions.net/hubSsoApi',
      hubOrigins: ['https://sedubanpo.github.io'],
      signOut: window.SeduHubAdapter.signOut,
      async signIn(token, uid) {
        try { await window.SeduHubAdapter.signIn(token, uid); }
        catch (error) { recover(); throw error; }
        finally { clearTimeout(timeout); }
      }
    });
    if (!cleanup) { clearTimeout(timeout); recover(); }
  } catch { clearTimeout(timeout); recover(); }
}

if (document.readyState === 'complete') start();
else window.addEventListener('load', start, {once:true});
