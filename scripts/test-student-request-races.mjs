#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the repository's functions, not reimplementations; no browser/network needed.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = html.indexOf('\n  }', start);
  assert.ok(end > start, `missing end of ${name}`);
  return html.slice(start, end + 4);
}
function context(names, globals) {
  const ctx = vm.createContext(globals);
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return ctx;
}
const noop = () => {};
function statsHarness() {
  const picker = { value: '2026-08' };
  const pending = [], scopes = [], metadata = [], renders = [], freshness = [], loading = [];
  const ctx = context(['ensureStudentStatsCacheState', 'refreshStudentStats', 'refreshStudentStatsSnapshotInBackground_'], {
    window: { appState: {} }, document: { getElementById: () => picker },
    allStatsData: [], statsSelectedStudents: new Set(),
    syncStatsMonthInputs: noop, resetStudentStatsCache: noop,
    isFreshStudentStatsMemoryCache: key => Array.isArray(ctx.window.appState.studentStatsByMonth[key]),
    isValidStudentStatsCache: Array.isArray,
    readStudentStatsSessionCache: () => null, readStudentStatsLocalCache: () => null,
    readStudentStatsLocalCacheEntry: () => null,
    prepareStudentFiltersAndRender: () => renders.push([...ctx.allStatsData]),
    updateStudentStatsFreshness_: (...args) => freshness.push(args),
    setStudentStatsRefreshState_: (...args) => freshness.push(args),
    preloadStudentStatsNearbyMonths: noop, showStudentStatsLoading: noop,
    showLoading: flag => loading.push(flag),
    ensureStudentMetaReady: cb => metadata.push(cb),
    fetchStudentStatsOverviewCache: (y, m, key, opts, cb) => pending.push({ key, cb }),
    ensureTeacherDataScope: (req, cb) => scopes.push({ req, cb }),
    processStatsDataFromState: key => renders.push(['fallback', key]),
    renderStudentStatsMonthIfOpen_: key => renders.push(['background', key]),
    isStudentStatsMonthOpen_: key => key === picker.value,
    STUDENT_STATS_BACKGROUND_REFRESH_COOLDOWN_MS: 1000,
  });
  const complete = (i, ok = true) => {
    const { key, cb } = pending[i];
    if (ok) ctx.window.appState.studentStatsByMonth[key] = [key];
    cb(ok);
  };
  return { ctx, picker, pending, scopes, metadata, renders, freshness, loading, complete };
}

// Reversed month completion must not render or alter freshness for the old month.
{
  const h = statsHarness();
  h.ctx.refreshStudentStats(true);
  h.picker.value = '2026-09';
  h.ctx.refreshStudentStats(true);
  h.complete(1);
  const loadingCount = h.loading.length;
  h.complete(0);
  assert.deepEqual(h.renders, [['2026-09']]);
  assert.equal(h.freshness.length, 1);
  assert.equal(h.loading.length, loadingCount);
}
// Same-month supersession and a cache-hit navigation also invalidate older callbacks.
for (const cacheHit of [false, true]) {
  const h = statsHarness();
  h.ctx.refreshStudentStats(true);
  if (cacheHit) h.ctx.window.appState.studentStatsByMonth[h.picker.value] = ['cached'];
  h.ctx.refreshStudentStats(!cacheHit);
  if (!cacheHit) h.complete(1);
  h.complete(0, false);
  assert.equal(h.renders.length, 1);
  assert.equal(h.scopes.length, 0);
  assert.equal(h.metadata.length, cacheHit ? 1 : 2);
  assert.equal(h.loading.at(-1), false);
}
// Guard both deferred metadata and a fallback already in flight.
for (const scopeStarted of [false, true]) {
  const h = statsHarness();
  h.ctx.refreshStudentStats();
  h.complete(0, false);
  if (scopeStarted) h.metadata.at(-1)();
  h.picker.value = '2026-09';
  h.ctx.refreshStudentStats();
  h.complete(1);
  if (scopeStarted) h.scopes[0].cb();
  else h.metadata[1]();
  assert.deepEqual(h.renders, [['2026-09']]);
  assert.equal(h.scopes.length, scopeStarted ? 1 : 0);
}
// Stale-local failure must not replace the current month's freshness indicator.
{
  const h = statsHarness();
  h.ctx.readStudentStatsLocalCacheEntry = () => ({ rows: ['stale'] });
  h.ctx.refreshStudentStats();
  h.ctx.readStudentStatsLocalCacheEntry = () => null;
  h.picker.value = '2026-09';
  h.ctx.refreshStudentStats();
  h.complete(1);
  const count = h.freshness.length;
  h.complete(0, false);
  assert.equal(h.freshness.length, count);
}
// Current-generation fallback must still complete and release its loading state.
{
  const h = statsHarness();
  h.ctx.refreshStudentStats(true);
  h.metadata[0]();
  h.complete(0, false);
  h.scopes[0].cb();
  assert.deepEqual(h.renders, [['fallback', '2026-08']]);
  assert.equal(h.loading.at(-1), false);
  assert.equal(h.ctx.window.appState.studentStatsRefreshLoading, false);
}
// Background requests must not repaint after a newer refresh of the same month.
{
  const h = statsHarness();
  h.ctx.refreshStudentStatsSnapshotInBackground_(2026, 7, '2026-08');
  h.ctx.refreshStudentStats(true);
  h.complete(1);
  h.complete(0);
  assert.deepEqual(h.renders, [['2026-08']]);
}

