const SKIP_KEY = 'lowStockSkipUntil';
const LOW_STOCK_THRESHOLD = 2;
const CONSUMABLE_CLASSES = ['food', 'medicine', 'hygiene', 'cleaning'];

let _pendingLowStockItems = [];
let _allLists = [];

// ── Complete modal state ─────────────────────────────────────
let _completingListId = null;
let _receiptBase64    = null;
let _mode             = 'bot';   // 'bot' | 'manual'
let _pricedItems      = [];      // [{ name, qty, unitPrice, lineTotal }]
let _totalAmount      = 0;
let _splitMethod      = 'even';
let _prevStep3        = 'cstep-2-bot';

document.addEventListener('DOMContentLoaded', () => {
  if (!isLoggedIn()) { openLoginModal(); return; }
  loadCart();
  loadLists();
});

// ── Cart ─────────────────────────────────────────────────────

async function loadCart() {
  const res   = await fetch('/api/cart', { headers: { ...authHeaders() } });
  const items = await res.json();
  renderCart(items);
}

function renderCart(items) {
  const list     = document.getElementById('cartList');
  const clearBtn = document.getElementById('clearCartBtn');
  const genBtn   = document.getElementById('generateBtn');

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

// ── Generate (low-stock modal) ────────────────────────────────

async function openGenerateModal() {
  const skipUntil = localStorage.getItem(SKIP_KEY);
  if (skipUntil && Date.now() < Number(skipUntil)) { generateList([]); return; }

  const res      = await fetch('/api/items', { headers: { ...authHeaders() } });
  const items    = await res.json();
  const lowStock = items.filter(i => {
    const qty = Number(i.qty);
    return qty === 0 || (qty <= LOW_STOCK_THRESHOLD && CONSUMABLE_CLASSES.includes(i.classification));
  });

  if (!lowStock.length) { generateList([]); return; }

  _pendingLowStockItems = lowStock;
  document.getElementById('lowStockCheckboxes').innerHTML = lowStock.map((it, idx) => `
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
  const extras = includeChecked
    ? _pendingLowStockItems
        .filter((_, idx) => document.getElementById(`ls_${idx}`)?.checked)
        .map(it => ({ name: it.name, qty: 1, note: 'Low stock', isLowStock: true }))
    : [];
  if (document.getElementById('dontRemindCheck').checked) {
    localStorage.setItem(SKIP_KEY, Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  closeLowStockModal();
  generateList(extras);
}

async function generateList(extras) {
  const cartRes   = await fetch('/api/cart', { headers: { ...authHeaders() } });
  const cartItems = await cartRes.json();
  const allItems  = [
    ...cartItems.map(i => ({ name: i.name, qty: i.qty, note: i.note || '', isLowStock: false })),
    ...extras,
  ];

  await fetch('/api/shopping-lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ items: allItems }),
  });

  await fetch('/api/cart', { method: 'DELETE', headers: { ...authHeaders() } });
  loadCart();
  loadLists();
}

// ── Shopping lists ────────────────────────────────────────────

async function loadLists() {
  const res = await fetch('/api/shopping-lists', { headers: { ...authHeaders() } });
  _allLists = await res.json();
  renderLists(_allLists);
}

function renderLists(lists) {
  const container = document.getElementById('shoppingLists');
  if (!lists.length) {
    container.innerHTML = '<p class="empty-state"><i class="fas fa-clipboard"></i> No shopping lists yet.</p>';
    return;
  }
  container.innerHTML = lists.map(list => {
    const date  = new Date(list.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
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

    const actionBtn = list.completed
      ? `<button class="btn-secondary btn-sm" onclick="revertComplete('${list._id}')">
           <i class="fas fa-rotate-left"></i> Mark incomplete
         </button>`
      : `<button class="btn-primary btn-sm" onclick="openCompleteModal('${list._id}')">
           <i class="fas fa-check"></i> Mark complete
         </button>`;

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
          ${actionBtn}
          <button class="btn-icon btn-del" onclick="deleteList('${list._id}')" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function revertComplete(id) {
  await fetch(`/api/shopping-lists/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ completed: false }),
  });
  loadLists();
}

async function deleteList(id) {
  if (!confirm('Delete this shopping list?')) return;
  await fetch(`/api/shopping-lists/${id}`, { method: 'DELETE', headers: { ...authHeaders() } });
  loadLists();
}

