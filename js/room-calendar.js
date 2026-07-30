// ============================================================
// ROOM CALENDAR — native, fully-contained Google Calendar view
// ============================================================
// Replaces the fixed-width Google iframe (which overflows the page on a
// phone) with a month grid + agenda rendered from the calendar's ICS feed,
// proxied through /api/calendar because Google sends no CORS headers.
//
// Mount with:  <div data-room-calendar="dar0" data-title="My Schedule"></div>

const CAL_DEFAULT_SOURCES = {
  dar0:   'jiangdl0129@gmail.com',
  zq1:    '',
  living: '',
};

const CAL_STORAGE_PREFIX = 'roomCalendarSrc_';
const CAL_VIEW_PREFIX    = 'roomCalendarView_';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// A muted, warm accent set — reads as one palette against the cream surface
const EVENT_TONES = ['tone-gold', 'tone-sage', 'tone-clay', 'tone-plum', 'tone-slate'];

function calSource(room) {
  const stored = localStorage.getItem(CAL_STORAGE_PREFIX + room);
  if (stored !== null) return stored;
  return CAL_DEFAULT_SOURCES[room] ?? '';
}

function setCalSource(room, value) {
  localStorage.setItem(CAL_STORAGE_PREFIX + room, value.trim());
}

function calView(room) {
  return localStorage.getItem(CAL_VIEW_PREFIX + room) || 'month';
}

function setCalView(room, view) {
  localStorage.setItem(CAL_VIEW_PREFIX + room, view);
}

// ── Date helpers (all local-time) ───────────────────────────
const dayKey    = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay   = (a, b) => dayKey(a) === dayKey(b);

function timeLabel(iso, allDay) {
  if (allDay) return 'All day';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
}

