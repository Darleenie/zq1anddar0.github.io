// ============================================================
// API CALLS
// ============================================================
async function fetchItems() {
  const res = await fetch('/api/items', { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error('Failed to fetch items');
  return res.json();
}

async function apiAddItem(item) {
  const res = await fetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error('Failed to add item');
  return res.json();
}

async function apiUpdateItem(id, updates) {
  const res = await fetch(`/api/items/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update item');
}

async function apiDeleteItem(id) {
  const res = await fetch(`/api/items/${id}`, { method: 'DELETE', headers: { ...authHeaders() } });
  if (!res.ok) throw new Error('Failed to delete item');
}

// ============================================================
// IN-MEMORY CACHE + ROOM STATE
// ============================================================
let allItems = [];

const ROOM_LABELS = {
  living: 'Living Room',
  zq1:    "zq1's Room",
  dar0:   "dar0's Room",
};
const ROOM_ICONS = {
  living: 'fa-couch',
  zq1:    'fa-door-closed',
  dar0:   'fa-door-closed',
};
const ROOM_COLORS = {
  living: '#5C3D1E',
  zq1:    '#1565C0',
  dar0:   '#6A1B9A',
};

let currentRoom = 'living';
let selectedFormRoom = 'living';
let selectedVisibility = 'public';

function selectVisibility(btn) {
  document.querySelectorAll('.vis-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedVisibility = btn.dataset.vis;
}

function setRoom(btn) {
  document.querySelectorAll('.room-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentRoom = btn.dataset.room;

  const heading = document.getElementById('roomHeading');
  if (heading) {
    heading.innerHTML = `<i class="fas ${ROOM_ICONS[currentRoom]}"></i> ${ROOM_LABELS[currentRoom]}`;
  }

  renderItems();
}

function selectFormRoom(btn) {
  document.querySelectorAll('.room-sel-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedFormRoom = btn.dataset.room;
  // Update default visibility when room changes (only while adding, not editing)
  if (!editingId && isLoggedIn()) {
    const me = getUser().username;
    selectedVisibility = (selectedFormRoom === me) ? 'private' : 'public';
    document.querySelectorAll('.vis-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.vis === selectedVisibility);
    });
  }
}

// ============================================================
// NOTIFICATION LOGIC
// ============================================================
const CONSUMABLE_CLASSES = ['food', 'medicine', 'cleaning'];
const LOW_STOCK_THRESHOLD = 2;
const EXPIRY_WARN_DAYS = 14;

function getItemAlerts(item) {
  const alerts = [];
  const qty = Number(item.qty);

  if (item.missing) {
    alerts.push({ type: 'missing', msg: 'Reported missing' });
  }

  if (qty === 0) {
    alerts.push({ type: 'danger', msg: 'Out of stock' });
  } else if (qty <= LOW_STOCK_THRESHOLD && CONSUMABLE_CLASSES.includes(item.classification)) {
    alerts.push({ type: 'warning', msg: `Low stock (${qty} left)` });
  }

  if (item.expirationDate) {
    const daysLeft = Math.ceil((new Date(item.expirationDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) alerts.push({ type: 'danger', msg: 'Expired' });
    else if (daysLeft <= EXPIRY_WARN_DAYS) alerts.push({ type: 'warning', msg: `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` });
  }

  return alerts;
}

function renderNotifications() {
  const banner = document.getElementById('notification-banner');
  if (!banner) return;

  const allAlerts = [];
  allItems.forEach(item => getItemAlerts(item).forEach(a => allAlerts.push({ ...a, name: item.name, room: ROOM_LABELS[item.room || 'living'] })));

  if (allAlerts.length === 0) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  banner.style.display = '';
  banner.innerHTML = `
    <div class="notif-header">
      <i class="fas fa-bell"></i>
      <strong>Alerts (${allAlerts.length})</strong>
      <button class="notif-dismiss" onclick="dismissNotifications()"><i class="fas fa-times"></i></button>
    </div>
    <div class="notif-list">
      ${allAlerts.map(a => `
        <span class="notif-item notif-${a.type}"><strong>${a.name}</strong> <span class="notif-room">(${a.room})</span>: ${a.msg}</span>
      `).join('')}
    </div>
  `;
}

function dismissNotifications() {
  const banner = document.getElementById('notification-banner');
  if (banner) banner.style.display = 'none';
}

// ============================================================
// RENDERING
// ============================================================
const CLASS_COLORS = {
  food: '#4CAF50',
  medicine: '#e91e63',
  cleaning: '#2196F3',
  electronics: '#9C27B0',
  general: '#FF9800',
};

let currentFilter = 'all';

function setFilter(btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  renderItems();
}

function renderItems() {
  const query = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  updateSearchSuggestions(query);
  const grid = document.getElementById('itemGrid');
  let items = [...allItems];

  // Filter by current room (items without a room field default to 'living')
  items = items.filter(i => (i.room || 'living') === currentRoom);

  if (currentFilter !== 'all') items = items.filter(i => i.classification === currentFilter);
  if (query) {
    items = items.filter(i =>
      i.name.toLowerCase().includes(query) ||
      i.location.toLowerCase().includes(query) ||
      (i.locationDetail || '').toLowerCase().includes(query) ||
      (i.description || '').toLowerCase().includes(query) ||
      i.classification.toLowerCase().includes(query)
    );
  }

  if (items.length === 0) {
    grid.innerHTML = `
      <div class="no-items">
        <i class="fas fa-box-open"></i>
        <p>${query || currentFilter !== 'all' ? 'No items match your search.' : 'No items yet. Add your first item!'}</p>
      </div>`;
    return;
  }

  grid.innerHTML = items.map(item => {
    const alerts = getItemAlerts(item);
    const nonMissingAlerts = alerts.filter(a => a.type !== 'missing');
    const alertBadges = alerts.map(a =>
      `<span class="alert-badge badge-${a.type}">${a.type === 'missing' ? '<i class="fas fa-question-circle"></i> ' : ''}${a.msg}</span>`
    ).join('');
    const color = CLASS_COLORS[item.classification] || '#999';
    const expText = item.expirationDate
      ? `<p class="item-exp"><i class="fas fa-calendar-alt"></i> Exp: ${formatDate(item.expirationDate)}</p>`
      : '';
    const imgContent = item.image
      ? `<img src="${item.image}" alt="${item.name}" onerror="this.parentElement.classList.add('img-failed')" />`
      : '';
    const locDetail = item.locationDetail
      ? `<p class="item-loc-detail"><i class="fas fa-info-circle"></i> ${item.locationDetail}</p>`
      : '';
    const id = item._id;
    const stateClass = item.missing ? 'card-missing'
      : nonMissingAlerts.some(a => a.type === 'danger') ? 'card-danger'
      : nonMissingAlerts.length > 0 ? 'card-warning' : '';
    const privateBadge = item.visibility === 'private'
      ? `<span class="item-private-badge"><i class="fas fa-lock"></i> Private</span>` : '';
    const canEdit = isLoggedIn() && (!item.owner || item.owner === getUser()?.username);

    return `
      <div class="item-card ${stateClass}">
        <div class="card-img-wrap ${!item.image ? 'no-img' : ''}">
          ${imgContent}
          ${!item.image ? '<i class="fas fa-box-open card-img-icon"></i>' : ''}
        </div>
        <div class="card-body">
          <div class="card-top">
            <span class="class-badge" style="background:${color}">${capitalize(item.classification)}</span>
            ${privateBadge}
            ${alertBadges}
          </div>
          <h3 class="item-name">${item.name}</h3>
          ${item.description ? `<p class="item-desc">${item.description}</p>` : ''}
          <p class="item-loc"><i class="fas fa-map-marker-alt"></i> ${item.location}</p>
          ${locDetail}
          <p class="item-qty"><i class="fas fa-box"></i> Qty: <strong>${item.qty}</strong></p>
          ${expText}
          <div class="card-actions">
            ${canEdit ? `<button class="btn-icon" onclick="openEditModal('${id}')" title="Edit"><i class="fas fa-edit"></i></button>` : ''}
            ${canEdit ? `<button class="btn-icon btn-flag ${item.missing ? 'active' : ''}" onclick="toggleMissing('${id}')" title="${item.missing ? 'Mark as Found' : 'Report Missing'}"><i class="fas fa-flag"></i></button>` : ''}
            ${canEdit ? `<button class="btn-icon btn-del" onclick="openDeleteModal('${id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================
// MODAL: ADD / EDIT
// ============================================================
let editingId = null;
let pendingImageData = null;
let pendingNewItem = null;

function openAddModal() {
  editingId = null;
  pendingImageData = null;
  document.getElementById('modalTitle').textContent = 'Add Item';
  document.getElementById('submitBtn').textContent = 'Add Item';
  document.getElementById('itemForm').reset();
  document.getElementById('imgPreview').innerHTML = '';
  document.getElementById('expDateGroup').style.display = 'none';

  // Pre-select the current room tab in the form
  selectedFormRoom = currentRoom;
  document.querySelectorAll('.room-sel-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.room === currentRoom);
  });

  // Set default visibility: zq1/dar0 room → private (if logged in as that user), else public
  const loggedIn = isLoggedIn();
  const visGroup = document.getElementById('visibilityGroup');
  if (visGroup) visGroup.style.display = loggedIn ? '' : 'none';
  if (loggedIn) {
    const me = getUser().username;
    selectedVisibility = (selectedFormRoom === me) ? 'private' : 'public';
    document.querySelectorAll('.vis-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.vis === selectedVisibility);
    });
  } else {
    selectedVisibility = 'public';
  }

  document.getElementById('itemModal').classList.remove('hidden');
}

function openEditModal(id) {
  const item = allItems.find(i => String(i._id) === String(id));
  if (!item) return;

  editingId = String(id);
  pendingImageData = item.image || null;

  document.getElementById('modalTitle').textContent = 'Edit Item';
  document.getElementById('submitBtn').textContent = 'Save Changes';
  document.getElementById('f-name').value = item.name || '';
  document.getElementById('f-desc').value = item.description || '';
  document.getElementById('f-class').value = item.classification || '';
  document.getElementById('f-loc').value = item.location || '';
  document.getElementById('f-loc-detail').value = item.locationDetail || '';
  document.getElementById('f-qty').value = item.qty ?? 1;
  document.getElementById('f-exp').value = item.expirationDate || '';
  document.getElementById('f-img-url').value = (item.image && !item.image.startsWith('data:')) ? item.image : '';

  // Set room selector
  selectedFormRoom = item.room || 'living';
  document.querySelectorAll('.room-sel-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.room === selectedFormRoom);
  });

  toggleExpDate();

  // Set visibility toggle state
  const loggedIn = isLoggedIn();
  const visGroup = document.getElementById('visibilityGroup');
  if (visGroup) visGroup.style.display = loggedIn ? '' : 'none';
  if (loggedIn) {
    selectedVisibility = item.visibility || 'public';
    document.querySelectorAll('.vis-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.vis === selectedVisibility);
    });
  }

  document.getElementById('imgPreview').innerHTML = item.image
    ? `<img src="${item.image}" alt="preview" />`
    : '';

  document.getElementById('itemModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('itemModal').classList.add('hidden');
  editingId = null;
  pendingImageData = null;
  pendingNewItem = null;
  hideDupWarning();
}

function toggleExpDate() {
  const cls = document.getElementById('f-class').value;
  document.getElementById('expDateGroup').style.display = ['food', 'medicine'].includes(cls) ? '' : 'none';
}

// ── Image compression ──────────────────────────────────────
function compressImage(file, maxDim = 800, quality = 0.72) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function b64Bytes(b64) {
  const data = b64.split(',')[1] || b64;
  return Math.round(data.length * 0.75);
}

function fmtBytes(n) {
  return n < 1024 * 1024
    ? (n / 1024).toFixed(1) + ' KB'
    : (n / (1024 * 1024)).toFixed(2) + ' MB';
}

async function previewImage(event) {
  const file = event.target.files[0];
  if (!file) return;

  const preview = document.getElementById('imgPreview');
  preview.innerHTML = '<span class="compress-status"><i class="fas fa-spinner fa-spin"></i> Compressing…</span>';

  const originalSize = file.size;
  const compressed   = await compressImage(file);
  const compressedSize = b64Bytes(compressed);

  pendingImageData = compressed;
  document.getElementById('f-img-url').value = '';

  preview.innerHTML = `
    <img src="${compressed}" alt="preview" />
    <span class="compress-info">
      <i class="fas fa-compress-arrows-alt"></i>
      ${fmtBytes(originalSize)} → <strong>${fmtBytes(compressedSize)}</strong>
    </span>
  `;
}

function previewUrl() {
  const url = document.getElementById('f-img-url').value.trim();
  if (url) {
    pendingImageData = url;
    document.getElementById('imgPreview').innerHTML =
      `<img src="${url}" alt="preview" onerror="this.style.display='none'" />`;
    document.getElementById('f-img').value = '';
  }
}

function buildItemFromForm() {
  return {
    name:           document.getElementById('f-name').value.trim(),
    description:    document.getElementById('f-desc').value.trim(),
    classification: document.getElementById('f-class').value,
    room:           selectedFormRoom,
    location:       document.getElementById('f-loc').value.trim(),
    locationDetail: document.getElementById('f-loc-detail').value.trim() || null,
    qty:            parseInt(document.getElementById('f-qty').value),
    expirationDate: document.getElementById('f-exp').value || null,
    image:          pendingImageData || null,
    visibility:     isLoggedIn() ? selectedVisibility : 'public',
  };
}

async function doSubmitItem(item) {
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    if (editingId) {
      await apiUpdateItem(editingId, item);
      const idx = allItems.findIndex(i => String(i._id) === editingId);
      if (idx !== -1) allItems[idx] = { ...allItems[idx], ...item };
    } else {
      const created = await apiAddItem(item);
      allItems.push(created);
    }
    closeModal();
    renderItems();
    renderNotifications();
  } catch (err) {
    alert('Error saving item: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = editingId ? 'Save Changes' : 'Add Item';
  }
}

async function submitItem(e) {
  e.preventDefault();
  const item = buildItemFromForm();

  // Only check for duplicates when adding (not editing)
  if (!editingId) {
    const dups = findPotentialDuplicates(item.name, item.room);
    if (dups.length > 0) {
      pendingNewItem = item;
      showDupWarning(dups, item);
      return;
    }
  }

  await doSubmitItem(item);
}

// ============================================================
// DUPLICATE CHECK
// ============================================================
function nameSimilarity(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const stop = new Set(['the','a','an','of','and','or','in','on','at','for','to']);
  const words1 = a.split(/\s+/).filter(w => w.length > 1 && !stop.has(w));
  const words2 = b.split(/\s+/).filter(w => w.length > 1 && !stop.has(w));
  if (!words1.length || !words2.length) return 0;
  const set2 = new Set(words2);
  return words1.filter(w => set2.has(w)).length / Math.max(words1.length, words2.length);
}

function findPotentialDuplicates(name, room) {
  return allItems
    .filter(i => (i.room || 'living') === room)
    .map(i => ({ item: i, score: nameSimilarity(name, i.name || '') }))
    .filter(r => r.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ============================================================
// SEARCH SUGGESTIONS
// ============================================================
function updateSearchSuggestions(query) {
  const box = document.getElementById('searchSuggestions');
  if (!box) return;
  if (query.length < 2) { box.style.display = 'none'; return; }

  const results = allItems
    .map(i => ({ item: i, score: nameSimilarity(query, i.name || '') }))
    .filter(r => r.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (results.length === 0) { box.style.display = 'none'; return; }

  box.innerHTML = results.map(({ item }) => {
    const room = item.room || 'living';
    const color = ROOM_COLORS[room] || '#555';
    const label = ROOM_LABELS[room] || room;
    return `
      <div class="search-sugg-item" onclick="applySuggestion(${JSON.stringify(item.name)})">
        <span class="sugg-name">${item.name}</span>
        <span class="sugg-meta">
          <span class="sugg-room" style="background:${color}">${label}</span>
          <span class="sugg-loc">${item.location}</span>
        </span>
      </div>`;
  }).join('');
  box.style.display = '';
}

function applySuggestion(name) {
  document.getElementById('searchInput').value = name;
  document.getElementById('searchSuggestions').style.display = 'none';
  renderItems();
}

function showDupWarning(dups, newItem) {
  document.getElementById('modalFormActions').style.display = 'none';
  const warn = document.getElementById('dupWarning');
  warn.style.display = '';

  const list = document.getElementById('dupList');
  list.innerHTML = dups.map(({ item }) => {
    const locDiff = item.location && newItem.location &&
      item.location.toLowerCase() !== newItem.location.toLowerCase();
    return `
      <div class="dup-item">
        <div class="dup-item-info">
          <strong>${item.name}</strong>
          <span class="dup-item-qty"><i class="fas fa-box"></i> Qty: ${item.qty}</span>
          <span class="dup-item-loc"><i class="fas fa-map-marker-alt"></i> ${item.location}</span>
          ${item.missing ? '<span class="badge-missing"><i class="fas fa-question-circle"></i> Missing</span>' : ''}
        </div>
        <div class="dup-item-actions">
          <button class="dup-btn" onclick="mergeWithExisting('${item._id}')">
            <i class="fas fa-layer-group"></i> Merge (+${newItem.qty})
          </button>
          ${item.missing ? `<button class="dup-btn dup-btn-found" onclick="markExistingFound('${item._id}')">
            <i class="fas fa-check-circle"></i> Mark Found
          </button>` : ''}
          ${locDiff ? `<button class="dup-btn dup-btn-loc" onclick="updateExistingLocation('${item._id}')">
            <i class="fas fa-map-marker-alt"></i> Update Location
          </button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function hideDupWarning() {
  document.getElementById('dupWarning').style.display = 'none';
  document.getElementById('modalFormActions').style.display = '';
  pendingNewItem = null;
}

async function addItemAnyway() {
  if (!pendingNewItem) return;
  const item = pendingNewItem;
  pendingNewItem = null;
  hideDupWarning();
  await doSubmitItem(item);
}

async function mergeWithExisting(existingId) {
  if (!pendingNewItem) return;
  const existing = allItems.find(i => String(i._id) === String(existingId));
  if (!existing) return;
  const newQty = (Number(existing.qty) || 0) + (Number(pendingNewItem.qty) || 0);
  try {
    await apiUpdateItem(existingId, { qty: newQty });
    existing.qty = newQty;
    closeModal();
    renderItems();
    renderNotifications();
    showToast(`Merged — ${existing.name} qty is now ${newQty}`);
  } catch (err) {
    alert('Error merging: ' + err.message);
  }
}

async function markExistingFound(existingId) {
  const existing = allItems.find(i => String(i._id) === String(existingId));
  if (!existing) return;
  try {
    await apiUpdateItem(existingId, { missing: false });
    existing.missing = false;
    closeModal();
    renderItems();
    renderNotifications();
    showToast(`${existing.name} marked as found`);
  } catch (err) {
    alert('Error updating item: ' + err.message);
  }
}

async function updateExistingLocation(existingId) {
  if (!pendingNewItem) return;
  const existing = allItems.find(i => String(i._id) === String(existingId));
  if (!existing) return;
  const updates = {
    location: pendingNewItem.location,
    locationDetail: pendingNewItem.locationDetail,
    missing: false,
  };
  try {
    await apiUpdateItem(existingId, updates);
    Object.assign(existing, updates);
    closeModal();
    renderItems();
    renderNotifications();
    showToast(`${existing.name} location updated`);
  } catch (err) {
    alert('Error updating location: ' + err.message);
  }
}

function showToast(msg) {
  const existing = document.getElementById('appToast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'appToast';
  toast.className = 'toast';
  toast.innerHTML = `<i class="fas fa-check-circle"></i> ${msg}`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3000);
}

// ============================================================
// MISSING FLAG
// ============================================================
async function toggleMissing(id) {
  const item = allItems.find(i => String(i._id) === String(id));
  if (!item) return;
  const newVal = !item.missing;
  try {
    await apiUpdateItem(id, { missing: newVal });
    item.missing = newVal;
    renderItems();
    renderNotifications();
  } catch (err) {
    alert('Error updating item: ' + err.message);
  }
}

// ============================================================
// MODAL: DELETE
// ============================================================
let pendingDeleteId = null;

function openDeleteModal(id) {
  pendingDeleteId = id;
  document.getElementById('deleteModal').classList.remove('hidden');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  document.getElementById('deleteModal').classList.add('hidden');
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  try {
    await apiDeleteItem(pendingDeleteId);
    allItems = allItems.filter(i => String(i._id) !== String(pendingDeleteId));
    closeDeleteModal();
    renderItems();
    renderNotifications();
  } catch (err) {
    alert('Error deleting item: ' + err.message);
  }
}

// ============================================================
// SEED DATA (posted to DB only if collection is empty)
// ============================================================
async function seedIfEmpty() {
  if (allItems.length > 0) return;
  const seed = [
    { name: 'Bowls',       description: 'Ceramic dinner bowls',    classification: 'general',     room: 'living', location: 'Kitchen Cabinet', locationDetail: 'Right side, second shelf from top', qty: 4, expirationDate: null, image: null },
    { name: 'Switch',      description: 'Nintendo Switch console',  classification: 'electronics', room: 'living', location: 'Living Room Desk',                                                  qty: 1, expirationDate: null, image: null },
    { name: 'Shoe Cleaner',description: 'Shoe cleaning spray',      classification: 'cleaning',    room: 'living', location: 'Entrance Brown Cabinet',                                            qty: 1, expirationDate: null, image: null },
  ];
  for (const item of seed) {
    const created = await apiAddItem(item);
    allItems.push(created);
  }
}

// ============================================================
// INIT
// ============================================================
function showLoading() {
  document.getElementById('itemGrid').innerHTML = `
    <div class="no-items">
      <i class="fas fa-spinner fa-spin"></i>
      <p>Loading items...</p>
    </div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  showLoading();

  try {
    allItems = await fetchItems();
    await seedIfEmpty();
  } catch (err) {
    document.getElementById('itemGrid').innerHTML = `
      <div class="no-items">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Could not load items: ${err.message}</p>
      </div>`;
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const q = params.get('item') || params.get('q');
  if (q) document.getElementById('searchInput').value = q;

  renderItems();
  renderNotifications();

  document.getElementById('itemModal').addEventListener('click', e => {
    if (e.target === document.getElementById('itemModal')) closeModal();
  });
  document.getElementById('deleteModal').addEventListener('click', e => {
    if (e.target === document.getElementById('deleteModal')) closeDeleteModal();
  });
  document.getElementById('importModal').addEventListener('click', e => {
    if (e.target === document.getElementById('importModal')) closeImportModal();
  });
  document.getElementById('botAssistModal').addEventListener('click', e => {
    if (e.target === document.getElementById('botAssistModal')) closeBotAssistModal();
  });

  // Close search suggestions on outside click or Escape
  document.addEventListener('click', e => {
    const wrapper = document.querySelector('.search-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      const box = document.getElementById('searchSuggestions');
      if (box) box.style.display = 'none';
    }
  });
  document.getElementById('searchInput')?.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('searchSuggestions').style.display = 'none';
    }
  });
});

// ============================================================
// CSV IMPORT
// ============================================================
const VALID_CLASSES = ['food', 'medicine', 'cleaning', 'electronics', 'general'];
let parsedCSVRows = [];

// ── Template download ──────────────────────────────────────
function downloadTemplate() {
  const rows = [
    ['name', 'classification', 'room', 'location', 'locationDetail', 'qty', 'expirationDate', 'description'],
    ['Milk',          'food',        'living', 'Fridge Top Shelf',     '',                          '2', '2026-06-01', ''],
    ['Advil',         'medicine',    'living', 'Bathroom Cabinet',     'Left side of cabinet',      '20','2026-12-01', 'Pain reliever 200mg'],
    ['Dish Soap',     'cleaning',    'living', 'Under Kitchen Sink',   '',                          '1', '',           ''],
    ['Phone Charger', 'electronics', 'zq1',   'Bedroom Desk',         'Top drawer',                '1', '',           'USB-C'],
    ['Scissors',      'general',     'dar0',  'Office Drawer',        '',                          '2', '',           ''],
  ];
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'inventory_template.csv';
  a.click();
}

// ── Modal open/close ───────────────────────────────────────
function openImportModal() {
  resetImport();
  document.getElementById('importModal').classList.remove('hidden');
}

function closeImportModal() {
  document.getElementById('importModal').classList.add('hidden');
  resetImport();
}

function resetImport() {
  parsedCSVRows = [];
  document.getElementById('importStep1').style.display = '';
  document.getElementById('importStep2').style.display = 'none';
  document.getElementById('csvFileInput').value = '';
  document.getElementById('csvPreviewTable').innerHTML = '';
}

// ── CSV parsing ────────────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/^"|"$/g, '').trim());

  return lines.slice(1)
    .filter(line => line.trim())
    .map(line => {
      const values = parseCSVLine(line);
      const row = {};
      headers.forEach((h, i) => { row[h] = (values[i] || '').replace(/^"|"$/g, '').trim(); });
      return row;
    });
}

function validateRow(row) {
  const errors = [];
  const warnings = [];

  if (!row.name)     errors.push('Name is required');
  if (!row.location) errors.push('Location is required');

  let classification = (row.classification || '').toLowerCase();
  if (!VALID_CLASSES.includes(classification)) {
    warnings.push(`"${row.classification || ''}" → defaulted to "general"`);
    classification = 'general';
  }

  let qty = parseInt(row.qty);
  if (isNaN(qty) || qty < 0) {
    warnings.push('Invalid qty → defaulted to 1');
    qty = 1;
  }

  let expirationDate = row.expirationdate || row.expirationDate || '';
  if (expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
    warnings.push('Invalid date format (use YYYY-MM-DD) → cleared');
    expirationDate = '';
  }

  const VALID_ROOMS = ['living', 'zq1', 'dar0'];
  let room = (row.room || '').toLowerCase();
  if (!VALID_ROOMS.includes(room)) {
    if (room) warnings.push(`"${row.room}" room unknown → defaulted to "living"`);
    room = 'living';
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    item: {
      name:           row.name || '',
      classification,
      room,
      location:       row.location || '',
      locationDetail: row.locationdetail || row.locationDetail || '',
      qty,
      expirationDate: expirationDate || null,
      description:    row.description || '',
      image:          null,
    },
  };
}

// ── File handler + preview ─────────────────────────────────
function handleCSVFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    const raw = parseCSV(e.target.result);
    if (raw.length === 0) {
      alert('No data rows found. Make sure the file has a header row and at least one item row.');
      return;
    }
    parsedCSVRows = raw.map(validateRow);
    renderCSVPreview();
  };
  reader.readAsText(file);
}

