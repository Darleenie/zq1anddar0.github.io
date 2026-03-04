// ============================================================
// CONSTANTS
// ============================================================
const ROOM_LABELS = { living: 'Living Room', zq1: "zq1's Room", dar0: "dar0's Room" };
const ROOM_COLORS = { living: '#5C3D1E', zq1: '#1565C0', dar0: '#6A1B9A' };

// ============================================================
// STATE
// ============================================================
let allTags         = [];
let selectedTagRoom = 'living';
let editingTagId    = null;   // null = new tag, string = editing existing
let pendingUnregisterId = null;

// ============================================================
// LOAD
// ============================================================
async function loadTags() {
  try {
    const res = await fetch('/api/nfc', { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    allTags = await res.json();
    renderTags();
  } catch (err) {
    document.getElementById('tagGrid').innerHTML = `
      <div class="no-items">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Could not load tags: ${err.message}</p>
      </div>`;
  }
}

function renderTags() {
  const grid = document.getElementById('tagGrid');
  if (allTags.length === 0) {
    grid.innerHTML = `
      <div class="no-items">
        <i class="fas fa-tag"></i>
        <p>No NFC tags registered yet.<br>Click <strong>Register New Tag</strong> to add one.</p>
      </div>`;
    return;
  }

  grid.innerHTML = allTags.map(tag => `
    <div class="nfc-tag-card" id="tc-${tag.tagId}">
      <div class="nfc-tag-card-body">
        <div class="nfc-tag-header">
          <span class="nfc-room-badge" style="background:${ROOM_COLORS[tag.room] || '#555'}">
            ${ROOM_LABELS[tag.room] || tag.room}
          </span>
        </div>
        <h3 class="nfc-tag-label">${tag.label}</h3>
        <p class="nfc-tag-loc"><i class="fas fa-map-marker-alt"></i> ${tag.location}</p>
        ${tag.locationDetail ? `<p class="nfc-tag-loc-detail"><i class="fas fa-info-circle"></i> ${tag.locationDetail}</p>` : ''}
      </div>
      <div class="nfc-tag-actions">
        <a href="/pages/nfc.html?tag=${encodeURIComponent(tag.tagId)}" class="btn-secondary nfc-tag-open-btn">
          <i class="fas fa-external-link-alt"></i> Open
        </a>
        <button class="btn-secondary" onclick="openCopyURL('${tag.tagId}')">
          <i class="fas fa-link"></i> URL
        </button>
        <button class="btn-secondary" onclick="openEditTag('${tag.tagId}')">
          <i class="fas fa-edit"></i> Edit
        </button>
        <button class="btn-danger" onclick="openUnregisterModal('${tag.tagId}', '${tag.label.replace(/'/g, "\\'")}')">
          <i class="fas fa-unlink"></i>
        </button>
      </div>
    </div>
  `).join('');
}

// ============================================================
// REGISTER MODAL
// ============================================================
function openRegisterModal() {
  editingTagId = null;
  document.getElementById('tagModalTitle').textContent = 'Register New Tag';
  document.getElementById('tagSaveBtn').textContent    = 'Register';
  document.getElementById('t-label').value            = '';
  document.getElementById('t-loc').value              = '';
  document.getElementById('t-loc-detail').value       = '';
  document.getElementById('tagURLSection').style.display = 'none';
  document.querySelector('#tagModal form').style.display = '';

  selectedTagRoom = 'living';
  document.querySelectorAll('#tagRoomSelector .room-sel-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.room === 'living');
  });

  document.getElementById('tagModal').classList.remove('hidden');
}

function openEditTag(tagId) {
  const tag = allTags.find(t => t.tagId === tagId);
  if (!tag) return;

  editingTagId = tagId;
  document.getElementById('tagModalTitle').textContent = 'Edit Tag';
  document.getElementById('tagSaveBtn').textContent    = 'Save Changes';
  document.getElementById('t-label').value            = tag.label;
  document.getElementById('t-loc').value              = tag.location;
  document.getElementById('t-loc-detail').value       = tag.locationDetail || '';
  document.getElementById('tagURLSection').style.display = 'none';
  document.querySelector('#tagModal form').style.display = '';

  selectedTagRoom = tag.room || 'living';
  document.querySelectorAll('#tagRoomSelector .room-sel-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.room === selectedTagRoom);
  });

  document.getElementById('tagModal').classList.remove('hidden');
}

