'use strict';
let tabId;
const status = document.querySelector('#status');
const dialog = document.querySelector('#confirmation');
let confirmedPlanId = null;

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
  const running = snapshot.job.status === 'running' || snapshot.job.status === 'stopping';
  status.textContent = inventory.error || (snapshot.job.status !== 'idle'
    ? `Conversion ${snapshot.job.cancelRequested && snapshot.job.status === 'completed' ? 'stopped' : snapshot.job.status}: ${snapshot.job.success} successful, ${snapshot.job.failed} failed.`
    : inventory.status === 'idle' ? 'Ready. Load your inventory to begin.' : `Inventory ${inventory.status}.`);
  document.querySelector('#load').disabled = inventory.status === 'loading' || running;
  document.querySelector('#counts').textContent = `Inventory: ${inventory.totalCount} · Gemmable: ${inventory.gemmableCount}`;
  const game = document.querySelector('#game');
  updateOptions(game, inventory.games.map(g => ({ value: String(g.appId), label: `${g.name} · ${g.count} items` })), snapshot.selection.appId);
  game.disabled = inventory.status !== 'loaded' || !inventory.games.length || running;
  document.querySelector('#filter-enabled').checked = snapshot.selection.filterEnabled;
  document.querySelector('#filter-enabled').disabled = game.disabled;
  document.querySelector('#filter-controls').hidden = !snapshot.selection.filterEnabled;
  const filter = document.querySelector('#filter-value');
  updateOptions(filter, snapshot.filterOptions.map(option => ({ value: option.key, label: `${option.label} · ${option.count} items` })), snapshot.selection.filterKey);
  filter.disabled = game.disabled || !snapshot.selection.filterEnabled;
  document.querySelector('#filter-mode').value = snapshot.selection.filterMode;
  document.querySelector('#filter-mode').disabled = filter.disabled;
  document.querySelector('#selection-count').textContent = `Selected: ${snapshot.plan.candidateCount} · Planned: ${snapshot.plan.plannedCount}`;
  const delay = document.querySelector('#delay');
  const maxItems = document.querySelector('#max-items');
  delay.disabled = running;
  maxItems.disabled = running;
  if (document.activeElement !== delay) delay.value = snapshot.config.delayMs;
  if (document.activeElement !== maxItems) maxItems.value = snapshot.config.maxItems ?? '';
  document.querySelector('#convert').disabled = inventory.status !== 'loaded' || running || snapshot.plan.plannedCount === 0;
  document.querySelector('#stop').disabled = snapshot.job.status !== 'running';
  if (dialog.open && confirmedPlanId !== snapshot.plan.id) dialog.close();
}

async function refresh() {
  render(await send('SGC_GET_SNAPSHOT'));
}

async function command(type, payload = {}) {
  try {
    const snapshot = await send(type, payload);
    render(snapshot);
    if (type === 'SGC_LOAD_INVENTORY' || type === 'SGC_START_CONVERSION') {
      while (document.querySelector('#load').disabled) {
        await new Promise(resolve => setTimeout(resolve, 500));
        await refresh();
      }
    }
    return snapshot;
  } catch (error) {
    status.textContent = error.message;
  }
}

document.querySelector('#load').addEventListener('click', () => void command('SGC_LOAD_INVENTORY'));
document.querySelector('#game').addEventListener('change', event => void command('SGC_SET_SELECTION', { selection: { appId: Number(event.target.value) } }));
document.querySelector('#filter-enabled').addEventListener('change', event => void command('SGC_SET_SELECTION', { selection: { filterEnabled: event.target.checked } }));
document.querySelector('#filter-value').addEventListener('change', event => void command('SGC_SET_SELECTION', { selection: { filterKey: event.target.value } }));
document.querySelector('#filter-mode').addEventListener('change', event => void command('SGC_SET_SELECTION', { selection: { filterMode: event.target.value } }));

async function setConfig() {
  const delay = document.querySelector('#delay');
  const maxItems = document.querySelector('#max-items');
  if (!delay.checkValidity() || !maxItems.checkValidity()) {
    status.textContent = 'Enter a valid delay and a positive max items value, or leave max items blank.';
    return;
  }
  return command('SGC_SET_CONFIG', { config: { delayMs: Number(delay.value), maxItems: maxItems.value === '' ? null : Number(maxItems.value) } });
}

document.querySelector('#delay').addEventListener('change', () => void setConfig());
document.querySelector('#max-items').addEventListener('change', () => void setConfig());

async function showConfirmation() {
  const snapshot = await setConfig();
  if (!snapshot || snapshot.plan.plannedCount === 0) return;
  const game = snapshot.inventory.games.find(game => game.appId === snapshot.selection.appId);
  const filter = snapshot.selection.filterEnabled ? snapshot.filterOptions.find(option => option.key === snapshot.selection.filterKey)?.label : 'Off';
  document.querySelector('#confirm-summary').textContent = [
    `Game: ${game?.name}`, `Items: ${snapshot.plan.plannedCount}`,
    `Filter: ${filter}`, `Delay: ${snapshot.config.delayMs} ms`,
    `Limit: ${snapshot.config.maxItems ?? 'No limit'}`
  ].join('\n');
  confirmedPlanId = snapshot.plan.id;
  document.querySelector('#confirm-convert').textContent = `Convert ${snapshot.plan.plannedCount} items`;
  dialog.showModal();
}

document.querySelector('#convert').addEventListener('click', () => void showConfirmation());
document.querySelector('#confirm-convert').addEventListener('click', () => {
  const planId = confirmedPlanId;
  confirmedPlanId = null;
  dialog.close();
  if (planId) void command('SGC_START_CONVERSION', { confirmed: true, planId });
});
dialog.addEventListener('close', () => { confirmedPlanId = null; });
document.querySelector('#stop').addEventListener('click', () => void command('SGC_CANCEL_CONVERSION'));

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
