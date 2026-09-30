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
function inventoryPage(ids = ['1', '2']) {
  return {
    success: 1,
    assets: ids.map(assetid => ({ assetid, classid: assetid === '3' ? '200' : '100', instanceid: '0' })),
    descriptions: [
      { classid: '100', instanceid: '0', name: 'Example Card', type: 'Example Game Trading Card', owner_actions: [{ link: "javascript:GetGooValue('%contextid%', '%assetid%', 440, 2, 0)" }] },
      { classid: '200', instanceid: '0', name: 'Another Card', type: 'Another Game Trading Card', owner_actions: [{ link: "javascript:GetGooValue('%contextid%', '%assetid%', 570, 2, 0)" }] }
    ]
  };
}

const jsonResponse = data => ({ ok: true, json: async () => data });
async function until(send, predicate) {
  for (let i = 0; i < 200; i++) {
    const response = await send('SGC_GET_SNAPSHOT');
    if (predicate(response.snapshot)) return response.snapshot;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Runtime did not reach the expected state.');
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
  let release;
  const send = runtime({ fetch: () => new Promise(resolve => { release = () => resolve(jsonResponse(inventoryPage())); }) });
  const ack = await send('SGC_LOAD_INVENTORY');
  assert.equal(ack.snapshot.inventory.status, 'loading');
  release();
  const loaded = await until(send, s => s.inventory.status === 'loaded');
  assert.equal(loaded.inventory.totalCount, 2);
  assert.equal(loaded.inventory.gemmableCount, 2);
  assert.equal('allItems' in loaded.inventory, false);
  const signedOut = runtime({ cookie: '' });
  await signedOut('SGC_LOAD_INVENTORY');
  assert.equal((await until(signedOut, s => s.inventory.status === 'error')).inventory.error.includes('Sign in'), true);
  const failed = runtime({ fetch: async () => ({ ok: false, status: 429 }) });
  await failed('SGC_LOAD_INVENTORY');
  assert.equal((await until(failed, s => s.inventory.status === 'error')).inventory.error.includes('429'), true);
  const requested = [];
  const paged = runtime({ fetch: async url => {
    const cursor = new URL(url).searchParams.get('start_assetid');
    requested.push(cursor);
    return jsonResponse(cursor ? inventoryPage(['2', '3']) : { ...inventoryPage(['1', '2']), more_items: 1, last_assetid: '2' });
  } });
  await paged('SGC_LOAD_INVENTORY');
  assert.equal((await until(paged, s => s.inventory.status === 'loaded')).inventory.totalCount, 3);
  assert.deepEqual(requested, [null, '2']);
  const badCursor = runtime({ fetch: async () => jsonResponse({ ...inventoryPage(), more_items: 1, last_assetid: '2' }) });
  await badCursor('SGC_LOAD_INVENTORY');
  assert.equal((await until(badCursor, s => s.inventory.status === 'error')).inventory.error.includes('cursor'), true);
  console.log('Runtime checks passed: profiles, load ACK, inventory counts, privacy, login and HTTP errors.');
})().catch(error => { console.error(error); process.exitCode = 1; });
