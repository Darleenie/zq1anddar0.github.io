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
  document.getElementById('importModal').addEventListener('click', e => {
    if (e.target === document.getElementById('importModal')) closeImportModal();
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
    ['name', 'classification', 'location', 'qty', 'expirationDate', 'description'],
    ['Milk', 'food', 'Fridge Top Shelf', '2', '2026-06-01', ''],
    ['Advil', 'medicine', 'Bathroom Cabinet', '20', '2026-12-01', 'Pain reliever 200mg'],
    ['Dish Soap', 'cleaning', 'Under Kitchen Sink', '1', '', ''],
    ['Phone Charger', 'electronics', 'Bedroom Desk', '1', '', 'USB-C'],
    ['Scissors', 'general', 'Office Drawer', '2', '', ''],
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

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    item: {
      name:           row.name || '',
      classification,
      location:       row.location || '',
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
      headers: { 'Content-Type': 'application/json' },
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
