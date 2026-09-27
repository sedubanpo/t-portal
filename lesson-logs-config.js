// Keep legacy Fillout active until the private test database, mapping and security
// deployment checks in docs/lesson-log-rollout.md have passed.
window.PORTAL_LESSON_LOGS_ENABLED = false;
// This only exposes the editor entry point. Authentication and the expiring,
// server-side single-user verification gate remain mandatory.
if(new URLSearchParams(location.search).get('lesson_log_pilot')==='1'){
  window.PORTAL_LESSON_LOGS_ENABLED = true;
}