function renderCSVPreview() {
  const validCount   = parsedCSVRows.filter(r => r.valid).length;
  const invalidCount = parsedCSVRows.length - validCount;

  const summary = document.getElementById('importSummary');
  summary.innerHTML =
    `<span class="csv-ok"><i class="fas fa-check-circle"></i> ${validCount} item${validCount !== 1 ? 's' : ''} ready</span>` +
    (invalidCount > 0 ? `&nbsp;&nbsp;<span class="csv-skip"><i class="fas fa-times-circle"></i> ${invalidCount} row${invalidCount !== 1 ? 's' : ''} will be skipped (missing name or location)</span>` : '');

  document.getElementById('confirmImportLabel').textContent = `Import ${validCount} Item${validCount !== 1 ? 's' : ''}`;
  document.getElementById('confirmImportBtn').disabled = validCount === 0;

  const table = document.getElementById('csvPreviewTable');
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Name</th>
        <th>Classification</th>
        <th>Room</th>
        <th>Location</th>
        <th>Qty</th>
        <th>Expiration</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${parsedCSVRows.map((r, i) => `
        <tr class="${r.valid ? (r.warnings.length ? 'row-warn' : 'row-ok') : 'row-error'}">
          <td>${i + 1}</td>
          <td>${r.item.name || '<em>missing</em>'}</td>
          <td>${r.item.classification}</td>
          <td>${ROOM_LABELS[r.item.room] || r.item.room}</td>
          <td>${r.item.location || '<em>missing</em>'}</td>
          <td>${r.item.qty}</td>
          <td>${r.item.expirationDate || '—'}</td>
          <td class="status-cell">
            ${r.errors.length   ? `<span class="csv-skip" title="${r.errors.join(', ')}"><i class="fas fa-times-circle"></i> Skip</span>` : ''}
            ${r.warnings.length ? `<span class="csv-warn" title="${r.warnings.join(', ')}"><i class="fas fa-exclamation-triangle"></i> Fixed</span>` : ''}
            ${!r.errors.length && !r.warnings.length ? '<span class="csv-ok"><i class="fas fa-check-circle"></i></span>' : ''}
          </td>
        </tr>
      `).join('')}
    </tbody>
  `;

  document.getElementById('importStep1').style.display = 'none';
  document.getElementById('importStep2').style.display = '';
}

// ============================================================
// BOT ASSIST
// ============================================================
let botAssistRoom = 'living';
let botParsedCSVRows = [];
let botRawCSVText = '';

function openBotAssistModal() {
  botAssistRoom = currentRoom;
  botParsedCSVRows = [];
  botRawCSVText = '';
  document.querySelectorAll('.bot-room-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.room === botAssistRoom);
  });
  setBotStep(1);
  document.getElementById('botAssistModal').classList.remove('hidden');
}

function closeBotAssistModal() {
  document.getElementById('botAssistModal').classList.add('hidden');
}

function setBotStep(n) {
  [1, 2, 3].forEach(i => {
    const content = document.getElementById(`botStepContent${i}`);
    const ind     = document.getElementById(`botStepInd${i}`);
    if (content) content.style.display = i === n ? '' : 'none';
    if (ind) {
      ind.classList.toggle('active', i === n);
      ind.classList.toggle('done',   i < n);
    }
  });
  // Reset step-3 sub-state whenever we enter it
  if (n === 3) {
    document.getElementById('botCSVInput').style.display   = '';
    document.getElementById('botPreviewArea').style.display = 'none';
    document.getElementById('botCSVPaste').value = '';
    document.querySelectorAll('.bot-csv-tab').forEach(b => b.classList.remove('active'));
    document.querySelector('.bot-csv-tab[data-tab="paste"]').classList.add('active');
    document.getElementById('botPasteArea').style.display   = '';
    document.getElementById('botUploadArea').style.display  = 'none';
    const fi = document.getElementById('botCSVFileInput');
    if (fi) fi.value = '';
  }
}

function selectBotRoom(btn) {
  document.querySelectorAll('.bot-room-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  botAssistRoom = btn.dataset.room;
}

// ── Prompt generation ──────────────────────────────────────
function generateBotPrompt(room) {
  const roomLabel = ROOM_LABELS[room];

  const existingLocations = [...new Set(
    allItems
      .filter(i => (i.room || 'living') === room)
      .map(i => i.location)
      .filter(Boolean)
  )];

  const locationContext = existingLocations.length > 0
    ? existingLocations.map(l => `  - ${l}`).join('\n')
    : '  (No existing storage spots recorded yet — feel free to suggest appropriate ones)';

  return `You are helping me organize household items into my ${roomLabel}.

## Your task:
1. Ask me to take a clear photo of the items I want to store and share it with you.
2. From the photo, identify each item (name, what it is, estimated quantity if visible).
3. Classify each item: food / medicine / cleaning / electronics / general
4. Suggest a specific storage location based on the room context below.
5. Present your suggestions in a table and let me confirm or adjust each one.
6. Once I confirm, output the final CSV in a code block.

## Room: ${roomLabel}
Known storage spots already in use in this room:
${locationContext}

## CSV output format (output inside \`\`\`csv ... \`\`\` when confirmed):
name,classification,room,location,locationDetail,qty,expirationDate,description

Column rules:
- name: item name
- classification: food / medicine / cleaning / electronics / general
- room: ${room}
- location: main storage spot (e.g. "Kitchen Cabinet", "Bathroom Shelf")
- locationDetail: more specific detail (e.g. "Top shelf, left side") — can be left blank
- qty: number, default to 1 if not clearly visible
- expirationDate: YYYY-MM-DD for food/medicine if visible, otherwise leave blank
- description: brief optional description

## Rules:
- First, ask me to take a photo of the items laid out on a flat, well-lit surface and share it
- Identify every distinct item visible in the photo
- Reuse the existing storage spots listed above when logical; suggest new ones only when needed
- Show suggestions in a clear table (item → suggested location) before asking for confirmation
- Allow me to adjust any suggestion before finalizing
- Output the final CSV in a \`\`\`csv code block so I can copy it easily

Let's begin — please ask me to share my photo.`;
}

