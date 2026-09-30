(() => {
  'use strict';
  const state = {
    page: null,
    inventory: { status: 'idle', error: null, allItems: [], gemmableItems: [], games: [] },
    selection: { appId: null, filterEnabled: false, filterMode: 'item', filterKey: null },
    config: { delayMs: 50, maxItems: 1000 },
    planId: crypto.randomUUID(),
    job: { status: 'idle', total: 0, processed: 0, success: 0, failed: 0, currentItem: null, error: null }
  };
  const commandFields = {
    SGC_PING: [], SGC_GET_SNAPSHOT: [], SGC_LOAD_INVENTORY: [],
    SGC_SET_SELECTION: ['selection'], SGC_SET_CONFIG: ['config'],
    SGC_START_CONVERSION: ['confirmed', 'planId'], SGC_CANCEL_CONVERSION: []
  };
  let endDelay = null;

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

  function getCandidates() {
    return state.inventory.gemmableItems.filter(item =>
      item.gooAppId === state.selection.appId &&
      (!state.selection.filterEnabled || (state.selection.filterMode === 'type' ? item.typeKey : item.itemKey) === state.selection.filterKey));
  }

  function getFilterOptions(selection = state.selection) {
    return SGC.inventory.filterGroups(state.inventory.gemmableItems.filter(item => item.gooAppId === selection.appId), selection.filterMode);
  }

  function rebuildSelection() {
    state.inventory.games = SGC.inventory.games(state.inventory.gemmableItems);
    if (!state.inventory.games.some(game => game.appId === state.selection.appId)) {
      state.selection.appId = state.inventory.games[0]?.appId || null;
    }
    const options = getFilterOptions();
    if (!options.some(option => option.key === state.selection.filterKey)) state.selection.filterKey = options[0]?.key || null;
  }

  function isRunning() {
    return state.job.status === 'running' || state.job.status === 'stopping';
  }

  function validateConfig(config) {
    if (!Number.isInteger(config.delayMs) || config.delayMs < 0 || config.delayMs > 2147483647 ||
        (config.maxItems !== null && (!Number.isSafeInteger(config.maxItems) || config.maxItems < 1))) {
      throw new Error('Delay must be a nonnegative integer; max items must be a positive integer or blank for no limit.');
    }
  }

  function snapshot() {
    const candidateCount = getCandidates().length;
    return {
      page: { ready: Boolean(state.page), steamId: state.page?.steamId },
      inventory: {
        status: state.inventory.status,
        error: state.inventory.error,
        totalCount: state.inventory.allItems.length,
        gemmableCount: state.inventory.gemmableItems.length,
        games: state.inventory.games
      },
      selection: { ...state.selection },
      filterOptions: getFilterOptions(),
      config: { ...state.config },
      job: { ...state.job },
      plan: { id: state.planId, candidateCount, plannedCount: Math.min(candidateCount, state.config.maxItems ?? Infinity) }
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
      rebuildSelection();
      state.planId = crypto.randomUUID();
    } catch (error) {
      state.inventory.status = 'error';
      state.inventory.error = error.message;
    }
  }

  async function runConvert(candidates, sessionId) {
    const converted = new Set();
    const job = state.job = {
      status: 'running', total: candidates.length, processed: 0, success: 0,
      failed: 0, currentItem: null, error: null,
      startedAt: Date.now(), finishedAt: null, cancelRequested: false
    };
    try {
      for (const item of candidates) {
        if (job.cancelRequested) break;
        job.currentItem = item.itemName;
        try {
          const { gooValue, appId } = await SGC.api.getGooValue(item);
          await SGC.api.grindIntoGoo(item, sessionId, gooValue, appId, state.page.profileBaseUrl);
          job.success++;
          converted.add(item.assetid);
        } catch (error) {
          job.failed++;
          job.error = error.message;
        }
        job.processed++;
        job.currentItem = null;
        if (job.processed < job.total && !job.cancelRequested) {
          await new Promise(resolve => {
            const timeout = setTimeout(resolve, state.config.delayMs);
            endDelay = () => { clearTimeout(timeout); resolve(); };
          });
          endDelay = null;
        }
      }
      job.status = 'completed';
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
    } finally {
      job.currentItem = null;
      job.finishedAt = Date.now();
      if (converted.size) {
        state.inventory.allItems = state.inventory.allItems.filter(item => !converted.has(item.assetid));
        state.inventory.gemmableItems = state.inventory.gemmableItems.filter(item => !converted.has(item.assetid));
        rebuildSelection();
      }
      state.planId = crypto.randomUUID();
    }
  }

  async function handle(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || !Object.hasOwn(commandFields, message.type)) throw new Error('Invalid command.');
    if (Object.keys(message).some(key => key !== 'type' && !commandFields[message.type].includes(key))) throw new Error('Invalid command payload.');
    switch (message.type) {
      case 'SGC_PING':
      case 'SGC_GET_SNAPSHOT':
        if (!state.page) await getPage();
        return snapshot();
      case 'SGC_LOAD_INVENTORY':
        if (state.inventory.status === 'loading' || isRunning()) throw new Error('Wait for the current operation to finish.');
        state.inventory = { status: 'loading', error: null, allItems: [], gemmableItems: [], games: [] };
        void loadInventory();
        return snapshot();
      case 'SGC_SET_SELECTION': {
        if (state.inventory.status !== 'loaded') throw new Error('Load your inventory first.');
        if (isRunning()) throw new Error('Wait for conversion to finish.');
        const patch = message.selection;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['appId', 'filterEnabled', 'filterMode', 'filterKey'].includes(key))) throw new Error('Invalid selection.');
        const selection = { ...state.selection, ...patch };
        if (!Number.isSafeInteger(selection.appId) || !state.inventory.games.some(game => game.appId === selection.appId) ||
            typeof selection.filterEnabled !== 'boolean' || !['item', 'type'].includes(selection.filterMode) ||
            (selection.filterKey !== null && typeof selection.filterKey !== 'string')) throw new Error('Invalid selection.');
        if ((selection.appId !== state.selection.appId || selection.filterMode !== state.selection.filterMode) && !('filterKey' in patch)) selection.filterKey = null;
        const options = getFilterOptions(selection);
        if (selection.filterKey !== null && !options.some(option => option.key === selection.filterKey)) throw new Error('Select a valid item.');
        selection.filterKey ??= options[0]?.key || null;
        state.selection = selection;
        state.planId = crypto.randomUUID();
        return snapshot();
      }
      case 'SGC_SET_CONFIG': {
        if (isRunning()) throw new Error('Wait for conversion to finish.');
        const patch = message.config;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['delayMs', 'maxItems'].includes(key))) throw new Error('Invalid settings.');
        const config = { ...state.config, ...patch };
        validateConfig(config);
        state.config = config;
        state.planId = crypto.randomUUID();
        return snapshot();
      }
      case 'SGC_START_CONVERSION': {
        if (state.inventory.status !== 'loaded' || isRunning()) throw new Error('Load inventory and wait for the current operation to finish.');
        if (message.confirmed !== true || typeof message.planId !== 'string' || message.planId !== state.planId) throw new Error('Review and confirm the current selection before converting.');
        const candidates = getCandidates().slice(0, state.config.maxItems ?? Infinity);
        if (!candidates.length) throw new Error('No matching items to convert.');
        const sessionId = SGC.api.getSessionId();
        state.planId = crypto.randomUUID();
        void runConvert(candidates, sessionId);
        return snapshot();
      }
      case 'SGC_CANCEL_CONVERSION':
        if (!isRunning()) throw new Error('No conversion is running.');
        state.job.cancelRequested = true;
        state.job.status = 'stopping';
        endDelay?.();
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
