'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.join(__dirname, '..');

function runtime({ pathname = '/profiles/76561198000000000/inventory/', steamId = '76561198000000000', cookie = 'sessionid=synthetic-session', fetch } = {}) {
  let listener;
  const listeners = new Set();
  const window = {
    addEventListener(type, fn) { listeners.add(fn); },
    removeEventListener(type, fn) { listeners.delete(fn); },
    postMessage(data) {
      if (data.type !== 'SGC_REQUEST_PAGE_CONTEXT') return;
      queueMicrotask(() => {
        for (const fn of listeners) fn({ source: window, origin: 'https://steamcommunity.com', data: { type: 'SGC_PAGE_CONTEXT', requestId: data.requestId, steamId } });
      });
    }
  };
  const context = vm.createContext({
    window, location: { origin: 'https://steamcommunity.com', pathname },
    document: { cookie }, crypto: webcrypto, setTimeout, clearTimeout,
    URL, URLSearchParams, fetch,
    chrome: { runtime: { id: 'test-extension', getURL: p => `chrome-extension://test-extension/${p}`, onMessage: { addListener: fn => { listener = fn; } } } }
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  for (const file of manifest.content_scripts.find(script => script.world === 'ISOLATED').js) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return (type, payload = {}) => new Promise(resolve => {
    listener({ type, ...payload }, { id: 'test-extension', url: 'chrome-extension://test-extension/popup/popup.html' }, resolve);
  });
}

(async () => {
  const numeric = await runtime()('SGC_GET_SNAPSHOT');
  assert.equal(numeric.snapshot.page.steamId, '76561198000000000');
  const vanity = await runtime({ pathname: '/id/example/inventory/' })('SGC_GET_SNAPSHOT');
  assert.equal(vanity.snapshot.page.steamId, '76561198000000000');
  const invalid = await runtime({ pathname: '/id/example/inventory/', steamId: '../bad' })('SGC_GET_SNAPSHOT');
  assert.equal(invalid.ok, false);
  const unsupported = await runtime({ pathname: '/id/example/' })('SGC_GET_SNAPSHOT');
  assert.equal(unsupported.ok, false);
  console.log('Runtime checks passed: numeric/vanity profiles and invalid profile boundaries.');
})().catch(error => { console.error(error); process.exitCode = 1; });