function showBotPromptStep() {
  document.getElementById('botPromptText').value = generateBotPrompt(botAssistRoom);
  setBotStep(2);
}

async function copyBotPrompt() {
  const text = document.getElementById('botPromptText').value;
  const btn  = document.getElementById('copyPromptBtn');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    document.getElementById('botPromptText').select();
    document.execCommand('copy');
  }
  btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
  setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy Prompt'; }, 2000);
}

// ── Step 3: CSV tab switch ─────────────────────────────────
function switchBotCSVTab(btn) {
  document.querySelectorAll('.bot-csv-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const tab = btn.dataset.tab;
  document.getElementById('botPasteArea').style.display  = tab === 'paste'  ? '' : 'none';
  document.getElementById('botUploadArea').style.display = tab === 'upload' ? '' : 'none';
}

// Strip ```csv ... ``` wrapper that chatbots commonly output
function extractCSVFromText(text) {
  const match = text.match(/```(?:csv)?\s*\n?([\s\S]*?)```/i);
  return match ? match[1].trim() : text.trim();
}

function previewBotCSVFromPaste() {
  const raw = document.getElementById('botCSVPaste').value.trim();
  if (!raw) { alert('Please paste your CSV text first.'); return; }
  const csv = extractCSVFromText(raw);
  botRawCSVText = csv;
  parseBotAndRender(csv);
}

function handleBotCSVFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const csv = extractCSVFromText(e.target.result);
    botRawCSVText = csv;
    parseBotAndRender(csv);
  };
  reader.readAsText(file);
}

