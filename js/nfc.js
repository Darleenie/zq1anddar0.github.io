// ============================================================
// CONSTANTS  (duplicated from inventory.js — separate page)
// ============================================================
const ROOM_LABELS = { living: 'Living Room', zq1: "zq1's Room", dar0: "dar0's Room" };
const ROOM_COLORS = { living: '#5C3D1E', zq1: '#1565C0', dar0: '#6A1B9A' };

// ============================================================
// STATE
// ============================================================
let currentTag  = null;   // registered NFC tag object
let currentTagId = null;  // raw tagId from URL param
let itemAction  = null;   // 'use' | 'remove'
let editTagRoom = 'living';

// ============================================================
// SCREEN MANAGEMENT
// ============================================================
function showScreen(name) {
  document.querySelectorAll('.nfc-screen').forEach(s => s.style.display = 'none');
  document.getElementById(`screen-${name}`).style.display = '';
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  const params  = new URLSearchParams(window.location.search);
  const tagId   = params.get('tag');
  currentTagId  = tagId;

  if (!tagId) { showScreen('not-found'); return; }

  showScreen('loading');
  try {
    const res = await fetch(`/api/nfc/${encodeURIComponent(tagId)}`);
    if (res.status === 404) { showScreen('not-found'); return; }
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    currentTag = await res.json();
    populateActionsScreen();
    showScreen('actions');
  } catch (err) {
    showScreen('not-found');
  }
});

// ============================================================
// ACTIONS SCREEN
// ============================================================
function populateActionsScreen() {
  const t = currentTag;
  document.getElementById('actionRoomBadge').textContent = ROOM_LABELS[t.room] || t.room;
  document.getElementById('actionRoomBadge').style.background = ROOM_COLORS[t.room] || '#555';
  document.getElementById('actionLabel').textContent = t.label;
  document.getElementById('actionLocation').innerHTML = `<i class="fas fa-map-marker-alt"></i> ${t.location}`;
  document.getElementById('actionLocationDetail').textContent = t.locationDetail || '';
  document.getElementById('actionLocationDetail').style.display = t.locationDetail ? '' : 'none';

  // Pre-fill store locked info
  document.getElementById('storeLockInfo').innerHTML = `
    <div class="nfc-locked-row"><i class="fas fa-lock"></i> <span>${ROOM_LABELS[t.room]}</span></div>
    <div class="nfc-locked-row"><i class="fas fa-map-marker-alt"></i> <span>${t.location}</span></div>
    ${t.locationDetail ? `<div class="nfc-locked-row"><i class="fas fa-info-circle"></i> <span>${t.locationDetail}</span></div>` : ''}
  `;

  // Pre-fill edit tag form
  document.getElementById('et-label').value      = t.label;
  document.getElementById('et-loc').value        = t.location;
  document.getElementById('et-loc-detail').value = t.locationDetail || '';
  editTagRoom = t.room || 'living';
  document.querySelectorAll('#etRoomSelector .room-sel-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.room === editTagRoom);
  });
}

// ============================================================
// STORE ACTION
// ============================================================
function toggleStoreExpiry() {
  const cls = document.getElementById('s-class').value;
  document.getElementById('s-exp-group').style.display = ['food', 'medicine'].includes(cls) ? '' : 'none';
}

