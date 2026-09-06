#!/usr/bin/env node
// Offline only: execute the actual inline functions with controlled DOM/I/O doubles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = html.indexOf('\n  }', start);
  assert.notEqual(end, -1, `Missing closing brace for ${name}`);
  return html.slice(start, end + 4);
}
const functions = [
  'loadSupabaseAccessOverview', 'handleSupabaseFileSelected',
  'handleSupabasePasteInput', 'resetSupabaseUploadModal',
  'analyzeSupabaseUploadChanges',
].map(extract).join('\n');
const generations = ['supabaseUploadInputGeneration', 'supabaseAccessOverviewGeneration']
  .map(name => {
    const declaration = html.match(new RegExp(`  let ${name} = 0;`));
    assert.ok(declaration, `Missing dedicated generation ${name}`);
    return declaration[0];
  }).join('\n');

function harness() {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', innerText: '', disabled: false });
    return elements.get(id);
  };
  const readers = [], requests = [], plans = [], rendered = [];
  const deferred = list => options => new Promise((resolve, reject) => list.push({ options, resolve, reject }));
  const context = vm.createContext({
    TextDecoder,
    document: { getElementById: el },
    supabaseUploadPayload: { csvText: 'old', preview: { valid: 1 } },
    supabaseUploadPlanState: { plan: { planHash: 'old' } },
    supabaseUploadPlanToken: 0,
    supabaseHoursReviewState: { success: true },
    supabaseInputMode: 'file',
    supabaseAccessOverviewYear: 2026,
    supabaseAccessOverviewMonth: 0,
    supabaseAccessOverviewSelectedDate: '',
    supabaseAccessOverviewState: null,
    setTextIfExists: (id, text) => { el(id).innerText = text; },
    escapeHtml_: value => String(value),
    renderSupabaseUploadPlanEmpty: text => { el('supabase-upload-plan-body').innerHTML = text; },
    renderSupabaseHoursReviewEmpty: text => { el('supabase-hours-review-result').innerHTML = text; },
    buildSupabasePasteFileName: () => 'paste.tsv',
    parseSupabaseCsvForPreview: text => {
      if (text === 'bad') throw new Error('invalid input');
      return { valid: 1, text };
    },
    getSupabaseAccessAttendanceOverviewDirect_: deferred(requests),
    analyzeSupabaseAttendanceUploadDirect_: deferred(plans),
    FileReader: class {
      constructor() { readers.push(this); }
      readAsArrayBuffer(file) {
        if (file.throwRead) throw new Error('read threw');
        this.file = file;
      }
    },
  });
  context.setSupabaseInputMode = mode => { context.supabaseInputMode = mode; };
  context.updateSupabaseUploadSubmitState = () => {
    el('supabase-upload-submit').disabled = !(context.supabaseUploadPayload && context.supabaseUploadPlanState);
  };
  context.renderSupabaseUploadPreview = preview => {
    el('supabase-preview-body').innerHTML = preview.text;
    el('supabase-upload-status').innerText = 'preview ready';
  };
  context.applySupabaseUploadPlanFromServer = plan => { context.supabaseUploadPlanState = { plan }; };
  context.renderSupabaseAccessOverview = res => {
    rendered.push(res);
    el('supabase-access-calendar-grid').innerHTML = res.selectedDate;
    el('supabase-access-detail-status').innerText = 'loaded';
  };
  vm.runInContext(`${generations}\n${functions}`, context);
  const select = (name, extra = {}) => context.handleSupabaseFileSelected({ target: { files: [{ name, ...extra }] } });
  const finish = (index, text) => readers[index].onload({ target: { result: new TextEncoder().encode(text).buffer } });
  const disabled = () => {
    assert.equal(context.supabaseUploadPayload, null);
    assert.equal(context.supabaseUploadPlanState, null);
    assert.equal(context.supabaseHoursReviewState, null);
    assert.equal(el('supabase-upload-submit').disabled, true);
  };
  const snapshot = () => JSON.stringify({ elements: [...elements], payload: context.supabaseUploadPayload,
    plan: context.supabaseUploadPlanState, overview: context.supabaseAccessOverviewState,
    date: context.supabaseAccessOverviewSelectedDate, rendered });
  return { context, el, readers, requests, plans, rendered, select, finish, disabled, snapshot };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('file B wins reversed file callbacks; stale errors and aborts cannot change UI', () => {
  const h = harness();
  h.el('supabase-paste-text').value = 'keep paste';
  h.el('supabase-hours-review-text').value = 'keep review';
  h.select('A.csv'); h.disabled();
  h.select('B.csv'); h.disabled();
  h.finish(1, 'B');
  const before = h.snapshot();
  h.finish(0, 'A'); h.readers[0].onerror(); h.readers[0].onabort();
  assert.equal(h.snapshot(), before);
  assert.equal(h.context.supabaseUploadPayload.fileName, 'B.csv');
  assert.equal(h.el('supabase-paste-text').value, 'keep paste');
  assert.equal(h.el('supabase-hours-review-text').value, 'keep review');
});

