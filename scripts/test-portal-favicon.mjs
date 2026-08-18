import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexText = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const faviconText = readFileSync(new URL('../favicon.svg', import.meta.url), 'utf8');

assert.match(indexText, /<meta name="theme-color" content="#0b5cc5">/);
assert.match(indexText, /<link rel="icon" type="image\/svg\+xml" href="\.\/favicon\.svg\?v=511">/);
assert.match(indexText, /<link rel="shortcut icon" type="image\/svg\+xml" href="\.\/favicon\.svg\?v=511">/);
assert.doesNotMatch(indexText, /function setPortalFavicon\(/);
assert.doesNotMatch(indexText, /setPortalFavicon\(/);
assert.match(faviconText, /<svg[^>]+viewBox="0 0 64 64"/);
assert.match(faviconText, /id="portal-blue"/);
assert.match(faviconText, /fill="#10b981"/);
assert.match(faviconText, /stroke="#ffffff"/);

console.log('portal favicon checks passed');
