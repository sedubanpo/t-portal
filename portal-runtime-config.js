(function configureTeacherPortalRuntime(global) {
  global.__TPORTAL_SUPABASE_PUBLIC_CONFIG__ = Object.freeze({
    enabled: true,
    url: 'https://wfgtqajdkwzuqkwygcft.supabase.co',
    publishableKey: 'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8',
    firebaseProjectId: 'fir-lms-prod',
    canaryFirebaseUids: ['teacher_01089945993'],
    shadowActions: ['getTeacherHoursDashboardData'],
    timeoutMs: 7000,
    maxCurrentMonthAgeMs: 900000
  });
})(window);
