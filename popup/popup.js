'use strict';
let tabId;
const status = document.querySelector('#status');

async function send(type, payload = {}) {
  const response = await chrome.tabs.sendMessage(tabId, { type, ...payload });
  if (!response?.ok) throw new Error(response?.error || 'Inventory runtime is unavailable.');
  return response.snapshot;
}

function render(snapshot) {
  status.textContent = `Ready on Steam inventory ${snapshot.page.steamId}.`;
}

async function refresh() {
  render(await send('SGC_GET_SNAPSHOT'));
}

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Open your Steam Community inventory.');
    tabId = tab.id;
    await refresh();
  } catch (error) {
    status.textContent = error.message.includes('Receiving end does not exist')
      ? 'Open your Steam inventory. If it is already open, refresh the tab after installing the extension.'
      : error.message;
  }
}

void init();