function parseBotAndRender(csvText) {
  const raw = parseCSV(csvText);
  if (raw.length === 0) {
    alert('No data rows found. Make sure the CSV has a header row and at least one item.');
    return;
  }
  botParsedCSVRows = raw.map(validateRow);
  renderBotCSVPreview();
}

function renderBotCSVPreview() {
  const validCount   = botParsedCSVRows.filter(r => r.valid).length;
  const invalidCount = botParsedCSVRows.length - validCount;

  document.getElementById('botImportSummary').innerHTML =
    `<span class="csv-ok"><i class="fas fa-check-circle"></i> ${validCount} item${validCount !== 1 ? 's' : ''} ready</span>` +
    (invalidCount > 0
      ? `&nbsp;&nbsp;<span class="csv-skip"><i class="fas fa-times-circle"></i> ${invalidCount} row${invalidCount !== 1 ? 's' : ''} will be skipped</span>`
      : '');

  document.getElementById('botConfirmLabel').textContent = `Import ${validCount} Item${validCount !== 1 ? 's' : ''}`;
  document.getElementById('botConfirmImportBtn').disabled = validCount === 0;

  document.getElementById('botCSVPreviewTable').innerHTML = `
    <thead>
      <tr>
        <th>#</th><th>Name</th><th>Classification</th><th>Room</th>
        <th>Location</th><th>Qty</th><th>Expiration</th><th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${botParsedCSVRows.map((r, i) => `
        <tr class="${r.valid ? (r.warnings.length ? 'row-warn' : 'row-ok') : 'row-error'}">
          <td>${i + 1}</td>
          <td>${r.item.name || '<em>missing</em>'}</td>
          <td>${r.item.classification}</td>
          <td>${ROOM_LABELS[r.item.room] || r.item.room}</td>
          <td>${r.item.location || '<em>missing</em>'}</td>
          <td>${r.item.qty}</td>
          <td>${r.item.expirationDate || '—'}</td>
          <td class="status-cell">
            ${r.errors.length   ? `<span class="csv-skip" title="${r.errors.join(', ')}"><i class="fas fa-times-circle"></i> Skip</span>` : ''}
            ${r.warnings.length ? `<span class="csv-warn" title="${r.warnings.join(', ')}"><i class="fas fa-exclamation-triangle"></i> Fixed</span>` : ''}
            ${!r.errors.length && !r.warnings.length ? '<span class="csv-ok"><i class="fas fa-check-circle"></i></span>' : ''}
          </td>
        </tr>
      `).join('')}
    </tbody>
  `;

  document.getElementById('botCSVInput').style.display   = 'none';
  document.getElementById('botPreviewArea').style.display = '';
}

