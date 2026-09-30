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
    const data = await readJson(url.toString());
    if (data?.success !== 1 && data?.success !== true) throw new Error('Steam could not load this inventory. Check login and inventory privacy.');
    if (!Array.isArray(data.assets || []) || !Array.isArray(data.descriptions || [])) throw new Error('Steam returned invalid inventory data.');
    return SGC.inventory.join(data.assets || [], data.descriptions || []);
  }

  SGC.api = { getSessionId, fetchInventory };
})();
