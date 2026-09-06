import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const names = ['makePortalSupabaseError_', 'requestPortalSupabaseRows_', 'requestPortalSupabaseRpc_', 'fetchSynchroPortalApi_'];
const blocks = names.map(name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  function ', start + 1));
});
let response;
const timers = new Set();
const context = vm.createContext({
  AbortController, console,
  SYNCHRO_PORTAL_API_URL: 'https://example.test/synchro',
  getTeacherPortalFirebaseIdToken_: () => Promise.resolve('test-token'),
  fetch: (...args) => typeof response === 'function' ? response(...args) : Promise.resolve(response),
  setTimeout: fn => { timers.add(fn); return fn; },
  clearTimeout: fn => timers.delete(fn)
});
vm.runInContext(blocks.join('\n'), context);
const config = { url: 'https://example.test', publishableKey: 'public-test', timeoutMs: 20 };
const reply = (text, status = 200) => ({ ok: status < 300, status, text: async () => text, json: async () => JSON.parse(text) });
for (const invalid of ['<html>gateway</html>', '{}', 'null', '']) {
  response = reply(invalid);
  await assert.rejects(context.requestPortalSupabaseRows_(config, 'rows', 'test'), { code: 'SUPABASE_INVALID_RESPONSE' });
  assert.equal(timers.size, 0);
}
response = reply('[]');
assert.equal((await context.requestPortalSupabaseRows_(config, 'rows', 'test')).length, 0);
response = reply('<html>gateway</html>');
await assert.rejects(context.requestPortalSupabaseRpc_(config, 'save', {}, 'test'), { code: 'SUPABASE_INVALID_RESPONSE' });
response = reply('{"message":"denied"}', 403);
await assert.rejects(context.requestPortalSupabaseRows_(config, 'rows', 'test'), { status: 403 });
for (const invalid of ['<html>gateway</html>', 'null', '[]']) {
  response = reply(invalid);
  await assert.rejects(context.fetchSynchroPortalApi_(''), /응답/);
  assert.equal(timers.size, 0);
}
response = reply('{"groups":[],"currentTag":null}');
assert.equal((await context.fetchSynchroPortalApi_('')).groups.length, 0);
response = (_url, options) => new Promise((_resolve, reject) => {
  options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});
const pending = context.fetchSynchroPortalApi_('');
await Promise.resolve();
for (const timer of timers) timer();
await assert.rejects(pending, /시간이 초과/);
assert.equal(timers.size, 0, 'abort must release the timeout');
console.log('network failure tests passed: malformed responses, HTTP errors, empty success, timeout cleanup');
