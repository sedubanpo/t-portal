(function configureTeacherPortalRuntime(global) {
  global.__TPORTAL_SUPABASE_PUBLIC_CONFIG__ = Object.freeze({
    enabled: true,
    url: 'https://wfgtqajdkwzuqkwygcft.supabase.co',
    publishableKey: 'sb_publishable_Dge9XbPdumlwXeaGWVEFZA_ol9FBXE8',
    firebaseProjectId: 'fir-lms-prod',
    canaryFirebaseUids: [
      'teacher_01089945993',
      'teacher_01020837308',
      'teacher_01051434540'
    ],
    pastMonthsDirect: true,
    shadowActions: ['getTeacherHoursDashboardData'],
    timeoutMs: 7000,
    maxCurrentMonthAgeMs: 900000
  });
})(window);
