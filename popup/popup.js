'use strict';
let tabId;
const status = document.querySelector('#status');

async function send(type, payload = {}) {
  const response = await chrome.tabs.sendMessage(tabId, { type, ...payload });
  if (!response?.ok) throw new Error(response?.error || 'Inventory runtime is unavailable.');
  return response.snapshot;
}

function render(snapshot) {
  const inventory = snapshot.inventory;
  status.textContent = inventory.error || (inventory.status === 'idle' ? 'Ready. Load your inventory to begin.' : `Inventory ${inventory.status}.`);
  document.querySelector('#load').disabled = inventory.status === 'loading';
  document.querySelector('#counts').textContent = `Inventory: ${inventory.totalCount} · Gemmable: ${inventory.gemmableCount}`;
}

async function refresh() {
  render(await send('SGC_GET_SNAPSHOT'));
}

async function command(type, payload = {}) {
  try {
    render(await send(type, payload));
    if (type === 'SGC_LOAD_INVENTORY') {
      while (document.querySelector('#load').disabled) {
        await new Promise(resolve => setTimeout(resolve, 500));
        await refresh();
      }
    }
  } catch (error) {
    status.textContent = error.message;
  }
}

document.querySelector('#load').addEventListener('click', () => void command('SGC_LOAD_INVENTORY'));

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
