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
// GOVEE API  (proxied through the server — key stays there)
// ============================================================
async function goveeApi(path, options = {}) {
  const res = await fetch(`/api/govee${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Govee ${res.status}`);
  }
  return res.json();
}

// ============================================================
// DEVICE ICONS
// ============================================================
const CATEGORY_ICONS = {
  // SmartThings categories
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
  // Govee device types (devices.types.* with prefix stripped)
  light:          'fa-lightbulb',
  socket:         'fa-plug',
  heater:         'fa-temperature-high',
  humidifier:     'fa-droplet',
  dehumidifier:   'fa-droplet-slash',
  air_purifier:   'fa-wind',
  fan:            'fa-fan',
  kettle:         'fa-mug-hot',
  thermometer:    'fa-thermometer-half',
  sensor:         'fa-satellite-dish',
  ice_maker:      'fa-cube',
  aroma_diffuser: 'fa-spray-can',
};

function deviceIcon(device) {
  const cat = device._category || '';
  return CATEGORY_ICONS[cat] || 'fa-home';
}

// Device labels are user-typed in the vendor apps — never trust them in HTML
function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// STATE
// ============================================================
let allRooms   = [];
let allDevices = []; // normalised — SmartThings + Govee
let activeRoom = null;
let goveeConfigured = false;
let stLoadError = null; // message of the last SmartThings load failure, or null

// ============================================================
// LOAD  (SmartThings + Govee in parallel)
// ============================================================
async function loadDevices() {
  setLoading(true);
  hideAuthBanner();

  const hasPAT = !!getPAT();
  const [stResult, goveeResult] = await Promise.allSettled([
    hasPAT ? loadSTDevices() : Promise.resolve(null),
    loadGoveeDevices(),
  ]);

  if (!hasPAT) allDevices = allDevices.filter(d => d._source !== 'st');

  const stError    = hasPAT && stResult.status === 'rejected' ? stResult.reason : null;
  const goveeError = goveeResult.status === 'rejected' ? goveeResult.reason : null;

  stLoadError = stError ? stError.message : null;
  setLoading(false);

  // Nothing connected at all → onboarding banner. Only when the Govee
  // status call actually SUCCEEDED with configured:false — if it failed we
  // don't know, and a Govee-only user must see the error, not onboarding.
  if (!hasPAT && !goveeConfigured && !goveeError) { showAuthBanner(); return; }

  // Everything that IS connected failed → full error state
  if (allDevices.length === 0 && (stError || goveeError)) {
    const err = stError || goveeError;
    showError(err.message);
    if (stError && /401|403/.test(stError.message)) showAuthBanner(true);
    return;
  }

  // Partial failures are non-fatal — surface as toasts
  if (stError)    showToast(`SmartThings: ${stError.message}`, true);
  if (goveeError) showToast(`Govee: ${goveeError.message}`, true);

  document.getElementById('platformRow').style.display = '';
  updatePlatformBadges();
  renderRoomTabs();
  renderDevices();
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
  // Replace only ST devices (keep Govee devices)
  allDevices = [
    ...allDevices.filter(d => d._source !== 'st'),
    ...stNormalised,
  ];
}

async function loadGoveeDevices() {
  const status = await goveeApi('/status');
  goveeConfigured = status.configured;
  if (!status.configured) {
    allDevices = allDevices.filter(d => d._source !== 'govee');
    return;
  }

  const { devices } = await goveeApi('/devices');

  // Fetch current state per device (Govee has no bulk-state call)
  const states = await Promise.all(
    (devices || []).map(d =>
      goveeApi('/state', {
        method: 'POST',
        body: JSON.stringify({ sku: d.sku, device: d.deviceId }),
      }).catch(() => null)
    )
  );

  const goveeNormalised = (devices || []).map((d, i) => ({
    deviceId:   d.deviceId,
    sku:        d.sku,
    label:      d.label,
    _category:  d.type || 'light',
    _on:        states[i]?.on ?? null,
    _online:    states[i]?.online,
    _brightness: states[i]?.brightness,
    _supportsOnOff:      d.supportsOnOff,
    _supportsBrightness: d.supportsBrightness,
    _source:    'govee',
    roomId:     null, // Govee API has no room concept — shown in the Govee tab
  }));

  // Replace only Govee devices
  allDevices = [
    ...allDevices.filter(d => d._source !== 'govee'),
    ...goveeNormalised,
  ];
}

