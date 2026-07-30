// ============================================================
// ROOM PAGE — "at a glance" stats strip
// ============================================================
// Renders into <section class="room-stats" data-room-stats="dar0"></section>

const ROOM_CONSUMABLES = ['food', 'medicine', 'cleaning'];

function roomStatTile(icon, value, label, tone = '') {
  return `
    <div class="room-stat ${tone}">
      <i class="fas ${icon}"></i>
      <span class="room-stat-value">${value}</span>
      <span class="room-stat-label">${label}</span>
    </div>`;
}

async function loadRoomStats(el) {
  const room = el.dataset.roomStats;

  el.innerHTML = `<div class="room-stats-grid">${
    Array.from({ length: 4 }, () => `<div class="room-stat room-stat-skel"></div>`).join('')
  }</div>`;

  let items = [];
  try {
    const res = await fetch(`/api/items?room=${encodeURIComponent(room)}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Could not load inventory');
    items = await res.json();
  } catch {
    el.innerHTML = '';
    return;
  }

  const now = Date.now();
  let lowStock = 0, expiring = 0, missing = 0;

  for (const item of items) {
    const qty = Number(item.qty);
    if (qty === 0 || (qty <= 2 && ROOM_CONSUMABLES.includes(item.classification))) lowStock++;
    if (item.missing) missing++;
    if (item.expirationDate) {
      const days = Math.ceil((new Date(item.expirationDate) - now) / 86400000);
      if (days <= 14) expiring++;
    }
  }

  el.innerHTML = `
    <div class="room-stats-grid">
      ${roomStatTile('fa-box-open',        items.length, 'Items')}
      ${roomStatTile('fa-battery-quarter', lowStock,     'Low stock', lowStock ? 'stat-warn'   : '')}
      ${roomStatTile('fa-hourglass-half',  expiring,     'Expiring',  expiring ? 'stat-warn'   : '')}
      ${roomStatTile('fa-circle-question', missing,      'Missing',   missing  ? 'stat-danger' : '')}
    </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-room-stats]').forEach(loadRoomStats);
});
