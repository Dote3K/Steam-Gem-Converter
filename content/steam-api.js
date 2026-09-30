(() => {
  'use strict';

  function getSessionId() {
    const cookie = document.cookie.split(';').map(row => row.trim()).find(row => row.startsWith('sessionid='));
    const sessionId = cookie?.slice('sessionid='.length);
    if (!sessionId) throw new Error('Sign in to Steam Community, then refresh your inventory.');
    return sessionId;
  }

  async function readJson(url, options = {}) {
    const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' }, ...options });
    if (!response.ok) throw new Error(`Steam request failed (HTTP ${response.status}).`);
    try {
      return await response.json();
    } catch {
      throw new Error('Steam returned an invalid response. Refresh your inventory and sign in again.');
    }
  }

  async function fetchInventory(steamId, onPage) {
    const url = new URL(`/inventory/${steamId}/753/6`, 'https://steamcommunity.com');
    url.searchParams.set('l', 'english');
    url.searchParams.set('count', '2000');
    const assets = new Map();
    const descriptions = [];
    const cursors = new Set();
    let pageNumber = 0;
    while (true) {
      onPage(++pageNumber);
      const data = await readJson(url.toString());
      if (data?.success !== 1 && data?.success !== true) throw new Error('Steam could not load this inventory. Check login and inventory privacy.');
      if (!Array.isArray(data.assets || []) || !Array.isArray(data.descriptions || [])) throw new Error('Steam returned invalid inventory data.');
      for (const asset of data.assets || []) assets.set(String(asset.assetid), asset);
      descriptions.push(...(data.descriptions || []));
      if (!data.more_items) break;
      const cursor = String(data.last_assetid || '');
      if (!/^\d+$/.test(cursor) || cursors.has(cursor)) throw new Error('Steam returned an invalid inventory pagination cursor.');
      cursors.add(cursor);
      url.searchParams.set('start_assetid', cursor);
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    return SGC.inventory.join(Array.from(assets.values()), descriptions);
  }

  async function getGooValue(item) {
    const params = item.gooParams;
    if (!params || !Number.isSafeInteger(params.appid) || params.appid < 1 ||
        !Number.isSafeInteger(params.item_type) || params.item_type < 0 ||
        !Number.isSafeInteger(params.border_color) || params.border_color < 0) throw new Error('Invalid item gem parameters.');
    const url = new URL('/auction/ajaxgetgoovalueforitemtype/', 'https://steamcommunity.com');
    for (const key of ['appid', 'item_type', 'border_color']) url.searchParams.set(key, String(params[key]));
    const data = await readJson(url.toString());
    const gooValue = Number(data?.goo_value);
    const appId = Number(item.description?.market_fee_app || item.market_fee_app || data?.item_appid || params.appid);
    if (data?.goo_value == null || !Number.isSafeInteger(gooValue) || gooValue < 0 ||
        !Number.isSafeInteger(appId) || appId < 1) throw new Error('Steam returned an invalid gem value.');
    return { gooValue, appId };
  }

  async function grindIntoGoo(item, sessionId, gooValue, appId, profileBaseUrl) {
    if (!/^\d+$/.test(item.assetid) || item.contextid !== '6') throw new Error('Invalid inventory asset.');
    const body = new URLSearchParams({
      sessionid: sessionId, appid: String(appId), assetid: item.assetid,
      contextid: item.contextid, goo_value_expected: String(gooValue)
    });
    const data = await readJson(`${profileBaseUrl}ajaxgrindintogoo/`, {
      method: 'POST', redirect: 'manual',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString()
    });
    if (data?.success !== 1 && data?.success !== true) throw new Error('Steam did not convert this item. Reload inventory before retrying.');
  }

  SGC.api = { getSessionId, fetchInventory, getGooValue, grindIntoGoo };
})();
