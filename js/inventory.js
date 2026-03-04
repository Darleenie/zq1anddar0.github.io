// ============================================================
// API CALLS
// ============================================================
async function fetchItems() {
  const res = await fetch('/api/items');
  if (!res.ok) throw new Error('Failed to fetch items');
  return res.json();
}

async function apiAddItem(item) {
  const res = await fetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error('Failed to add item');
  return res.json();
}

async function apiUpdateItem(id, updates) {
  const res = await fetch(`/api/items/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update item');
}

async function apiDeleteItem(id) {
  const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete item');
}

// ============================================================
// IN-MEMORY CACHE
// ============================================================
let allItems = [];

// ============================================================
// NOTIFICATION LOGIC
// ============================================================
const CONSUMABLE_CLASSES = ['food', 'medicine', 'cleaning'];
const LOW_STOCK_THRESHOLD = 2;
const EXPIRY_WARN_DAYS = 14;

function getItemAlerts(item) {
  const alerts = [];
  const qty = Number(item.qty);

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
  allItems.forEach(item => getItemAlerts(item).forEach(a => allAlerts.push({ ...a, name: item.name })));

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
        <span class="notif-item notif-${a.type}"><strong>${a.name}</strong>: ${a.msg}</span>
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
  const grid = document.getElementById('itemGrid');
  let items = [...allItems];

  if (currentFilter !== 'all') items = items.filter(i => i.classification === currentFilter);
  if (query) {
    items = items.filter(i =>
      i.name.toLowerCase().includes(query) ||
      i.location.toLowerCase().includes(query) ||
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
    const alertBadges = alerts.map(a => `<span class="alert-badge badge-${a.type}">${a.msg}</span>`).join('');
    const color = CLASS_COLORS[item.classification] || '#999';
    const expText = item.expirationDate
      ? `<p class="item-exp"><i class="fas fa-calendar-alt"></i> Exp: ${formatDate(item.expirationDate)}</p>`
      : '';
    const imgContent = item.image
      ? `<img src="${item.image}" alt="${item.name}" onerror="this.parentElement.classList.add('img-failed')" />`
      : '';
    const id = item._id;

    return `
      <div class="item-card ${alerts.some(a => a.type === 'danger') ? 'card-danger' : alerts.length > 0 ? 'card-warning' : ''}">
        <div class="card-img-wrap ${!item.image ? 'no-img' : ''}">
          ${imgContent}
          ${!item.image ? '<i class="fas fa-box-open card-img-icon"></i>' : ''}
        </div>
        <div class="card-body">
          <div class="card-top">
            <span class="class-badge" style="background:${color}">${capitalize(item.classification)}</span>
            ${alertBadges}
          </div>
          <h3 class="item-name">${item.name}</h3>
          ${item.description ? `<p class="item-desc">${item.description}</p>` : ''}
          <p class="item-loc"><i class="fas fa-map-marker-alt"></i> ${item.location}</p>
          <p class="item-qty"><i class="fas fa-box"></i> Qty: <strong>${item.qty}</strong></p>
          ${expText}
          <div class="card-actions">
            <button class="btn-icon" onclick="openEditModal('${id}')" title="Edit"><i class="fas fa-edit"></i></button>
            <button class="btn-icon btn-del" onclick="openDeleteModal('${id}')" title="Delete"><i class="fas fa-trash"></i></button>
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

function openAddModal() {
  editingId = null;
  pendingImageData = null;
  document.getElementById('modalTitle').textContent = 'Add Item';
  document.getElementById('submitBtn').textContent = 'Add Item';
  document.getElementById('itemForm').reset();
  document.getElementById('imgPreview').innerHTML = '';
  document.getElementById('expDateGroup').style.display = 'none';
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
  document.getElementById('f-qty').value = item.qty ?? 1;
  document.getElementById('f-exp').value = item.expirationDate || '';
  document.getElementById('f-img-url').value = (item.image && !item.image.startsWith('data:')) ? item.image : '';

  toggleExpDate();

  document.getElementById('imgPreview').innerHTML = item.image
    ? `<img src="${item.image}" alt="preview" />`
    : '';

  document.getElementById('itemModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('itemModal').classList.add('hidden');
  editingId = null;
  pendingImageData = null;
}

function toggleExpDate() {
  const cls = document.getElementById('f-class').value;
  document.getElementById('expDateGroup').style.display = ['food', 'medicine'].includes(cls) ? '' : 'none';
}

function previewImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    pendingImageData = e.target.result;
    document.getElementById('imgPreview').innerHTML = `<img src="${e.target.result}" alt="preview" />`;
    document.getElementById('f-img-url').value = '';
  };
  reader.readAsDataURL(file);
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

async function submitItem(e) {
  e.preventDefault();
  const item = {
    name:           document.getElementById('f-name').value.trim(),
    description:    document.getElementById('f-desc').value.trim(),
    classification: document.getElementById('f-class').value,
    location:       document.getElementById('f-loc').value.trim(),
    qty:            parseInt(document.getElementById('f-qty').value),
    expirationDate: document.getElementById('f-exp').value || null,
    image:          pendingImageData || null,
  };

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
    { name: 'Bowls',       description: 'Ceramic dinner bowls',    classification: 'general',     location: 'Right Kitchen Cabinet, Second Floor', qty: 4, expirationDate: null, image: null },
    { name: 'Switch',      description: 'Nintendo Switch console',  classification: 'electronics', location: 'Living Room Desk',                    qty: 1, expirationDate: null, image: null },
    { name: 'Shoe Cleaner',description: 'Shoe cleaning spray',      classification: 'cleaning',    location: 'Entrance Brown Cabinet',              qty: 1, expirationDate: null, image: null },
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
});
