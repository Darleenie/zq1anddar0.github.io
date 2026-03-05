const SKIP_KEY = 'lowStockSkipUntil';
const LOW_STOCK_THRESHOLD = 2;
const CONSUMABLE_CLASSES = ['food', 'medicine', 'hygiene', 'cleaning'];

let _pendingLowStockItems = [];

document.addEventListener('DOMContentLoaded', () => {
  if (!isLoggedIn()) { openLoginModal(); return; }
  loadCart();
  loadLists();
});

// ── Cart ─────────────────────────────────────────────────────

async function loadCart() {
  const res = await fetch('/api/cart', { headers: { ...authHeaders() } });
  const items = await res.json();
  renderCart(items);
}

function renderCart(items) {
  const list = document.getElementById('cartList');
  const clearBtn = document.getElementById('clearCartBtn');
  const genBtn = document.getElementById('generateBtn');

  if (!items.length) {
    list.innerHTML = '<p class="empty-state"><i class="fas fa-shopping-basket"></i> Your cart is empty.<br>Add items from <a href="/pages/search.html">Find My Stuff</a>.</p>';
    clearBtn.style.display = 'none';
    genBtn.disabled = true;
    return;
  }

  clearBtn.style.display = '';
  genBtn.disabled = false;
  list.innerHTML = items.map(item => `
    <div class="shop-cart-item">
      <span class="shop-cart-name">${item.name}</span>
      <span class="shop-cart-qty">×${item.qty}</span>
      <button class="btn-icon btn-del" onclick="removeFromCart('${item.id}')" title="Remove">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `).join('');
}

async function removeFromCart(id) {
  await fetch(`/api/cart/items/${id}`, { method: 'DELETE', headers: { ...authHeaders() } });
  loadCart();
}

async function clearCart() {
  if (!confirm('Clear your entire cart?')) return;
  await fetch('/api/cart', { method: 'DELETE', headers: { ...authHeaders() } });
  loadCart();
}

// ── Generate modal ───────────────────────────────────────────

async function openGenerateModal() {
  const skipUntil = localStorage.getItem(SKIP_KEY);
  if (skipUntil && Date.now() < Number(skipUntil)) {
    generateList([]);
    return;
  }

  // Fetch low-stock items
  const res = await fetch('/api/items', { headers: { ...authHeaders() } });
  const items = await res.json();
  const lowStock = items.filter(i => {
    const qty = Number(i.qty);
    return qty === 0 || (qty <= LOW_STOCK_THRESHOLD && CONSUMABLE_CLASSES.includes(i.classification));
  });

  if (!lowStock.length) {
    generateList([]);
    return;
  }

  _pendingLowStockItems = lowStock;
  const box = document.getElementById('lowStockCheckboxes');
  box.innerHTML = lowStock.map((it, idx) => `
    <label class="low-stock-row">
      <input type="checkbox" id="ls_${idx}" checked />
      <span>${it.name}</span>
      <span class="shop-qty-badge">qty ${it.qty}</span>
    </label>
  `).join('');
  document.getElementById('dontRemindCheck').checked = false;
  document.getElementById('lowStockModal').classList.remove('hidden');
}

function closeLowStockModal() {
  document.getElementById('lowStockModal').classList.add('hidden');
}

function confirmGenerate(includeChecked) {
  let extras = [];
  if (includeChecked) {
    extras = _pendingLowStockItems
      .filter((_, idx) => document.getElementById(`ls_${idx}`)?.checked)
      .map(it => ({ name: it.name, qty: 1, note: 'Low stock', isLowStock: true }));
  }
  if (document.getElementById('dontRemindCheck').checked) {
    localStorage.setItem(SKIP_KEY, Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  closeLowStockModal();
  generateList(extras);
}

// ── Generate list ────────────────────────────────────────────

async function generateList(extras) {
  // Get current cart items to form the list body
  const cartRes = await fetch('/api/cart', { headers: { ...authHeaders() } });
  const cartItems = await cartRes.json();

  const allItems = [
    ...cartItems.map(i => ({ name: i.name, qty: i.qty, note: i.note || '', isLowStock: false })),
    ...extras,
  ];

  await fetch('/api/shopping-lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ items: allItems }),
  });

  // Clear cart after generating
  await fetch('/api/cart', { method: 'DELETE', headers: { ...authHeaders() } });
  loadCart();
  loadLists();
}

// ── Shopping lists ────────────────────────────────────────────

async function loadLists() {
  const res = await fetch('/api/shopping-lists', { headers: { ...authHeaders() } });
  const lists = await res.json();
  renderLists(lists);
}

function renderLists(lists) {
  const container = document.getElementById('shoppingLists');
  if (!lists.length) {
    container.innerHTML = '<p class="empty-state"><i class="fas fa-clipboard"></i> No shopping lists yet.</p>';
    return;
  }
  container.innerHTML = lists.map(list => {
    const date = new Date(list.createdAt).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
    const badge = list.completed
      ? `<span class="list-complete-badge"><i class="fas fa-check-circle"></i> Completed</span>`
      : `<span class="list-incomplete-badge"><i class="fas fa-clock"></i> In progress</span>`;
    const rows = list.items.map(it => `
      <div class="shop-item-row">
        <span class="shop-item-name">${it.name}</span>
        <span class="shop-item-qty">×${it.qty}</span>
        ${it.isLowStock ? `<span class="low-stock-badge">Low stock</span>` : ''}
        ${it.note && !it.isLowStock ? `<span class="shop-item-note">${it.note}</span>` : ''}
      </div>
    `).join('');

    return `
      <div class="ready-to-shop-card ${list.completed ? 'list-done' : ''}">
        <div class="ready-to-shop-header">
          <span><i class="fas fa-shopping-cart"></i> READY TO SHOP!</span>
          ${badge}
        </div>
        <div class="list-meta">
          <span><i class="fas fa-user"></i> ${list.createdBy}</span>
          <span><i class="fas fa-calendar"></i> ${date}</span>
        </div>
        <div class="shop-items-body">${rows}</div>
        <div class="list-actions">
          <button class="btn-secondary btn-sm" onclick="toggleComplete('${list._id}', ${list.completed})">
            <i class="fas fa-${list.completed ? 'rotate-left' : 'check'}"></i>
            ${list.completed ? 'Mark incomplete' : 'Mark complete'}
          </button>
          <button class="btn-icon btn-del" onclick="deleteList('${list._id}')" title="Delete list">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleComplete(id, current) {
  await fetch(`/api/shopping-lists/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ completed: !current }),
  });
  loadLists();
}

async function deleteList(id) {
  if (!confirm('Delete this shopping list?')) return;
  await fetch(`/api/shopping-lists/${id}`, { method: 'DELETE', headers: { ...authHeaders() } });
  loadLists();
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  const modal = document.getElementById('lowStockModal');
  if (modal && e.target === modal) closeLowStockModal();
});
