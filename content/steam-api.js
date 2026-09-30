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

  async function fetchInventory(steamId) {
    const url = new URL(`/inventory/${steamId}/753/6`, 'https://steamcommunity.com');
    url.searchParams.set('l', 'english');
    url.searchParams.set('count', '2000');
    const assets = new Map();
    const descriptions = [];
    const cursors = new Set();
    while (true) {
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

  SGC.api = { getSessionId, fetchInventory };
})();
