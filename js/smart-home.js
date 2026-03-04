// ============================================================
// SMARTTHINGS API
// ============================================================
const ST_API = 'https://api.smartthings.com/v1';

function getPAT() { return localStorage.getItem('smarthome_st_pat') || ''; }
function setPAT(t) { localStorage.setItem('smarthome_st_pat', t.trim()); }
function clearStoredPAT() { localStorage.removeItem('smarthome_st_pat'); }

async function stFetch(path, options = {}) {
  const pat = getPAT();
  const res = await fetch(`${ST_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${pat}`,
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
// DEVICE ICONS + LABELS
// ============================================================
const CATEGORY_ICONS = {
  'Light':         'fa-lightbulb',
  'SmartPlug':     'fa-plug',
  'Switch':        'fa-toggle-on',
  'Thermostat':    'fa-thermometer-half',
  'Fan':           'fa-fan',
  'Lock':          'fa-lock',
  'Camera':        'fa-video',
  'Sensor':        'fa-satellite-dish',
  'Speaker':       'fa-volume-up',
  'TV':            'fa-tv',
  'AirPurifier':   'fa-wind',
  'WaterValve':    'fa-tint',
};

function deviceIcon(device) {
  const cat = device.components?.[0]?.categories?.[0]?.name || '';
  return CATEGORY_ICONS[cat] || 'fa-home';
}

// ============================================================
// STATE
// ============================================================
let allRooms    = [];
let allDevices  = [];
let activeRoom  = null; // roomId or 'unassigned'
let isLoading   = false;

// ============================================================
// LOAD
// ============================================================
async function loadDevices() {
  if (!getPAT()) {
    showAuthBanner();
    return;
  }

  setLoading(true);
  hideAuthBanner();

  try {
    // 1. Get first location
    const { items: locations } = await stFetch('/locations');
    if (!locations?.length) throw new Error('No SmartThings locations found.');
    const locationId = locations[0].locationId;

    // 2. Rooms + devices in parallel
    const [{ items: rooms }, { items: devices }] = await Promise.all([
      stFetch(`/rooms?locationId=${locationId}`),
      stFetch(`/devices?locationId=${locationId}`),
    ]);

    // 3. Filter to switch-capable devices only
    const switchDevices = (devices || []).filter(d =>
      d.components?.some(c => c.capabilities?.some(cap => cap.id === 'switch'))
    );

    // 4. Fetch status for each device in parallel (ignore failures)
    const statuses = await Promise.all(
      switchDevices.map(d =>
        stFetch(`/devices/${d.deviceId}/status`).catch(() => null)
      )
    );
    switchDevices.forEach((d, i) => {
      d._on = statuses[i]?.components?.main?.switch?.switch?.value === 'on';
      d._category = d.components?.[0]?.categories?.[0]?.name || 'Switch';
    });

    allRooms   = rooms   || [];
    allDevices = switchDevices;

    // Set initial active room to first room that has devices, or first room
    const roomsWithDevices = allRooms.filter(r =>
      allDevices.some(d => d.roomId === r.roomId)
    );
    if (!activeRoom || ![...roomsWithDevices.map(r => r.roomId), 'unassigned'].includes(activeRoom)) {
      activeRoom = roomsWithDevices[0]?.roomId || 'unassigned';
    }

    document.getElementById('platformRow').style.display = '';
    renderRoomTabs();
    renderDevices();

  } catch (err) {
    showError(err.message);
    if (err.message.includes('401') || err.message.includes('403')) {
      showAuthBanner(true);
    }
  } finally {
    setLoading(false);
  }
}

// ============================================================
// TOGGLE
// ============================================================
async function toggleDevice(deviceId) {
  const device = allDevices.find(d => d.deviceId === deviceId);
  if (!device) return;

  const newState = !device._on;
  const command  = newState ? 'on' : 'off';

  // Optimistic update
  device._on = newState;
  updateToggleUI(deviceId, newState, true);

  try {
    await stFetch(`/devices/${deviceId}/commands`, {
      method: 'POST',
      body: JSON.stringify({
        commands: [{ component: 'main', capability: 'switch', command }],
      }),
    });
    updateToggleUI(deviceId, newState, false);
  } catch (err) {
    // Revert on failure
    device._on = !newState;
    updateToggleUI(deviceId, !newState, false);
    showToast(`Failed to toggle ${device.label}: ${err.message}`, true);
  }
}

function updateToggleUI(deviceId, isOn, loading) {
  const card = document.querySelector(`[data-device-id="${deviceId}"]`);
  if (!card) return;
  const tog = card.querySelector('.sh-toggle');
  const dot = card.querySelector('.sh-toggle-dot');
  if (tog) tog.classList.toggle('on', isOn);
  if (loading && tog) tog.classList.add('toggling');
  if (!loading && tog) tog.classList.remove('toggling');
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

  // Which rooms have devices?
  const roomsWithDevices = allRooms.filter(r =>
    allDevices.some(d => d.roomId === r.roomId)
  );
  const unassigned = allDevices.filter(d => !d.roomId);

  if (roomsWithDevices.length === 0 && unassigned.length === 0) {
    tabs.style.display = 'none';
    return;
  }

  const tabItems = [
    ...roomsWithDevices.map(r => ({ id: r.roomId, label: r.name })),
    ...(unassigned.length ? [{ id: 'unassigned', label: 'Other' }] : []),
  ];

  tabs.style.display = '';
  tabs.innerHTML = tabItems.map(t => `
    <button class="sh-room-tab ${t.id === activeRoom ? 'active' : ''}"
            data-room="${t.id}" onclick="setActiveRoom('${t.id}')">
      ${t.label}
      <span class="sh-room-count">${
        t.id === 'unassigned'
          ? allDevices.filter(d => !d.roomId).length
          : allDevices.filter(d => d.roomId === t.id).length
      }</span>
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

  const devices = activeRoom === 'unassigned'
    ? allDevices.filter(d => !d.roomId)
    : allDevices.filter(d => d.roomId === activeRoom);

  if (devices.length === 0) {
    area.innerHTML = `<div class="sh-empty"><i class="fas fa-plug"></i><p>No controllable devices in this room.</p></div>`;
    return;
  }

  area.innerHTML = `<div class="sh-device-grid">${devices.map(d => deviceCard(d)).join('')}</div>`;
}

function deviceCard(device) {
  const icon = deviceIcon(device);
  const isOn = device._on;
  return `
    <div class="sh-device-card ${isOn ? 'sh-card-on' : ''}" data-device-id="${device.deviceId}">
      <div class="sh-device-icon">
        <i class="fas ${icon}"></i>
      </div>
      <div class="sh-device-body">
        <span class="sh-device-name">${device.label || device.name}</span>
        <span class="sh-device-type">${device._category}</span>
      </div>
      <div class="sh-device-control">
        <span class="sh-device-state">${isOn ? 'On' : 'Off'}</span>
        <div class="sh-toggle ${isOn ? 'on' : ''}" onclick="toggleDevice('${device.deviceId}')">
          <div class="sh-toggle-dot"></div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// UI HELPERS
// ============================================================
function setLoading(on) {
  isLoading = on;
  const btn = document.getElementById('refreshBtn');
  if (btn) {
    btn.classList.toggle('spinning', on);
    btn.disabled = on;
  }
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
    banner.querySelector('strong').textContent = 'Invalid Token';
    banner.querySelector('p').textContent = 'Your token was rejected. Please update it in Settings.';
  }
  document.getElementById('deviceArea').innerHTML = `
    <div class="sh-empty">
      <i class="fas fa-home"></i>
      <p>Connect SmartThings to see your devices.</p>
    </div>`;
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
  input.type  = show ? 'text' : 'password';
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