// ── Complete modal helpers ────────────────────────────────────

function showCStep(id) {
  ['cstep-1', 'cstep-2-bot', 'cstep-2-manual', 'cstep-3'].forEach(s => {
    document.getElementById(s).style.display = s === id ? '' : 'none';
  });
}

function openCompleteModal(id) {
  const list = _allLists.find(l => String(l._id) === String(id));
  _completingListId = id;
  _receiptBase64    = null;
  _mode             = 'bot';
  _splitMethod      = 'even';
  _totalAmount      = 0;
  _pricedItems      = list
    ? list.items.map(i => ({ name: i.name, qty: Number(i.qty) || 1, unitPrice: 0, lineTotal: 0 }))
    : [];

  // Reset step 1
  const fi = document.getElementById('cReceiptFile');
  if (fi) fi.value = '';
  document.getElementById('cReceiptPreview').innerHTML = '';
  document.querySelectorAll('#cstep-1 .room-sel-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  document.getElementById('modeDesc').textContent = 'Enter price per item — bot calculates totals & generates a CSV.';

  showCStep('cstep-1');
  document.getElementById('completeModal').classList.remove('hidden');
}

function closeCompleteModal() {
  document.getElementById('completeModal').classList.add('hidden');
}

// ── Step 1 ────────────────────────────────────────────────────

function selectMode(btn) {
  document.querySelectorAll('#cstep-1 .room-sel-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _mode = btn.dataset.mode;
  document.getElementById('modeDesc').textContent = _mode === 'bot'
    ? 'Enter price per item — bot calculates totals & generates a CSV.'
    : 'Enter the total amount paid directly.';
}

function previewReceipt(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _receiptBase64 = e.target.result;
    document.getElementById('cReceiptPreview').innerHTML =
      `<img src="${e.target.result}" style="max-width:100%;max-height:130px;border-radius:6px;margin-top:4px" />`;
  };
  reader.readAsDataURL(file);
}

function cStep1Next() {
  if (_mode === 'bot') {
    renderPrompt();
    document.getElementById('cCsvInput').value = '';
    document.getElementById('cBotParseError').style.display = 'none';
    showCStep('cstep-2-bot');
  } else {
    document.getElementById('cTotalAmount').value = '';
    showCStep('cstep-2-manual');
  }
}

// ── Step 2 — Bot Assist: prompt + CSV paste ───────────────────

function renderPrompt() {
  const itemList = _pricedItems.map(i => `- ${i.name} ×${i.qty}`).join('\n');
  document.getElementById('cPromptText').value =
`I have a shopping receipt. Here are the items I bought:
${itemList}

Please analyze the attached receipt image and return ONLY a CSV with these exact columns:
Item,Qty,Unit Price,Total

Rules:
- Match each item from my list to the receipt price
- Unit Price = price per single unit
- Total = Unit Price × Qty
- Format numbers with 2 decimal places (e.g. 3.50)
- Last row must be: Grand Total,,,XX.XX
- No extra text, no markdown, just the raw CSV`;
}

function copyPrompt() {
  const text = document.getElementById('cPromptText').value;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyPromptBtn');
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 2000);
  });
}

function parseCSVRow(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur.trim());
  return cols;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  let grandTotal = 0;
  for (const line of lines) {
    if (/^item/i.test(line)) continue; // skip header
    const cols = parseCSVRow(line);
    if (cols.length < 2) continue;
    const name      = cols[0].replace(/^"|"$/g, '').trim();
    const qty       = parseFloat(cols[1]) || 1;
    const unitPrice = parseFloat(cols[2]) || 0;
    const lineTotal = parseFloat(cols[3]) || Math.round(unitPrice * qty * 100) / 100;
    if (/grand.?total/i.test(name)) { grandTotal = parseFloat(cols[3]) || lineTotal; continue; }
    if (name) items.push({ name, qty, unitPrice, lineTotal });
  }
  if (!grandTotal) grandTotal = Math.round(items.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
  return { items, grandTotal };
}

