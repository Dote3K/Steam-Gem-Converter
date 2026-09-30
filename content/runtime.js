(() => {
  'use strict';
  const state = {
    page: null,
    inventory: { status: 'idle', error: null, allItems: [], gemmableItems: [] }
  };

  async function getPage() {
    const match = location.pathname.match(/^\/(profiles\/\d{17}|id\/[^/]+)\/inventory\/?$/);
    if (location.origin !== 'https://steamcommunity.com' || !match) {
      throw new Error('Open a Steam Community inventory page.');
    }
    let steamId = match[1].startsWith('profiles/') ? match[1].slice(9) : null;
    if (!steamId) {
      steamId = await new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const timeout = setTimeout(() => {
          window.removeEventListener('message', receive);
          reject(new Error('Could not detect SteamID. Refresh your Steam inventory and try again.'));
        }, 2000);
        function receive(event) {
          if (event.source !== window || event.origin !== location.origin) return;
          const data = event.data;
          if (data?.type !== 'SGC_PAGE_CONTEXT' || data.requestId !== requestId) return;
          clearTimeout(timeout);
          window.removeEventListener('message', receive);
          if (!/^\d{17}$/.test(data.steamId)) {
            reject(new Error('Steam did not provide a valid SteamID. Open your inventory and try again.'));
          } else {
            resolve(data.steamId);
          }
        }
        window.addEventListener('message', receive);
        window.postMessage({ type: 'SGC_REQUEST_PAGE_CONTEXT', requestId }, location.origin);
      });
    }
    state.page = { steamId, profileBaseUrl: `${location.origin}/${match[1]}/` };
    return state.page;
  }

  function snapshot() {
    return {
      page: { ready: Boolean(state.page), steamId: state.page?.steamId },
      inventory: {
        status: state.inventory.status,
        error: state.inventory.error,
        totalCount: state.inventory.allItems.length,
        gemmableCount: state.inventory.gemmableItems.length
      }
    };
  }

  async function loadInventory() {
    try {
      const page = state.page || await getPage();
      SGC.api.getSessionId();
      const items = await SGC.api.fetchInventory(page.steamId);
      state.inventory.allItems = items;
      state.inventory.gemmableItems = items.filter(SGC.inventory.canTurnIntoGems);
      state.inventory.status = 'loaded';
    } catch (error) {
      state.inventory.status = 'error';
      state.inventory.error = error.message;
    }
  }

  async function handle(message) {
    if (!message || typeof message !== 'object') throw new Error('Invalid command.');
    switch (message.type) {
      case 'SGC_PING':
      case 'SGC_GET_SNAPSHOT':
        if (!state.page) await getPage();
        return snapshot();
      case 'SGC_LOAD_INVENTORY':
        if (state.inventory.status === 'loading') throw new Error('Inventory is already loading.');
        state.inventory = { status: 'loading', error: null, allItems: [], gemmableItems: [] };
        void loadInventory();
        return snapshot();
      default:
        throw new Error('Unknown command.');
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup/popup.html')) return;
    handle(message).then(snapshot => sendResponse({ ok: true, snapshot }), error => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  });
})();