for (const clearFile of [false, true]) test(`reset(${clearFile}) invalidates pending reads`, () => {
  const h = harness();
  for (const id of ['supabase-upload-file', 'supabase-paste-text', 'supabase-hours-review-text']) h.el(id).value = 'keep';
  h.select('A.csv');
  h.context.resetSupabaseUploadModal(clearFile); h.disabled();
  const before = h.snapshot();
  h.finish(0, 'A'); h.readers[0].onerror();
  assert.equal(h.snapshot(), before);
  for (const id of ['supabase-upload-file', 'supabase-paste-text', 'supabase-hours-review-text']) {
    assert.equal(h.el(id).value, clearFile ? '' : 'keep');
  }
});

for (const text of ['  pasted\ttext\n', 'bad', '   ']) test(`paste ${JSON.stringify(text)} invalidates pending reads and preserves text`, () => {
  const h = harness(); h.select('A.csv');
  h.el('supabase-paste-text').value = text;
  h.context.handleSupabasePasteInput();
  if (text === 'bad' || !text.trim()) h.disabled();
  else assert.equal(h.context.supabaseUploadPayload.csvText, text);
  assert.equal(h.el('supabase-paste-text').value, text);
  const before = h.snapshot();
  h.finish(0, 'A'); h.readers[0].onerror();
  assert.equal(h.snapshot(), before);
});

for (const failure of ['error', 'abort', 'parse', 'read', 'constructor']) test(`current file ${failure} leaves upload disabled`, () => {
  const h = harness();
  if (failure === 'constructor') h.context.FileReader = class { constructor() { throw new Error('constructor failed'); } };
  h.select('A.csv', { throwRead: failure === 'read' });
  if (failure === 'error') h.readers[0].onerror();
  if (failure === 'abort') h.readers[0].onabort();
  if (failure === 'parse') h.finish(0, 'bad');
  h.disabled();
  assert.equal(h.el('supabase-upload-status').innerText, '검증 실패');
});

for (const action of ['file', 'paste', 'reset']) for (const failure of [false, true]) {
  test(`${action} invalidates pending plan ${failure ? 'failure' : 'success'}`, async () => {
    const h = harness();
    h.context.analyzeSupabaseUploadChanges();
    if (action === 'file') h.select('B.csv');
    if (action === 'paste') { h.el('supabase-paste-text').value = 'bad'; h.context.handleSupabasePasteInput(); }
    if (action === 'reset') h.context.resetSupabaseUploadModal();
    const before = h.snapshot();
    if (failure) h.plans[0].reject(new Error('old failure'));
    else h.plans[0].resolve({ success: true, plan: { planHash: 'stale' } });
    await flush(); h.disabled();
    assert.equal(h.snapshot(), before);
  });
}

for (const stale of ['success', 'failure-response', 'rejection']) test(`latest overview month wins stale ${stale}`, async () => {
  const h = harness();
  h.context.loadSupabaseAccessOverview(false);
  h.context.supabaseAccessOverviewMonth = 1;
  h.context.loadSupabaseAccessOverview(true);
  assert.equal(h.requests[0].options.month, 1);
  assert.equal(h.requests[1].options.month, 2);
  assert.equal(h.requests[1].options.forceRefresh, true);
  const latest = { success: true, selectedDate: '2026-02-02' };
  h.requests[1].resolve(latest); await flush();
  const before = h.snapshot();
  if (stale === 'rejection') h.requests[0].reject(new Error('old failure'));
  else h.requests[0].resolve({ success: stale === 'success', selectedDate: '2026-01-01' });
  await flush();
  assert.equal(h.snapshot(), before);
  assert.equal(h.context.supabaseAccessOverviewState, latest);
  assert.equal(h.rendered.length, 1);
});

for (const reject of [false, true]) test(`current overview ${reject ? 'rejection' : 'failure response'} still displays error`, async () => {
  const h = harness(); h.context.loadSupabaseAccessOverview(false);
  if (reject) h.requests[0].reject(new Error('current failure'));
  else h.requests[0].resolve({ success: false, message: 'current failure' });
  await flush();
  assert.equal(h.el('supabase-access-detail-status').innerText, '조회 실패');
  assert.match(h.el('supabase-access-calendar-grid').innerHTML, /current failure/);
});