function closeTagModal() {
  document.getElementById('tagModal').classList.add('hidden');
  editingTagId = null;
}

function selectTagRoom(btn) {
  document.querySelectorAll('#tagRoomSelector .room-sel-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedTagRoom = btn.dataset.room;
}

async function submitTagForm(e) {
  e.preventDefault();
  const btn = document.getElementById('tagSaveBtn');
  btn.disabled = true;

  const data = {
    label:          document.getElementById('t-label').value.trim(),
    room:           selectedTagRoom,
    location:       document.getElementById('t-loc').value.trim(),
    locationDetail: document.getElementById('t-loc-detail').value.trim() || null,
  };

  try {
    if (editingTagId) {
      // Update existing
      const res = await fetch(`/api/nfc/${encodeURIComponent(editingTagId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const idx = allTags.findIndex(t => t.tagId === editingTagId);
      if (idx !== -1) allTags[idx] = { ...allTags[idx], ...data };
      closeTagModal();
      renderTags();
      showToast('Tag updated');
    } else {
      // Register new — generate UUID
      const tagId = crypto.randomUUID();
      const res = await fetch('/api/nfc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ...data, tagId }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const created = await res.json();
      allTags.push(created);
      renderTags();

      // Show URL for NFC writing
      const url = `${window.location.origin}/pages/nfc.html?tag=${encodeURIComponent(tagId)}`;
      document.getElementById('tagURLText').textContent = url;
      document.querySelector('#tagModal form').style.display = 'none';
      document.getElementById('tagURLSection').style.display = '';
    }
  } catch (err) {
    showToast(`Failed: ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// COPY URL
// ============================================================
function openCopyURL(tagId) {
  const url = `${window.location.origin}/pages/nfc.html?tag=${encodeURIComponent(tagId)}`;
  document.getElementById('tagURLText').textContent = url;
  document.querySelector('#tagModal form').style.display = 'none';
  document.getElementById('tagURLSection').style.display = '';
  document.getElementById('tagModalTitle').textContent = 'NFC Tag URL';
  document.getElementById('tagModal').classList.remove('hidden');
}

function copyTagURL() {
  const url  = document.getElementById('tagURLText').textContent;
  const btn  = document.getElementById('copyURLBtn');
  navigator.clipboard.writeText(url).then(() => {
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 2000);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 2000);
  });
}

// ============================================================
// UNREGISTER MODAL
// ============================================================
function openUnregisterModal(tagId, label) {
  pendingUnregisterId = tagId;
  document.getElementById('unregisterTagLabel').textContent = label;
  document.getElementById('unregisterModal').classList.remove('hidden');
}

function closeUnregisterModal() {
  pendingUnregisterId = null;
  document.getElementById('unregisterModal').classList.add('hidden');
}

async function confirmUnregister() {
  if (!pendingUnregisterId) return;
  try {
    const res = await fetch(`/api/nfc/${encodeURIComponent(pendingUnregisterId)}`, { method: 'DELETE', headers: { ...authHeaders() } });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    allTags = allTags.filter(t => t.tagId !== pendingUnregisterId);
    closeUnregisterModal();
    renderTags();
    showToast('Tag unregistered');
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

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  if (!isLoggedIn()) { openLoginModal(); return; }
  loadTags();
  document.getElementById('tagModal').addEventListener('click', e => {
    if (e.target === document.getElementById('tagModal')) closeTagModal();
  });
  document.getElementById('unregisterModal').addEventListener('click', e => {
    if (e.target === document.getElementById('unregisterModal')) closeUnregisterModal();
  });
});