async function submitStore(e) {
  e.preventDefault();
  const btn = document.getElementById('storeSaveBtn');
  btn.disabled = true;

  const item = {
    name:           document.getElementById('s-name').value.trim(),
    description:    document.getElementById('s-desc').value.trim() || null,
    classification: document.getElementById('s-class').value,
    room:           currentTag.room,
    location:       currentTag.location,
    locationDetail: currentTag.locationDetail || null,
    qty:            parseInt(document.getElementById('s-qty').value),
    expirationDate: document.getElementById('s-exp').value || null,
    image:          null,
  };

  try {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    e.target.reset();
    document.getElementById('s-exp-group').style.display = 'none';
    showScreen('actions');
    showToast(`${item.name} stored at ${item.location}`);
  } catch (err) {
    showToast(`Failed to save: ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// USE / REMOVE ACTION
// ============================================================
async function loadItemsForAction(action) {
  itemAction = action;
  document.getElementById('itemsScreenTitle').textContent = action === 'use' ? 'Use Items' : 'Remove Items';
  document.getElementById('nfcItemList').innerHTML = `<div class="nfc-center" style="padding:40px"><i class="fas fa-spinner fa-spin"></i></div>`;
  showScreen('items');

  try {
    const params = new URLSearchParams({ room: currentTag.room, location: currentTag.location });
    const res = await fetch(`/api/items?${params}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const items = await res.json();
    renderItemList(items, action);
  } catch (err) {
    document.getElementById('nfcItemList').innerHTML = `<p style="color:#e53935;padding:20px">${err.message}</p>`;
  }
}

function renderItemList(items, action) {
  const list = document.getElementById('nfcItemList');
  if (items.length === 0) {
    list.innerHTML = `
      <div class="nfc-center" style="padding:40px;color:#bbb">
        <i class="fas fa-box-open" style="font-size:2rem;margin-bottom:10px"></i>
        <p>No items at this location.</p>
        <button class="btn-secondary" style="margin-top:12px" onclick="showScreen('store')">
          <i class="fas fa-plus"></i> Store an item
        </button>
      </div>`;
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="nfc-item-card" id="icard-${item._id}">
      <div class="nfc-item-info">
        <strong>${item.name}</strong>
        <span class="nfc-item-qty">Qty: ${item.qty}</span>
        ${item.description ? `<span class="nfc-item-desc">${item.description}</span>` : ''}
      </div>
      ${action === 'use' ? useControls(item) : removeControls(item)}
    </div>
  `).join('');
}

function useControls(item) {
  const maxQty = item.qty;
  return `
    <div class="nfc-qty-row">
      <button type="button" class="nfc-qty-btn" onclick="adjustQty('${item._id}', -1, ${maxQty})">−</button>
      <input type="number" class="nfc-qty-input" id="qtyinput-${item._id}"
             value="1" min="1" max="${maxQty}" />
      <button type="button" class="nfc-qty-btn" onclick="adjustQty('${item._id}', 1, ${maxQty})">+</button>
      <button type="button" class="nfc-btn-use-item btn-primary"
              onclick="useItem('${item._id}', ${item.qty})">Use</button>
    </div>
  `;
}

function removeControls(item) {
  return `
    <div class="nfc-item-actions">
      <button type="button" class="btn-danger nfc-btn-remove-item"
              onclick="showRemoveConfirm('${item._id}', '${item.name.replace(/'/g, "\\'")}')">
        <i class="fas fa-trash"></i> Remove
      </button>
    </div>
    <div class="nfc-inline-confirm" id="confirm-${item._id}" style="display:none">
      <span>Remove <strong>${item.name}</strong>?</span>
      <button class="btn-danger" onclick="doRemoveItem('${item._id}')">Yes, remove</button>
      <button class="btn-secondary" onclick="document.getElementById('confirm-${item._id}').style.display='none';document.querySelector('#icard-${item._id} .nfc-btn-remove-item').style.display=''">Cancel</button>
    </div>
  `;
}

function adjustQty(itemId, delta, maxQty) {
  const input = document.getElementById(`qtyinput-${itemId}`);
  const newVal = Math.min(maxQty, Math.max(1, parseInt(input.value || 1) + delta));
  input.value = newVal;
}

async function useItem(itemId, currentQty) {
  const input   = document.getElementById(`qtyinput-${itemId}`);
  const consume = parseInt(input.value || 1);
  const newQty  = Math.max(0, currentQty - consume);

  const card = document.getElementById(`icard-${itemId}`);
  card.classList.add('nfc-item-saving');

  try {
    const res = await fetch(`/api/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: newQty }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);

    // Update display
    card.querySelector('.nfc-item-qty').textContent = `Qty: ${newQty}`;
    input.value = 1;
    input.max   = newQty;
    card.classList.remove('nfc-item-saving');

    if (newQty === 0) {
      showInlineZeroQty(itemId, card);
    } else {
      showToast(`Used ${consume} × ${card.querySelector('strong').textContent}`);
    }
  } catch (err) {
    card.classList.remove('nfc-item-saving');
    showToast(`Failed: ${err.message}`, true);
  }
}

function showInlineZeroQty(itemId, card) {
  const name = card.querySelector('strong').textContent;
  const qtyRow = card.querySelector('.nfc-qty-row');
  qtyRow.insertAdjacentHTML('afterend', `
    <div class="nfc-inline-confirm nfc-zero-confirm" id="zeroconf-${itemId}">
      <span><strong>${name}</strong> is now at 0.</span>
      <button class="btn-danger" onclick="doRemoveItem('${itemId}')">Remove it</button>
      <button class="btn-secondary" onclick="document.getElementById('zeroconf-${itemId}').remove()">Keep at 0</button>
    </div>
  `);
}

function showRemoveConfirm(itemId, name) {
  document.querySelector(`#icard-${itemId} .nfc-btn-remove-item`).style.display = 'none';
  document.getElementById(`confirm-${itemId}`).style.display = '';
}

async function doRemoveItem(itemId) {
  const card = document.getElementById(`icard-${itemId}`);
  const name = card.querySelector('strong').textContent;
  try {
    const res = await fetch(`/api/items/${itemId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    card.style.transition = 'opacity 0.3s';
    card.style.opacity    = '0';
    setTimeout(() => card.remove(), 300);
    showToast(`${name} removed`);
  } catch (err) {
    showToast(`Failed: ${err.message}`, true);
  }
}

// ============================================================
// EDIT TAG
// ============================================================
function selectEditRoom(btn) {
  document.querySelectorAll('#etRoomSelector .room-sel-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  editTagRoom = btn.dataset.room;
}

async function saveEditTag(e) {
  e.preventDefault();
  const updates = {
    label:          document.getElementById('et-label').value.trim(),
    room:           editTagRoom,
    location:       document.getElementById('et-loc').value.trim(),
    locationDetail: document.getElementById('et-loc-detail').value.trim() || null,
  };
  try {
    const res = await fetch(`/api/nfc/${encodeURIComponent(currentTagId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    Object.assign(currentTag, updates);
    populateActionsScreen();
    showScreen('actions');
    showToast('Tag updated');
  } catch (err) {
    showToast(`Failed: ${err.message}`, true);
  }
}

function confirmUnregister() {
  document.getElementById('unregisterConfirm').style.display = '';
}

async function doUnregister() {
  try {
    const res = await fetch(`/api/nfc/${encodeURIComponent(currentTagId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    window.location.href = '/pages/nfc-manage.html';
  } catch (err) {
    showToast(`Failed: ${err.message}`, true);
  }
}

// ============================================================
// TOAST
// ============================================================
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