// Use actual scoped-cache TTL logic and loader, including authoritative empty rows.
for (const rows of [[{ id: 'fresh' }], []]) {
  const renders = [];
  const ctx = context(['ensureStudentStatsCacheState', 'getStudentCalendarMonthRows',
    'hasStudentCalendarMonthCache', 'getStudentCalendarCacheKey', 'getStudentCalendarScopedCache',
    'loadStudentCalendarScopeAndRender', 'resetStudentStatsCache', 'clearStudentCalendarMemoryCache'], {
    window: { appState: { teacherRowsByMonth: { '2026-08': [{ id: 'old' }], '2026-09': [] },
      studentCalendarByMonth: { 'v1|2026-08|Kim': { at: Date.now(), rows, projectedRows: [] } } } },
    APP_VERSION: 'v1', cleanStudentName: x => x,
    getStatsMonthKey: (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`,
    getStudentCalendarCacheTtl: () => 60000, readStudentCalendarSessionCache: () => null,
    document: { getElementById: () => null }, scLoadToken: 0, scYear: 2026, scMonth: 7,
    scStudentName: 'Kim', scData: [], scProjectedData: [], scDataScoped: false,
    scAnalysisEntries: [], scActiveAnalysisId: '', scTeacherMonthMap: {},
    renderStudentCalendar: () => renders.push({ scoped: ctx.scDataScoped, rows: ctx.scData }),
    showLoading: noop, preloadStudentCalendarRecentMonths: noop,
    clearStudentStatsSessionCache: noop, clearStudentStatsLocalCache: noop,
    clearStudentCalendarSessionCache: noop,
  });
  ctx.loadStudentCalendarScopeAndRender();
  assert.equal(renders[0].scoped, true);
  assert.deepEqual(renders[0].rows, rows);
  ctx.window.appState.studentCalendarByMonth['v1|2026-08|Kim'].at = 1;
  ctx.loadStudentCalendarScopeAndRender();
  assert.equal(renders[1].scoped, false, 'expired scoped cache permits full-month fallback');
  ctx.resetStudentStatsCache('2026-08');
  assert.equal(ctx.getStudentCalendarMonthRows(2026, 7), null);
  assert.ok(Array.isArray(ctx.getStudentCalendarMonthRows(2026, 8)));
  assert.equal(ctx.getStudentCalendarScopedCache(2026, 7, 'Kim'), null);
  ctx.window.appState.studentCalendarByMonth['v1|2026-09|Kim'] = { at: Date.now(), rows: [], projectedRows: [] };
  ctx.resetStudentStatsCache();
  assert.equal(ctx.getStudentCalendarMonthRows(2026, 8), null);
  assert.equal(ctx.getStudentCalendarScopedCache(2026, 8, 'Kim'), null);
}

const flush = () => new Promise(resolve => setImmediate(resolve));
function weekHarness(forceRefresh, legacy = false) {
  const requests = [{ year: 2026, month0: 7, teacherName: 'T' }, { year: 2026, month0: 8, teacherName: 'T' }];
  const pending = [], rendered = [];
  const ctx = context(['loadWeekTimetableData', 'getWeekTimetableCachedRows', 'mergeWeekTimetableRows'], {
    window: { appState: { rawRowsScope: '7', rawRows: [{ student: 'old raw', dateKey: '2026-08-31' }] } },
    getTeacherDataScopeKey: req => String(req.month0), getTeacherScopeCacheForRequest: () => null,
    parseTeacherDataEntries: rows => rows, normalizeTeacherName: x => x || '', cleanStudentName: x => x || '',
    parseFlexibleTimeToMinutes: () => 0,
    getWeekTimetableMonthRequests: () => requests, weekTimetableLoadToken: 0, weekTimetableData: [],
    performance: { now: () => 0 }, document: { body: { dataset: {} } },
    renderWeekTimetable: () => rendered.push([...ctx.weekTimetableData]), renderWeekTimetableLoading: noop,
    fetchWeekTimetableMonthDirect: req => legacy ? Promise.reject(new Error('offline fallback')) : new Promise(resolve => pending.push({ req, resolve })),
    fetchWeekTimetableMonthLegacy: req => new Promise(resolve => pending.push({ req, resolve })),
    console: { warn: noop, error: noop }, showToast: noop, studentMetaReady: true, studentMetaMap: new Map([['Kim', {}]]),
  });
  ctx.loadWeekTimetableData(forceRefresh);
  return { ctx, pending, rendered };
}
for (const legacy of [false, true]) {
  const h = weekHarness(true, legacy);
  await flush();
  // Resolve a cross-month week in reverse order, with an authoritative empty first month.
  h.pending[1].resolve([{ student: 'fresh', dateKey: '2026-09-01' }]);
  h.pending[0].resolve([]);
  await flush();
  assert.deepEqual(h.rendered.at(-1).map(x => x.student), ['fresh']);
  assert.equal(h.ctx.document.body.dataset.teacherTimetableLoadSource, legacy ? 'apps-script-fallback' : 'supabase-direct');
}
{
  const h = weekHarness(false);
  assert.equal(h.pending.length, 1);
  h.pending[0].resolve([{ student: 'fresh', dateKey: '2026-09-01' }]);
  await flush();
  assert.deepEqual(h.rendered.at(-1).map(x => x.student), ['old raw', 'fresh']);
}
{
  const h = weekHarness(true);
  h.ctx.loadWeekTimetableData(true);
  h.pending[2].resolve([]);
  h.pending[3].resolve([{ student: 'newest', dateKey: '2026-09-01' }]);
  await flush();
  h.pending[0].resolve([{ student: 'stale', dateKey: '2026-08-31' }]);
  h.pending[1].resolve([]);
  await flush();
  assert.equal(h.rendered.length, 1);
  assert.deepEqual(h.rendered[0].map(x => x.student), ['newest']);
}
{
  const ctx = context(['applyTeacherDataEntries'], {
    window: { appState: { teacherRowsByMonth: {} } }, allTeacherData: [],
    dedupeTeacherDataEntries: rows => rows, parseTeacherDataEntries: rows => rows,
    getMonthKeyFromScope: () => '2026-09',
    resetStudentStatsCache: () => { ctx.window.appState.teacherRowsByMonth = {}; },
    syncTeacherMonthRowsForScope: rows => { ctx.window.appState.teacherRowsByMonth['2026-09'] = rows; },
    updateDashboard: noop
  });
  ctx.applyTeacherDataEntries([{ student: 'fresh' }], '2026-09|all', { invalidateStudentStats: true });
  assert.equal(ctx.window.appState.teacherRowsByMonth['2026-09'][0].student, 'fresh', 'invalidation must precede indexing the fresh response');
}
console.log('student request race behavior passed (offline extracted-function VM tests)');