function relativeDayLabel(date) {
  const today = startOfDay(new Date());
  const diff  = Math.round((startOfDay(date) - today) / 86400000);
  if (diff === 0)  return 'Today';
  if (diff === 1)  return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

// Stable tone per event title so the same meeting keeps its colour
function toneFor(title) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  return EVENT_TONES[hash % EVENT_TONES.length];
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// COMPONENT
// ============================================================
class RoomCalendar {
  constructor(el) {
    this.el       = el;
    this.room     = el.dataset.roomCalendar;
    this.title    = el.dataset.title || 'Schedule';
    this.view     = calView(this.room);
    this.cursor   = startOfDay(new Date()); // month being displayed
    this.selected = startOfDay(new Date());
    this.events   = [];
    this.state    = 'idle'; // idle | loading | ready | error | unconfigured
    this.error    = '';
    this.el.classList.add('room-cal');
    this.render();
    this.load();
  }

  // ── Data ──────────────────────────────────────────────────
  async load() {
    const src = calSource(this.room);
    if (!src) { this.state = 'unconfigured'; this.render(); return; }

    if (!isLoggedIn()) { this.state = 'locked'; this.render(); return; }

    this.state = 'loading';
    this.render();

    try {
      const res  = await fetch(`/api/calendar?src=${encodeURIComponent(src)}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Calendar ${res.status}`);
      this.events = data.events || [];
      this.state  = 'ready';
      this.error  = '';
    } catch (err) {
      this.state = 'error';
      this.error = err.message;
    }
    this.render();
  }

  eventsOn(date) {
    return this.events.filter(e => {
      const s = new Date(e.start);
      if (e.allDay) {
        // All-day events come back as UTC midnight — compare on the UTC date
        const utcDay = new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
        return sameDay(utcDay, date);
      }
      return sameDay(s, date);
    });
  }

  upcoming(limit = 40) {
    const from = startOfDay(new Date()).getTime();
    return this.events
      .filter(e => new Date(e.end).getTime() >= from)
      .slice(0, limit);
  }

  // ── Actions ───────────────────────────────────────────────
  shiftMonth(delta) {
    this.cursor = new Date(this.cursor.getFullYear(), this.cursor.getMonth() + delta, 1);
    this.render();
  }

  goToday() {
    this.cursor   = startOfDay(new Date());
    this.selected = startOfDay(new Date());
    this.render();
  }

  selectDay(key) {
    const [y, m, d] = key.split('-').map(Number);
    this.selected = new Date(y, m - 1, d);
    this.render();
  }

  switchView(view) {
    this.view = view;
    setCalView(this.room, view);
    this.render();
  }

  saveSource() {
    const input = this.el.querySelector('.room-cal-src-input');
    if (!input) return;
    setCalSource(this.room, input.value);
    this.load();
  }

  toggleSettings() {
    this.showSettings = !this.showSettings;
    this.render();
  }

  // ── Render ────────────────────────────────────────────────
  render() {
    this.el.innerHTML = `
      <div class="room-cal-card">
        ${this.renderHeader()}
        <div class="room-cal-body">${this.renderBody()}</div>
      </div>`;
    this.bind();
  }

  renderHeader() {
    const monthLabel   = `${MONTH_NAMES[this.cursor.getMonth()]} ${this.cursor.getFullYear()}`;
    const showControls = this.state === 'ready' && !this.showSettings;
    const showNav      = showControls && this.view === 'month';

    return `
      <div class="room-cal-head">
        <div class="room-cal-head-top">
          <div class="room-cal-titles">
            <span class="room-cal-eyebrow">Calendar</span>
            <h3 class="room-cal-title">${escapeHTML(this.title)}</h3>
          </div>
          <button class="room-cal-gear" data-act="settings" title="Calendar settings" aria-label="Calendar settings">
            <i class="fas fa-sliders-h"></i>
          </button>
        </div>

        ${showControls ? `
          <div class="room-cal-controls">
            <div class="room-cal-month">
              ${showNav ? `<button class="room-cal-arrow" data-act="prev" aria-label="Previous month"><i class="fas fa-chevron-left"></i></button>` : ''}
              <span class="room-cal-month-label">${showNav ? monthLabel : 'Upcoming'}</span>
              ${showNav ? `<button class="room-cal-arrow" data-act="next" aria-label="Next month"><i class="fas fa-chevron-right"></i></button>` : ''}
            </div>
            <div class="room-cal-view-toggle">
              <button class="room-cal-view-btn ${this.view === 'month'  ? 'active' : ''}" data-act="view-month">Month</button>
              <button class="room-cal-view-btn ${this.view === 'agenda' ? 'active' : ''}" data-act="view-agenda">Agenda</button>
            </div>
          </div>` : ''}
      </div>`;
  }

  renderBody() {
    if (this.showSettings)              return this.renderSettings();
    if (this.state === 'locked')        return this.renderNotice('fa-lock', 'Sign in to see this calendar', 'Your schedule stays private to the household.');
    if (this.state === 'unconfigured')  return this.renderSettings(true);
    if (this.state === 'loading')       return this.renderSkeleton();
    if (this.state === 'error')         return this.renderError();
    return this.view === 'month' ? this.renderMonth() : this.renderAgenda();
  }

  renderSkeleton() {
    return `
      <div class="room-cal-skeleton">
        ${Array.from({ length: 3 }, () => `<div class="room-cal-skel-row"></div>`).join('')}
      </div>`;
  }

  renderNotice(icon, title, sub) {
    return `
      <div class="room-cal-empty">
        <i class="fas ${icon}"></i>
        <p class="room-cal-empty-title">${title}</p>
        <p class="room-cal-empty-sub">${sub}</p>
      </div>`;
  }

  renderError() {
    const src = calSource(this.room);
    const embedUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(src)}`;
    return `
      <div class="room-cal-empty">
        <i class="fas fa-triangle-exclamation"></i>
        <p class="room-cal-empty-title">Couldn't load this calendar</p>
        <p class="room-cal-empty-sub">${escapeHTML(this.error)}</p>
        <div class="room-cal-empty-actions">
          <button class="btn-secondary btn-sm" data-act="retry"><i class="fas fa-rotate-right"></i> Retry</button>
          <button class="btn-secondary btn-sm" data-act="settings"><i class="fas fa-sliders-h"></i> Settings</button>
          <a class="btn-secondary btn-sm" href="${embedUrl}" target="_blank" rel="noopener">
            <i class="fas fa-arrow-up-right-from-square"></i> Open in Google
          </a>
        </div>
      </div>`;
  }

  renderSettings(firstRun = false) {
    const src = calSource(this.room);
    return `
      <div class="room-cal-settings">
        <p class="room-cal-settings-lead">
          ${firstRun
            ? 'Connect a Google Calendar to this room.'
            : 'Change which calendar this room shows.'}
        </p>
        <label class="room-cal-settings-label">Calendar ID or share link</label>
        <input type="text" class="room-cal-src-input" value="${escapeHTML(src)}"
               placeholder="you@gmail.com  ·  or a calendar.google.com link" />
        <p class="room-cal-settings-hint">
          <i class="fas fa-circle-info"></i>
          In Google Calendar open <strong>Settings → your calendar → Access permissions</strong>,
          tick <strong>Make available to public</strong>, then copy the <strong>Calendar ID</strong> from
          <strong>Integrate calendar</strong>.
        </p>
        <div class="room-cal-settings-actions">
          ${firstRun ? '' : `<button class="btn-secondary btn-sm" data-act="cancel-settings">Cancel</button>`}
          <button class="btn-primary btn-sm" data-act="save-src"><i class="fas fa-link"></i> Connect</button>
        </div>
      </div>`;
  }

  renderMonth() {
    const year  = this.cursor.getFullYear();
    const month = this.cursor.getMonth();
    const first = new Date(year, month, 1);
    const lead  = first.getDay();
    const days  = new Date(year, month + 1, 0).getDate();
    const today = startOfDay(new Date());

    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);

    const grid = cells.map(date => {
      if (!date) return `<div class="room-cal-cell room-cal-cell-blank"></div>`;
      const evs      = this.eventsOn(date);
      const isToday  = sameDay(date, today);
      const isActive = sameDay(date, this.selected);
      const dots = evs.slice(0, 3)
        .map(e => `<span class="room-cal-dot ${toneFor(e.title)}"></span>`).join('');
      const label = `${date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}, ${evs.length} event${evs.length === 1 ? '' : 's'}`;
      return `
        <button class="room-cal-cell ${isToday ? 'is-today' : ''} ${isActive ? 'is-selected' : ''} ${evs.length ? 'has-events' : ''}"
                data-act="day" data-day="${dayKey(date)}"
                aria-label="${label}" aria-pressed="${isActive}">
          <span class="room-cal-cell-num">${date.getDate()}</span>
          <span class="room-cal-dots">${dots}${evs.length > 3 ? `<span class="room-cal-more">+</span>` : ''}</span>
        </button>`;
    }).join('');

    return `
      <div class="room-cal-grid-wrap">
        <div class="room-cal-weekdays">
          ${DAY_INITIALS.map(d => `<span class="room-cal-weekday" aria-hidden="true">${d}</span>`).join('')}
        </div>
        <div class="room-cal-grid" role="grid">${grid}</div>
      </div>
      ${this.renderDayDetail()}`;
  }

  renderDayDetail() {
    const evs = this.eventsOn(this.selected);
    return `
      <div class="room-cal-daypanel">
        <div class="room-cal-daypanel-head">
          <span class="room-cal-daypanel-title">${relativeDayLabel(this.selected)}</span>
          <span class="room-cal-daypanel-count">${evs.length || 'No'} event${evs.length === 1 ? '' : 's'}</span>
        </div>
        ${evs.length
          ? `<ul class="room-cal-event-list">${evs.map(e => this.eventRow(e)).join('')}</ul>`
          : `<p class="room-cal-daypanel-empty">Nothing scheduled — enjoy the quiet.</p>`}
      </div>`;
  }

  renderAgenda() {
    const evs = this.upcoming();
    if (!evs.length) {
      return this.renderNotice('fa-mug-hot', 'Nothing coming up', 'The next few months are clear.');
    }

    // Group consecutive events by day
    const groups = [];
    for (const e of evs) {
      const s = new Date(e.start);
      const d = e.allDay ? new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) : s;
      const key = dayKey(d);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.events.push(e);
      else groups.push({ key, date: d, events: [e] });
    }

    return `
      <div class="room-cal-agenda">
        ${groups.map(g => `
          <div class="room-cal-agenda-group">
            <div class="room-cal-agenda-date">
              <span class="room-cal-agenda-dow">${g.date.toLocaleDateString([], { weekday: 'short' })}</span>
              <span class="room-cal-agenda-num">${g.date.getDate()}</span>
              <span class="room-cal-agenda-mon">${g.date.toLocaleDateString([], { month: 'short' })}</span>
            </div>
            <ul class="room-cal-event-list">${g.events.map(e => this.eventRow(e)).join('')}</ul>
          </div>`).join('')}
      </div>`;
  }

  eventRow(e) {
    return `
      <li class="room-cal-event ${toneFor(e.title)}">
        <span class="room-cal-event-time">${timeLabel(e.start, e.allDay)}</span>
        <span class="room-cal-event-body">
          <span class="room-cal-event-title">${escapeHTML(e.title)}</span>
          ${e.location ? `<span class="room-cal-event-loc"><i class="fas fa-location-dot"></i> ${escapeHTML(e.location)}</span>` : ''}
        </span>
        ${e.recurring ? `<i class="fas fa-repeat room-cal-event-repeat" title="Repeats"></i>` : ''}
      </li>`;
  }

  // ── Events ────────────────────────────────────────────────
  bind() {
    this.el.querySelectorAll('[data-act]').forEach(node => {
      node.addEventListener('click', (ev) => {
        const act = node.dataset.act;
        if (act === 'prev')            this.shiftMonth(-1);
        else if (act === 'next')       this.shiftMonth(1);
        else if (act === 'day')        this.selectDay(node.dataset.day);
        else if (act === 'view-month') this.switchView('month');
        else if (act === 'view-agenda')this.switchView('agenda');
        else if (act === 'settings')   this.toggleSettings();
        else if (act === 'cancel-settings') { this.showSettings = false; this.render(); }
        else if (act === 'save-src')   { this.showSettings = false; this.saveSource(); }
        else if (act === 'retry')      this.load();
      });
    });

    const input = this.el.querySelector('.room-cal-src-input');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { this.showSettings = false; this.saveSource(); }
      });
    }
  }
}

// ============================================================
// AUTO-MOUNT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-room-calendar]').forEach(el => new RoomCalendar(el));
});