function cBotNext() {
  const csvText = document.getElementById('cCsvInput').value.trim();
  const errEl   = document.getElementById('cBotParseError');

  if (!csvText) {
    errEl.textContent = 'Please paste the CSV output from your chatbot first.';
    errEl.style.display = '';
    return;
  }

  try {
    const { items, grandTotal } = parseCSV(csvText);
    if (!items.length) throw new Error('No items found — check the CSV format.');

    _pricedItems = items;
    _totalAmount = grandTotal;
    _prevStep3   = 'cstep-2-bot';
    errEl.style.display = 'none';

    // Build review table for step 3
    document.getElementById('cCsvPreview').style.display = '';
    document.getElementById('cCsvPreview').innerHTML = `
      <table class="csv-preview-table" style="width:100%">
        <thead><tr><th>Item</th><th>Qty</th><th>Unit $</th><th>Total</th></tr></thead>
        <tbody>
          ${_pricedItems.map(it => `
            <tr>
              <td>${it.name}</td>
              <td style="text-align:center">${it.qty}</td>
              <td style="text-align:right">$${Number(it.unitPrice).toFixed(2)}</td>
              <td style="text-align:right">$${Number(it.lineTotal).toFixed(2)}</td>
            </tr>
          `).join('')}
          <tr class="csv-total-row">
            <td colspan="3"><strong>Grand Total</strong></td>
            <td style="text-align:right"><strong>$${_totalAmount.toFixed(2)}</strong></td>
          </tr>
        </tbody>
      </table>
      <p style="font-size:0.75rem;color:#aaa;margin-top:6px">
        <i class="fas fa-file-csv"></i> This CSV will be attached to the email.
      </p>
    `;
    document.getElementById('cTotalSummary').textContent = `Total: $${_totalAmount.toFixed(2)}`;
    resetStep3Split();
    showCStep('cstep-3');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
}

// ── Step 2 — Manual ───────────────────────────────────────────

function cManualNext() {
  _totalAmount = parseFloat(document.getElementById('cTotalAmount').value) || 0;
  _prevStep3   = 'cstep-2-manual';
  document.getElementById('cCsvPreview').style.display = 'none';
  document.getElementById('cTotalSummary').textContent = `Total: $${_totalAmount.toFixed(2)}`;
  resetStep3Split();
  showCStep('cstep-3');
}

// ── Step 3 — Review + Split ───────────────────────────────────

function cStep3Back() { showCStep(_prevStep3); }

function resetStep3Split() {
  document.getElementById('csplit-zq1').checked  = true;
  document.getElementById('csplit-dar0').checked = true;
  document.querySelectorAll('#cstep-3 .room-sel-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  _splitMethod = 'even';
  document.getElementById('cCustomInputs').style.display = 'none';
  document.getElementById('cCustomInputs').innerHTML = '';
}

function selectSplitMethod(btn) {
  document.querySelectorAll('#cstep-3 .room-sel-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _splitMethod = btn.dataset.split;
  updateCustomSplitInputs();
}

function updateCustomSplitInputs() {
  const box    = document.getElementById('cCustomInputs');
  const people = ['zq1', 'dar0'].filter(u => document.getElementById(`csplit-${u}`)?.checked);
  if (_splitMethod !== 'custom' || !people.length) { box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = people.map(u => `
    <div class="form-group">
      <label>${u}'s share ($)</label>
      <input type="number" id="camt-${u}" placeholder="0.00" step="0.01" min="0" />
    </div>
  `).join('');
}

async function submitComplete() {
  const people = ['zq1', 'dar0'].filter(u => document.getElementById(`csplit-${u}`)?.checked);
  if (!people.length) { alert('Select at least one person to split with.'); return; }

  let splitAmounts = {};
  if (_splitMethod === 'even') {
    const share = Math.round((_totalAmount / people.length) * 100) / 100;
    people.forEach(u => splitAmounts[u] = share);
  } else {
    people.forEach(u => {
      splitAmounts[u] = parseFloat(document.getElementById(`camt-${u}`)?.value) || 0;
    });
  }

  const btn = document.getElementById('cConfirmBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';

  try {
    const res = await fetch(`/api/shopping-lists/${_completingListId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        mode:        _mode,
        pricedItems: _mode === 'bot' ? _pricedItems : null,
        totalAmount: _totalAmount,
        splitWith:   people,
        splitAmounts,
        receipt:     _receiptBase64 || null,
      }),
    });
    if (!res.ok) throw new Error('Failed');
    closeCompleteModal();
    loadLists();
  } catch {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Confirm &amp; send';
  }
}

// Close modals on backdrop click
document.addEventListener('click', e => {
  if (e.target === document.getElementById('lowStockModal')) closeLowStockModal();
  if (e.target === document.getElementById('completeModal')) closeCompleteModal();
});
