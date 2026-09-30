'use strict';
let tabId;
const status = document.querySelector('#status');

async function send(type, payload = {}) {
  const response = await chrome.tabs.sendMessage(tabId, { type, ...payload });
  if (!response?.ok) throw new Error(response?.error || 'Inventory runtime is unavailable.');
  return response.snapshot;
}

function updateOptions(select, options, value) {
  const key = JSON.stringify(options);
  if (select.dataset.options !== key) {
    select.replaceChildren(...options.map(option => {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      return node;
    }));
    select.dataset.options = key;
  }
  select.value = value == null ? '' : String(value);
}

function render(snapshot) {
  const inventory = snapshot.inventory;
  status.textContent = inventory.error || (inventory.status === 'idle' ? 'Ready. Load your inventory to begin.' : `Inventory ${inventory.status}.`);
  document.querySelector('#load').disabled = inventory.status === 'loading';
  document.querySelector('#counts').textContent = `Inventory: ${inventory.totalCount} · Gemmable: ${inventory.gemmableCount}`;
  const game = document.querySelector('#game');
  updateOptions(game, inventory.games.map(g => ({ value: String(g.appId), label: `${g.name} · ${g.count} items` })), snapshot.selection.appId);
  game.disabled = inventory.status !== 'loaded' || !inventory.games.length;
  document.querySelector('#filter-enabled').checked = snapshot.selection.filterEnabled;
  document.querySelector('#filter-enabled').disabled = game.disabled;
  document.querySelector('#filter-controls').hidden = !snapshot.selection.filterEnabled;
  const filter = document.querySelector('#filter-value');
  updateOptions(filter, snapshot.filterOptions.map(option => ({ value: option.key, label: `${option.label} · ${option.count} items` })), snapshot.selection.filterKey);
  filter.disabled = game.disabled || !snapshot.selection.filterEnabled;
  document.querySelector('#filter-mode').value = snapshot.selection.filterMode;
  document.querySelector('#filter-mode').disabled = filter.disabled;
  document.querySelector('#selection-count').textContent = `Selected: ${snapshot.plan.candidateCount}`;
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
document.querySelector('#game').addEventListener('change', event => void command('SGC_SET_SELECTION', { selection: { appId: Number(event.target.value) } }));
document.querySelector('#filter-enabled').addEventListener('change', event => void command('SGC_SET_SELECTION', { selection: { filterEnabled: event.target.checked } }));
document.querySelector('#filter-value').addEventListener('change', event => void command('SGC_SET_SELECTION', { selection: { filterKey: event.target.value } }));
document.querySelector('#filter-mode').addEventListener('change', event => void command('SGC_SET_SELECTION', { selection: { filterMode: event.target.value } }));

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