// ============================================================
// CONTROL  (routes to correct API based on device source)
// ============================================================
async function toggleDevice(deviceId) {
  const device = allDevices.find(d => d.deviceId === deviceId);
  if (!device) return;
  if (device._source === 'govee' && device._supportsOnOff === false) {
    showToast(`${device.label} doesn't support on/off via the Govee API.`, true);
    return;
  }

  const newState = device._on === null ? true : !device._on;
  const command  = newState ? 'on' : 'off';

  device._on = newState;
  updateToggleUI(deviceId, newState, true);

  try {
    if (device._source === 'govee') {
      await goveeApi('/control', {
        method: 'POST',
        body: JSON.stringify({
          sku:     device.sku,
          device:  deviceId,
          command: { name: 'onoff', value: newState },
        }),
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
    showToast(`Failed to toggle ${escapeHTML(device.label)}: ${escapeHTML(err.message)}`, true);
  }
}

async function setGoveeBrightness(deviceId, value) {
  const device = allDevices.find(d => d.deviceId === deviceId);
  if (!device) return;
  const v = Math.max(1, Math.min(100, Number(value) || 0));

  try {
    await goveeApi('/control', {
      method: 'POST',
      body: JSON.stringify({
        sku:     device.sku,
        device:  deviceId,
        command: { name: 'brightness', value: v },
      }),
    });
    device._brightness = v;
    // Setting brightness switches most Govee lights on
    if (device._on !== true) { device._on = true; updateToggleUI(deviceId, true, false); }
    const lbl = document.querySelector(`[data-device-id="${deviceId}"] .sh-brightness-val`);
    if (lbl) lbl.textContent = `${v}%`;
  } catch (err) {
    showToast(`Brightness failed for ${escapeHTML(device.label)}: ${escapeHTML(err.message)}`, true);
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
  const unassignedST = allDevices.filter(d => d._source === 'st' && !d.roomId);
  const goveeDevices = allDevices.filter(d => d._source === 'govee');

  const tabItems = [
    ...roomsWithDevices.map(r => ({ id: r.roomId,     label: r.name,  count: allDevices.filter(d => d.roomId === r.roomId).length })),
    ...(unassignedST.length ? [{ id: 'unassigned', label: 'Other', count: unassignedST.length }] : []),
    ...(goveeDevices.length ? [{ id: 'govee',      label: 'Govee', count: goveeDevices.length, isGovee: true }] : []),
  ];

  if (tabItems.length === 0) { tabs.style.display = 'none'; return; }

  // Default active tab
  if (!activeRoom || !tabItems.find(t => t.id === activeRoom)) {
    activeRoom = tabItems[0].id;
  }

  tabs.style.display = '';
  tabs.innerHTML = tabItems.map(t => `
    <button class="sh-room-tab ${t.id === activeRoom ? 'active' : ''} ${t.isGovee ? 'sh-tab-govee' : ''}"
            data-room="${t.id}" onclick="setActiveRoom('${t.id}')">
      ${t.isGovee ? '<i class="fas fa-lightbulb"></i> ' : ''}${escapeHTML(t.label)}
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
  if (activeRoom === 'govee') {
    devices = allDevices.filter(d => d._source === 'govee');
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
  const icon    = deviceIcon(device);
  const isOn    = device._on;
  const offline = device._online === false;
  const label   = escapeHTML(device.label);
  const stateLabel = offline ? 'Offline' : isOn === null ? '—' : isOn ? 'On' : 'Off';
  const sourceBadge = device._source === 'govee'
    ? `<span class="sh-source-badge sh-badge-govee">Govee</span>`
    : '';
  const brightnessRow = device._source === 'govee' && device._supportsBrightness && !offline ? `
    <div class="sh-brightness-row">
      <i class="fas fa-sun"></i>
      <input type="range" min="1" max="100" value="${device._brightness ?? 100}"
             aria-label="Brightness for ${label}"
             onchange="setGoveeBrightness('${device.deviceId}', this.value)" />
      <span class="sh-brightness-val">${device._brightness != null ? `${device._brightness}%` : ''}</span>
    </div>` : '';

  return `
    <div class="sh-device-card ${isOn ? 'sh-card-on' : ''} ${offline ? 'sh-card-offline' : ''}" data-device-id="${device.deviceId}">
      <div class="sh-device-icon">
        <i class="fas ${icon}"></i>
      </div>
      <div class="sh-device-body">
        <div class="sh-device-name-row">
          <span class="sh-device-name">${label}</span>
          ${sourceBadge}
        </div>
        <span class="sh-device-type">${escapeHTML(device._category)}</span>
      </div>
      <div class="sh-device-control">
        <span class="sh-device-state">${stateLabel}</span>
        <div class="sh-toggle ${isOn ? 'on' : ''}" onclick="toggleDevice('${device.deviceId}')">
          <div class="sh-toggle-dot"></div>
        </div>
      </div>
      ${brightnessRow}
    </div>
  `;
}

function updatePlatformBadges() {
  const row = document.getElementById('platformRow');
  if (!row) return;

  // SmartThings badge reflects the actual load result, not just PAT presence
  const stBadge = row.querySelector('.sh-platform-st');
  if (stBadge) {
    if (!getPAT()) {
      stBadge.style.display = 'none';
    } else if (stLoadError) {
      stBadge.className = 'sh-platform-badge sh-platform-st sh-platform-warn';
      const invalid = /401|403/.test(stLoadError);
      stBadge.innerHTML = `<i class="fas fa-exclamation-circle"></i> SmartThings${invalid ? ' — token invalid' : ''}`;
      stBadge.title = stLoadError;
      stBadge.style.display = '';
    } else {
      stBadge.className = 'sh-platform-badge sh-platform-st';
      stBadge.innerHTML = `<i class="fas fa-check-circle"></i> SmartThings`;
      stBadge.title = 'SmartThings connected';
      stBadge.style.display = '';
    }
  }

  const goveeBadge = row.querySelector('.sh-platform-govee');
  if (!goveeBadge) return;
  const count = allDevices.filter(d => d._source === 'govee').length;
  if (goveeConfigured && count > 0) {
    goveeBadge.className = 'sh-platform-badge sh-platform-govee sh-platform-active';
    goveeBadge.innerHTML = `<i class="fas fa-check-circle"></i> Govee (${count})`;
    goveeBadge.style.display = '';
  } else if (goveeConfigured) {
    goveeBadge.className = 'sh-platform-badge sh-platform-govee sh-platform-warn';
    goveeBadge.innerHTML = `<i class="fas fa-exclamation-circle"></i> Govee`;
    goveeBadge.title = 'Govee connected but no controllable devices found';
    goveeBadge.style.display = '';
  } else {
    goveeBadge.style.display = 'none';
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
    <div class="sh-empty"><i class="fas fa-home"></i><p>Connect SmartThings or Govee in Settings to get started.</p></div>`;
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
// GOVEE SETTINGS
// ============================================================
function setGoveePill(cls, icon, text) {
  const pill = document.getElementById('goveeStatusPill');
  if (!pill) return;
  pill.className = `sh-conn-status ${cls}`;
  pill.innerHTML = `<i class="fas ${icon}"></i><span class="sh-conn-status-text">${text}</span>`;
}

async function refreshGoveeStatus() {
  try {
    const s = await goveeApi('/status');
    goveeConfigured = s.configured;
    if (s.configured) {
      const count = allDevices.filter(d => d._source === 'govee').length;
      const via   = s.source === 'env' ? ' · via server config var' : '';
      setGoveePill('is-ready', 'fa-circle-check',
        `Connected${count ? ` · ${count} device${count === 1 ? '' : 's'}` : ''}${via}`);
    } else {
      setGoveePill('is-idle', 'fa-circle-info', 'Not connected — paste your API key below.');
    }
  } catch (err) {
    setGoveePill('is-error', 'fa-circle-exclamation', err.message);
  }
}

async function saveGoveeKey() {
  const input = document.getElementById('goveeKeyInput');
  const key = input?.value.trim();
  if (!key) { showToast('Paste your Govee API key first.', true); return; }

  setGoveePill('is-idle', 'fa-circle-notch fa-spin', 'Checking the key with Govee…');
  try {
    const res = await goveeApi('/key', { method: 'POST', body: JSON.stringify({ apiKey: key }) });
    input.value = '';
    goveeConfigured = true;
    showToast(`Govee connected — ${res.deviceCount} device${res.deviceCount === 1 ? '' : 's'} found.`);
    await loadDevices();
    refreshGoveeStatus();
  } catch (err) {
    showToast(err.message, true);
    refreshGoveeStatus();
  }
}

async function clearGoveeKey() {
  try {
    const res = await goveeApi('/key', { method: 'DELETE' });
    if (res.envFallback) {
      // Server config var still supplies a key — be honest about it
      showToast('Saved key removed, but the GOVEE_API_KEY config var on the server still connects Govee. Remove it on Heroku to fully disconnect.', true);
      await loadDevices();
      refreshGoveeStatus();
      return;
    }
    goveeConfigured = false;
    allDevices = allDevices.filter(d => d._source !== 'govee');
    showToast('Govee disconnected.');
    updatePlatformBadges();
    renderRoomTabs();
    renderDevices();
    refreshGoveeStatus();
  } catch (err) {
    showToast(err.message, true);
  }
}

function toggleGoveeKeyVis() {
  const input = document.getElementById('goveeKeyInput');
  const icon  = document.getElementById('goveeEyeIcon');
  const show  = input.type === 'password';
  input.type     = show ? 'text' : 'password';
  icon.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
}

// ============================================================
// SETTINGS MODAL
// ============================================================
function openSettings() {
  const input = document.getElementById('stPATInput');
  if (input) input.value = getPAT();
  document.getElementById('settingsModal').classList.remove('hidden');
  refreshGoveeStatus();
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
  loadDevices();
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
  if (!isLoggedIn()) { openLoginModal(); return; }

  // loadDevices handles every configuration state, including "nothing yet"
  loadDevices();

  document.getElementById('settingsModal').addEventListener('click', e => {
    if (e.target === document.getElementById('settingsModal')) closeSettings();
  });
});
