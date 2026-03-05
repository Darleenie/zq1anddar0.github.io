let _editingBillId = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!isLoggedIn()) { openLoginModal(); return; }
  loadBills();
});

function toggleReminderDays() {
  const rec = document.getElementById('billRecurrence').value;
  document.getElementById('reminderDaysGroup').style.display = rec !== 'none' ? '' : 'none';
}

async function loadBills() {
  const res = await fetch('/api/bills', { headers: { ...authHeaders() } });
  const bills = await res.json();
  renderBills(bills);
}

function renderBills(bills) {
  const container = document.getElementById('billsList');
  if (!bills.length) {
    container.innerHTML = '<p class="empty-state"><i class="fas fa-file-invoice"></i> No bills yet.</p>';
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  container.innerHTML = bills.map(bill => {
    const overdue    = !bill.paid && bill.dueDate < today;
    const recBadge   = bill.recurrence !== 'none'
      ? `<span class="recurrence-badge"><i class="fas fa-rotate"></i> ${bill.recurrence}</span>`
      : '';
    const remBadge   = (bill.recurrence !== 'none' && bill.reminderDays)
      ? `<span class="reminder-badge"><i class="fas fa-bell"></i> ${bill.reminderDays}d notice</span>`
      : '';
    const ownerLabel = bill.owner === 'shared'
      ? '<i class="fas fa-users"></i> Shared'
      : `<i class="fas fa-user"></i> ${bill.owner}`;
    const dueLabel   = new Date(bill.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Next-cycle notice for recurring unpaid bills
    const nextNotice = (!bill.paid && bill.recurrence !== 'none')
      ? `<span class="next-cycle-badge"><i class="fas fa-arrow-rotate-right"></i> Next cycle auto-schedules on pay</span>`
      : '';

    let cardClass = 'bill-card';
    if (overdue)   cardClass += ' bill-overdue';
    else if (bill.paid) cardClass += ' bill-paid';

    return `
      <div class="${cardClass}">
        <div class="bill-top">
          <span class="bill-name">${bill.name}</span>
          <span class="bill-amount">$${Number(bill.amount).toFixed(2)}</span>
        </div>
        <div class="bill-meta">
          <span><i class="fas fa-calendar-day"></i> Due ${dueLabel}${overdue ? ' <span class="overdue-label">OVERDUE</span>' : ''}</span>
          <span>${ownerLabel}</span>
          ${recBadge}
          ${remBadge}
          ${bill.paid ? `<span class="paid-label"><i class="fas fa-check-circle"></i> Paid</span>` : ''}
          ${nextNotice}
        </div>
        <div class="list-actions">
          <button class="btn-secondary btn-sm" onclick="togglePaid('${bill._id}', ${bill.paid})">
            <i class="fas fa-${bill.paid ? 'rotate-left' : 'check'}"></i>
            ${bill.paid ? 'Mark unpaid' : 'Mark paid'}
          </button>
          <button class="btn-secondary btn-sm" onclick="openEditBill(${JSON.stringify(bill).replace(/"/g, '&quot;')})">
            <i class="fas fa-edit"></i> Edit
          </button>
          <button class="btn-icon btn-del" onclick="deleteBill('${bill._id}')" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function submitBill(e) {
  e.preventDefault();
  const recurrence = document.getElementById('billRecurrence').value;
  const data = {
    name:         document.getElementById('billName').value.trim(),
    amount:       parseFloat(document.getElementById('billAmount').value),
    dueDate:      document.getElementById('billDueDate').value,
    recurrence,
    owner:        document.getElementById('billOwner').value,
    reminderDays: recurrence !== 'none'
      ? (parseInt(document.getElementById('billReminderDays').value) || 3)
      : null,
    paid:         false,
    paidAt:       null,
    reminderSent: false,
  };

  if (_editingBillId) {
    await fetch(`/api/bills/${_editingBillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data),
    });
    cancelEdit();
  } else {
    await fetch('/api/bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data),
    });
  }
  document.getElementById('billForm').reset();
  toggleReminderDays(); // re-hide reminder field after reset
  loadBills();
}

async function togglePaid(id, current) {
  await fetch(`/api/bills/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ paid: !current, paidAt: !current ? new Date().toISOString() : null }),
  });
  loadBills();
}

async function deleteBill(id) {
  if (!confirm('Delete this bill?')) return;
  await fetch(`/api/bills/${id}`, { method: 'DELETE', headers: { ...authHeaders() } });
  loadBills();
}

function openEditBill(bill) {
  _editingBillId = bill._id;
  document.getElementById('billFormTitle').innerHTML  = '<i class="fas fa-edit"></i> Edit Bill';
  document.getElementById('billSubmitBtn').innerHTML  = '<i class="fas fa-save"></i> Save changes';
  document.getElementById('cancelEditBtn').style.display = '';
  document.getElementById('billName').value           = bill.name;
  document.getElementById('billAmount').value         = bill.amount;
  document.getElementById('billDueDate').value        = bill.dueDate;
  document.getElementById('billRecurrence').value     = bill.recurrence;
  document.getElementById('billOwner').value          = bill.owner;
  document.getElementById('billReminderDays').value   = bill.reminderDays || 3;
  toggleReminderDays();
  document.getElementById('billFormSection').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  _editingBillId = null;
  document.getElementById('billFormTitle').innerHTML = '<i class="fas fa-plus"></i> Add Bill';
  document.getElementById('billSubmitBtn').innerHTML = '<i class="fas fa-plus"></i> Add Bill';
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('billForm').reset();
  toggleReminderDays();
}
