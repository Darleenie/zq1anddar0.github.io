// ============================================================
// SMARTTHINGS API  (direct browser call — CORS supported)
// ============================================================
const ST_API = 'https://api.smartthings.com/v1';

function getPAT() { return localStorage.getItem('smarthome_st_pat') || ''; }
function setPAT(t) { localStorage.setItem('smarthome_st_pat', t.trim()); }
function clearStoredPAT() { localStorage.removeItem('smarthome_st_pat'); }

async function stFetch(path, options = {}) {
  const res = await fetch(`${ST_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${getPAT()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SmartThings ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

// ============================================================
// ALEXA API  (proxied through local Express server)
// ============================================================
async function alexaFetch(path, options = {}) {
  const res = await fetch(`/api/alexa${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Alexa ${res.status}`);
  }
  return res.json();
}

// ============================================================
// DEVICE ICONS
// ============================================================
const CATEGORY_ICONS = {
  Light:       'fa-lightbulb',
  SmartPlug:   'fa-plug',
  Switch:      'fa-toggle-on',
  Thermostat:  'fa-thermometer-half',
  Fan:         'fa-fan',
  Lock:        'fa-lock',
  Camera:      'fa-video',
  Sensor:      'fa-satellite-dish',
  Speaker:     'fa-volume-up',
  TV:          'fa-tv',
  AirPurifier: 'fa-wind',
  WaterValve:  'fa-tint',
  // Alexa device types
  LIGHT:       'fa-lightbulb',
  SMARTPLUG:   'fa-plug',
  SWITCH:      'fa-toggle-on',
  THERMOSTAT:  'fa-thermometer-half',
  FAN:         'fa-fan',
  LOCK:        'fa-lock',
  CAMERA:      'fa-video',
};

function deviceIcon(device) {
  const cat = device._category || '';
  return CATEGORY_ICONS[cat] || 'fa-home';
}

// ============================================================
// STATE
// ============================================================
let allRooms   = [];
let allDevices = []; // normalised — both SmartThings + Alexa
let activeRoom = null;
let alexaConfigured = false;

// ============================================================
// LOAD  (SmartThings + Alexa in parallel)
// ============================================================
async function loadDevices() {
  if (!getPAT()) { showAuthBanner(); return; }

  setLoading(true);
  hideAuthBanner();

  const [stResult, _alexaResult] = await Promise.allSettled([
    loadSTDevices(),
    loadAlexaDevices(),
  ]);

  // Surface ST errors (Alexa errors are non-fatal — shown in platform badge)
  if (stResult.status === 'rejected') {
    setLoading(false);
    showError(stResult.reason.message);
    if (/401|403/.test(stResult.reason.message)) showAuthBanner(true);
    return;
  }

  document.getElementById('platformRow').style.display = '';
  updateAlexaBadge();
  renderRoomTabs();
  renderDevices();
  setLoading(false);
}

async function loadSTDevices() {
  const { items: locations } = await stFetch('/locations');
  if (!locations?.length) throw new Error('No SmartThings locations found.');
  const locationId = locations[0].locationId;

  const [{ items: rooms }, { items: devices }] = await Promise.all([
    stFetch(`/locations/${locationId}/rooms`),
    stFetch(`/devices?locationId=${locationId}`),
  ]);

  const switchDevices = (devices || []).filter(d =>
    d.components?.some(c => c.capabilities?.some(cap => cap.id === 'switch'))
  );

  const statuses = await Promise.all(
    switchDevices.map(d => stFetch(`/devices/${d.deviceId}/status`).catch(() => null))
  );

  const stNormalised = switchDevices.map((d, i) => ({
    deviceId:  d.deviceId,
    label:     d.label || d.name,
    _category: d.components?.[0]?.categories?.[0]?.name || 'Switch',
    _on:       statuses[i]?.components?.main?.switch?.switch?.value === 'on',
    _source:   'st',
    roomId:    d.roomId || null,
  }));

  allRooms = rooms || [];
  // Replace only ST devices (keep existing Alexa devices)
  allDevices = [
    ...allDevices.filter(d => d._source === 'alexa'),
    ...stNormalised,
  ];

  // Set initial tab
  const roomsWithDevices = allRooms.filter(r => allDevices.some(d => d.roomId === r.roomId));
  if (!activeRoom) activeRoom = roomsWithDevices[0]?.roomId || (alexaConfigured ? 'alexa' : 'unassigned');
}

async function loadAlexaDevices() {
  const status = await alexaFetch('/status');
  alexaConfigured = status.configured;
  if (!status.ready) {
    if (status.configured) console.warn('Alexa configured but not ready:', status.error);
    return;
  }

  const result = await alexaFetch('/devices');
  const rawDevices = result?.devices || result?.entityList || [];

  const controllable = rawDevices.filter(d =>
    d.supportedOperations?.some(op => /turn/i.test(op))
  );

  const alexaNormalised = controllable.map(d => ({
    deviceId:  d.entityId,
    label:     d.displayName || d.friendlyName || d.entityId,
    _category: d.deviceType || 'Switch',
    _on:       null, // Alexa API doesn't return current state on list call
    _source:   'alexa',
    roomId:    null, // shown in the Alexa tab
  }));

  // Replace only Alexa devices
  allDevices = [
    ...allDevices.filter(d => d._source === 'st'),
    ...alexaNormalised,
  ];
}

// ============================================================
// TOGGLE  (routes to correct API based on device source)
// ============================================================
async function toggleDevice(deviceId) {
  const device = allDevices.find(d => d.deviceId === deviceId);
  if (!device) return;

  const newState = device._on === null ? true : !device._on;
  const command  = newState ? 'on' : 'off';

  device._on = newState;
  updateToggleUI(deviceId, newState, true);

  try {
    if (device._source === 'alexa') {
      await alexaFetch(`/devices/${encodeURIComponent(deviceId)}/command`, {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
    } else {
      await stFetch(`/devices/${deviceId}/commands`, {
        method: 'POST',
        body: JSON.stringify({
          commands: [{ component: 'main', capability: 'switch', command }],
        }),
      });
    }
    updateToggleUI(deviceId, newState, false);
  } catch (err) {
    device._on = !newState;
    updateToggleUI(deviceId, !newState, false);
    showToast(`Failed to toggle ${device.label}: ${err.message}`, true);
  }
}

function updateToggleUI(deviceId, isOn, loading) {
  const card = document.querySelector(`[data-device-id="${deviceId}"]`);
  if (!card) return;
  const tog = card.querySelector('.sh-toggle');
  if (tog) {
    tog.classList.toggle('on', isOn);
    tog.classList.toggle('toggling', loading);
  }
  const lbl = card.querySelector('.sh-device-state');
  if (lbl) lbl.textContent = isOn ? 'On' : 'Off';
  card.classList.toggle('sh-card-on', isOn);
}

// ============================================================
// RENDER
// ============================================================
function renderRoomTabs() {
  const tabs = document.getElementById('roomTabs');
  if (!tabs) return;

  const roomsWithDevices = allRooms.filter(r =>
    allDevices.some(d => d._source === 'st' && d.roomId === r.roomId)
  );
  const unassignedST  = allDevices.filter(d => d._source === 'st' && !d.roomId);
  const alexaDevices  = allDevices.filter(d => d._source === 'alexa');

  const tabItems = [
    ...roomsWithDevices.map(r => ({ id: r.roomId,     label: r.name,  count: allDevices.filter(d => d.roomId === r.roomId).length })),
    ...(unassignedST.length  ? [{ id: 'unassigned', label: 'Other',  count: unassignedST.length }] : []),
    ...(alexaDevices.length   ? [{ id: 'alexa',      label: 'Alexa',  count: alexaDevices.length, isAlexa: true }] : []),
  ];

  if (tabItems.length === 0) { tabs.style.display = 'none'; return; }

  // Default active tab
  if (!activeRoom || !tabItems.find(t => t.id === activeRoom)) {
    activeRoom = tabItems[0].id;
  }

  tabs.style.display = '';
  tabs.innerHTML = tabItems.map(t => `
    <button class="sh-room-tab ${t.id === activeRoom ? 'active' : ''} ${t.isAlexa ? 'sh-tab-alexa' : ''}"
            data-room="${t.id}" onclick="setActiveRoom('${t.id}')">
      ${t.isAlexa ? '<i class="fab fa-amazon"></i> ' : ''}${t.label}
      <span class="sh-room-count">${t.count}</span>
    </button>
  `).join('');
}

function setActiveRoom(roomId) {
  activeRoom = roomId;
  document.querySelectorAll('.sh-room-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.room === roomId)
  );
  renderDevices();
}

function renderDevices() {
  const area = document.getElementById('deviceArea');

  let devices;
  if (activeRoom === 'alexa') {
    devices = allDevices.filter(d => d._source === 'alexa');
  } else if (activeRoom === 'unassigned') {
    devices = allDevices.filter(d => d._source === 'st' && !d.roomId);
  } else {
    devices = allDevices.filter(d => d.roomId === activeRoom);
  }

  if (devices.length === 0) {
    area.innerHTML = `<div class="sh-empty"><i class="fas fa-plug"></i><p>No controllable devices in this room.</p></div>`;
    return;
  }

  area.innerHTML = `<div class="sh-device-grid">${devices.map(d => deviceCard(d)).join('')}</div>`;
}

function deviceCard(device) {
  const icon  = deviceIcon(device);
  const isOn  = device._on;
  const stateLabel = isOn === null ? '—' : isOn ? 'On' : 'Off';
  const sourceBadge = device._source === 'alexa'
    ? `<span class="sh-source-badge sh-badge-alexa"><i class="fab fa-amazon"></i></span>`
    : '';
  return `
    <div class="sh-device-card ${isOn ? 'sh-card-on' : ''}" data-device-id="${device.deviceId}">
      <div class="sh-device-icon">
        <i class="fas ${icon}"></i>
      </div>
      <div class="sh-device-body">
        <div class="sh-device-name-row">
          <span class="sh-device-name">${device.label}</span>
          ${sourceBadge}
        </div>
        <span class="sh-device-type">${device._category}</span>
      </div>
      <div class="sh-device-control">
        <span class="sh-device-state">${stateLabel}</span>
        <div class="sh-toggle ${isOn ? 'on' : ''}" onclick="toggleDevice('${device.deviceId}')">
          <div class="sh-toggle-dot"></div>
        </div>
      </div>
    </div>
  `;
}

function updateAlexaBadge() {
  const row = document.getElementById('platformRow');
  if (!row) return;
  const alexaBadge = row.querySelector('.sh-platform-alexa');
  if (!alexaBadge) return;
  const alexaCount = allDevices.filter(d => d._source === 'alexa').length;
  if (alexaConfigured && alexaCount > 0) {
    alexaBadge.className = 'sh-platform-badge sh-platform-alexa sh-platform-active';
    alexaBadge.innerHTML = `<i class="fas fa-check-circle"></i> Alexa (${alexaCount})`;
  } else if (alexaConfigured) {
    alexaBadge.className = 'sh-platform-badge sh-platform-alexa sh-platform-warn';
    alexaBadge.innerHTML = `<i class="fas fa-exclamation-circle"></i> Alexa`;
    alexaBadge.title = 'Alexa configured but no controllable devices found';
  }
}

// ============================================================
// UI HELPERS
// ============================================================
function setLoading(on) {
  const btn = document.getElementById('refreshBtn');
  if (btn) { btn.classList.toggle('spinning', on); btn.disabled = on; }
  if (on) {
    document.getElementById('deviceArea').innerHTML = `
      <div class="sh-empty">
        <i class="fas fa-spinner fa-spin"></i>
        <p>Loading devices…</p>
      </div>`;
  }
}

function showError(msg) {
  document.getElementById('deviceArea').innerHTML = `
    <div class="sh-empty sh-empty-error">
      <i class="fas fa-exclamation-circle"></i>
      <p>${msg}</p>
      <button class="sh-btn-connect" onclick="loadDevices()">Retry</button>
    </div>`;
}

function showAuthBanner(invalid = false) {
  const banner = document.getElementById('authBanner');
  if (!banner) return;
  banner.style.display = '';
  if (invalid) {
    banner.querySelector('strong').textContent = 'Invalid SmartThings Token';
    banner.querySelector('p').textContent = 'Your token was rejected. Please update it in Settings.';
  }
  document.getElementById('deviceArea').innerHTML = `
    <div class="sh-empty"><i class="fas fa-home"></i><p>Connect SmartThings to get started.</p></div>`;
  document.getElementById('roomTabs').style.display = 'none';
  document.getElementById('platformRow').style.display = 'none';
}

function hideAuthBanner() {
  const banner = document.getElementById('authBanner');
  if (banner) banner.style.display = 'none';
}

function showToast(msg, isError = false) {
  const existing = document.getElementById('appToast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'appToast';
  toast.className = `toast${isError ? ' toast-error' : ''}`;
  toast.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i> ${msg}`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3000);
}

// ============================================================
// SETTINGS MODAL
// ============================================================
function openSettings() {
  const input = document.getElementById('stPATInput');
  if (input) input.value = getPAT();
  document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function savePAT() {
  const val = document.getElementById('stPATInput').value.trim();
  if (!val) { showToast('Please enter a token first.', true); return; }
  setPAT(val);
  closeSettings();
  loadDevices();
}

function clearPAT() {
  clearStoredPAT();
  document.getElementById('stPATInput').value = '';
  closeSettings();
  showAuthBanner();
}

function togglePATVis() {
  const input = document.getElementById('stPATInput');
  const icon  = document.getElementById('patEyeIcon');
  const show  = input.type === 'password';
  input.type     = show ? 'text' : 'password';
  icon.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  if (getPAT()) {
    loadDevices();
  } else {
    showAuthBanner();
  }

  document.getElementById('settingsModal').addEventListener('click', e => {
    if (e.target === document.getElementById('settingsModal')) closeSettings();
  });
});
