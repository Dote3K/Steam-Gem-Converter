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
    listener({ type, ...payload }, { id: 'test-extension', url: 'chrome-extension://test-extension/popup/popup.html' }, response => resolve(JSON.parse(JSON.stringify(response))));
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
  const grouped = (await paged('SGC_GET_SNAPSHOT')).snapshot;
  assert.deepEqual(grouped.inventory.games.map(game => [game.appId, game.count]), [[440, 2], [570, 1]]);
  assert.equal(grouped.plan.candidateCount, 2);
  assert.equal((await paged('SGC_SET_SELECTION', { selection: { appId: 570 } })).snapshot.plan.candidateCount, 1);
  assert.equal((await paged('SGC_SET_SELECTION', { selection: { appId: 999 } })).ok, false);
  const itemFilter = await paged('SGC_SET_SELECTION', { selection: { appId: 440, filterEnabled: true } });
  assert.equal(itemFilter.snapshot.filterOptions[0].count, 2);
  assert.equal(itemFilter.snapshot.plan.candidateCount, 2);
  assert.equal((await paged('SGC_SET_SELECTION', { selection: { filterKey: 'missing' } })).ok, false);
  assert.equal((await paged('SGC_GET_SNAPSHOT')).snapshot.selection.filterKey, '100_0');
  const typePage = inventoryPage();
  typePage.assets.push({ assetid: '5', classid: '300' }, { assetid: '6', classid: '101' });
  typePage.descriptions.push(
    { ...typePage.descriptions[0], classid: '300', name: 'Foil Card', type: 'Example Game Foil Trading Card', tags: [{ category: 'item_class', localized_tag_name: 'Trading Card' }] },
    { ...typePage.descriptions[0], classid: '101', name: 'Different Card' }
  );
  const types = runtime({ fetch: async () => jsonResponse(typePage) });
  await types('SGC_LOAD_INVENTORY');
  await until(types, s => s.inventory.status === 'loaded');
  assert.equal((await types('SGC_SET_SELECTION', { selection: { filterEnabled: true } })).snapshot.plan.candidateCount, 2);
  const typeFilter = await types('SGC_SET_SELECTION', { selection: { filterMode: 'type' } });
  assert.equal(typeFilter.snapshot.selection.filterKey, 'trading card');
  assert.equal(typeFilter.snapshot.plan.candidateCount, 3);
  assert.equal((await types('SGC_SET_SELECTION', { selection: { filterKey: 'foil trading card' } })).snapshot.plan.candidateCount, 1);
  assert.equal((await types('SGC_SET_SELECTION', { selection: { filterMode: 'invalid' } })).ok, false);
  assert.equal((await types('SGC_SET_SELECTION', { selection: { filterEnabled: false } })).snapshot.plan.candidateCount, 4);
  const limited = await types('SGC_SET_CONFIG', { config: { delayMs: 0, maxItems: 2 } });
  assert.equal(limited.snapshot.plan.plannedCount, 2);
  assert.equal(limited.snapshot.config.delayMs, 0);
  assert.equal((await types('SGC_SET_CONFIG', { config: { maxItems: null } })).snapshot.plan.plannedCount, 4);
  assert.equal((await types('SGC_SET_CONFIG', { config: { maxItems: 0 } })).ok, false);
  assert.equal((await types('SGC_SET_CONFIG', { config: { delayMs: -1 } })).ok, false);
  assert.equal((await types('SGC_SET_CONFIG', { config: { delayMs: 0.5 } })).ok, false);
  let releaseGoo;
  let gooRequests = 0;
  const posts = [];
  const conversion = runtime({ fetch: async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://steamcommunity.com');
    if (parsed.pathname.startsWith('/inventory/')) return jsonResponse(inventoryPage(['1', '2', '7']));
    if (parsed.pathname.startsWith('/auction/')) {
      gooRequests++;
      if (gooRequests === 1) return new Promise(resolve => { releaseGoo = () => resolve({ ok: false, status: 429 }); });
      return jsonResponse({ goo_value: 20, item_appid: 440 });
    }
    assert.equal(parsed.pathname, '/profiles/76561198000000000/ajaxgrindintogoo/');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    const body = Object.fromEntries(new URLSearchParams(options.body));
    posts.push(body);
    return jsonResponse({ success: body.assetid === '1' ? 0 : 1 });
  } });
  await conversion('SGC_LOAD_INVENTORY');
  const before = await until(conversion, s => s.inventory.status === 'loaded');
  assert.equal((await conversion('SGC_START_CONVERSION', { planId: before.plan.id })).ok, false);
  assert.equal((await conversion('SGC_START_CONVERSION', { confirmed: true, planId: before.plan.id, url: 'https://example.com' })).ok, false);
  const configured = (await conversion('SGC_SET_CONFIG', { config: { delayMs: 0, maxItems: 2 } })).snapshot;
  assert.equal((await conversion('SGC_START_CONVERSION', { confirmed: true, planId: before.plan.id })).ok, false);
  const started = await conversion('SGC_START_CONVERSION', { confirmed: true, planId: configured.plan.id });
  assert.equal(started.snapshot.job.status, 'running');
  assert.equal((await conversion('SGC_SET_CONFIG', { config: { maxItems: 3 } })).ok, false);
  assert.equal((await conversion('SGC_LOAD_INVENTORY')).ok, false);
  releaseGoo();
  const finished = await until(conversion, s => s.job.status === 'completed');
  assert.deepEqual([finished.job.total, finished.job.processed, finished.job.success, finished.job.failed], [2, 2, 1, 1]);
  assert.equal(finished.inventory.totalCount, 2);
  assert.deepEqual(posts, [{ sessionid: 'synthetic-session', appid: '440', assetid: '2', contextid: '6', goo_value_expected: '20' }]);
  assert.equal(JSON.stringify(finished).includes('synthetic-session'), false);
  await conversion('SGC_START_CONVERSION', { confirmed: true, planId: finished.plan.id });
  const retried = await until(conversion, s => s.job.status === 'completed');
  assert.deepEqual([retried.job.success, retried.job.failed, retried.inventory.totalCount], [1, 1, 1]);
  assert.deepEqual(posts.map(post => post.assetid), ['2', '1', '7']);
  let releasePost;
  let holdPost = true;
  const stoppedAssets = [];
  const stoppable = runtime({ fetch: async (url, options) => {
    if (url.includes('/inventory/')) return jsonResponse(inventoryPage());
    if (url.includes('/auction/')) return jsonResponse({ goo_value: 20 });
    stoppedAssets.push(new URLSearchParams(options.body).get('assetid'));
    if (holdPost) return new Promise(resolve => { releasePost = () => resolve(jsonResponse({ success: 1 })); });
    return jsonResponse({ success: 1 });
  } });
  await stoppable('SGC_LOAD_INVENTORY');
  const stopPlan = await until(stoppable, s => s.inventory.status === 'loaded');
  await stoppable('SGC_START_CONVERSION', { confirmed: true, planId: stopPlan.plan.id });
  await until(stoppable, () => Boolean(releasePost));
  assert.equal((await stoppable('SGC_CANCEL_CONVERSION')).snapshot.job.status, 'stopping');
  assert.equal((await stoppable('SGC_SET_SELECTION', { selection: { appId: 440 } })).ok, false);
  releasePost();
  const stopped = await until(stoppable, s => s.job.status === 'completed');
  assert.deepEqual([stopped.job.processed, stopped.job.success, stopped.inventory.totalCount], [1, 1, 1]);
  assert.deepEqual(stoppedAssets, ['1']);
  holdPost = false;
  await stoppable('SGC_LOAD_INVENTORY');
  await until(stoppable, s => s.inventory.status === 'loaded');
  const longDelay = (await stoppable('SGC_SET_CONFIG', { config: { delayMs: 10000 } })).snapshot;
  await stoppable('SGC_START_CONVERSION', { confirmed: true, planId: longDelay.plan.id });
  await until(stoppable, s => s.job.processed === 1);
  await stoppable('SGC_CANCEL_CONVERSION');
  assert.equal((await until(stoppable, s => s.job.status === 'completed')).job.processed, 1);
  console.log('Runtime checks passed: profiles, load ACK, inventory counts, privacy, login and HTTP errors.');
})().catch(error => { console.error(error); process.exitCode = 1; });