function resetBotCSVInput() {
  document.getElementById('botCSVInput').style.display   = '';
  document.getElementById('botPreviewArea').style.display = 'none';
  const fi = document.getElementById('botCSVFileInput');
  if (fi) fi.value = '';
}

function downloadBotCSV() {
  if (!botRawCSVText) return;
  const blob = new Blob([botRawCSVText], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `bot_assist_${botAssistRoom}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

async function confirmBotImport() {
  const validItems = botParsedCSVRows.filter(r => r.valid).map(r => r.item);
  if (validItems.length === 0) return;

  const btn = document.getElementById('botConfirmImportBtn');
  btn.disabled  = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';

  try {
    const res = await fetch('/api/items/bulk', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body:    JSON.stringify({ items: validItems }),
    });
    if (!res.ok) throw new Error('Server error');
    const { inserted } = await res.json();

    closeBotAssistModal();
    allItems = await fetchItems();
    renderItems();
    renderNotifications();
    alert(`Successfully imported ${inserted} item${inserted !== 1 ? 's' : ''}!`);
  } catch (err) {
    alert('Import failed: ' + err.message);
    btn.disabled  = false;
    btn.innerHTML = `<i class="fas fa-database"></i> <span id="botConfirmLabel">Import ${validItems.length} Items</span>`;
  }
}

// ── Confirm & bulk POST ────────────────────────────────────
async function confirmImport() {
  const validItems = parsedCSVRows.filter(r => r.valid).map(r => r.item);
  if (validItems.length === 0) return;

  const btn = document.getElementById('confirmImportBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';

  try {
    const res = await fetch('/api/items/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ items: validItems }),
    });
    if (!res.ok) throw new Error('Server error');
    const { inserted } = await res.json();

    closeImportModal();
    allItems = await fetchItems();
    renderItems();
    renderNotifications();
    alert(`Successfully imported ${inserted} item${inserted !== 1 ? 's' : ''}!`);
  } catch (err) {
    alert('Import failed: ' + err.message);
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-database"></i> <span id="confirmImportLabel">Import ${validItems.length} Items</span>`;
  }
}
