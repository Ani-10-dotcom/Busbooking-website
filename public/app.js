// ===== Sample data (made up for demonstration, not real schedules) =====
const CITIES = ['Chennai', 'Coimbatore', 'Erode', 'Tirupur'];
const CODES = { Chennai: 'CHE', Coimbatore: 'CBE', Erode: 'ERD', Tirupur: 'TUP' };
const ROUTES = {
  'Chennai|Coimbatore': { km: 505, mins: 540 },
  'Chennai|Erode': { km: 400, mins: 450 },
  'Chennai|Tirupur': { km: 455, mins: 500 },
  'Coimbatore|Erode': { km: 100, mins: 120 },
  'Coimbatore|Tirupur': { km: 50, mins: 75 },
  'Erode|Tirupur': { km: 55, mins: 80 },
};
const OPERATORS = ['Kurinji Travels', 'Mullai Express', 'Marutham Roadways', 'Neithal Coaches', 'Palai Lines', 'Thendral Travels'];
const BUS_TYPES = {
  'AC Sleeper': { perKm: 2.4, layout: 'sleeper' },
  'Non-AC Sleeper': { perKm: 1.8, layout: 'sleeper' },
  'AC Seater (2+2)': { perKm: 1.7, layout: 'seater' },
  'Non-AC Seater (2+2)': { perKm: 1.3, layout: 'seater' },
};
const LONG_SCHEDULE = [['20:30', 'AC Sleeper'], ['21:15', 'Non-AC Sleeper'], ['21:45', 'AC Sleeper'], ['22:30', 'AC Seater (2+2)'], ['23:00', 'Non-AC Seater (2+2)'], ['07:00', 'AC Seater (2+2)']];
const SHORT_SCHEDULE = [['06:00', 'Non-AC Seater (2+2)'], ['08:30', 'AC Seater (2+2)'], ['11:00', 'Non-AC Seater (2+2)'], ['14:00', 'AC Seater (2+2)'], ['17:30', 'Non-AC Seater (2+2)'], ['20:00', 'AC Seater (2+2)']];
const MAX_SEATS = 6;

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (x) => { const t = ((x % 1440) + 1440) % 1440; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

const BUSES = (() => {
  const out = []; let op = 0;
  for (const from of CITIES) for (const to of CITIES) {
    if (from === to) continue;
    const info = ROUTES[`${from}|${to}`] || ROUTES[`${to}|${from}`];
    (info.km > 300 ? LONG_SCHEDULE : SHORT_SCHEDULE).forEach(([depart, type], i) => {
      const t = BUS_TYPES[type]; const arr = toMin(depart) + info.mins;
      out.push({
        id: `${CODES[from]}-${CODES[to]}-${String(i + 1).padStart(2, '0')}`, operator: OPERATORS[op++ % OPERATORS.length],
        type, layout: t.layout, from, to, depart, arrive: fromMin(arr), nextDay: arr >= 1440,
        durationMins: info.mins, distanceKm: info.km, fare: Math.max(60, Math.round(info.km * t.perKm / 10) * 10),
      });
    });
  }
  return out;
})();
const BUS_BY_ID = new Map(BUSES.map((b) => [b.id, b]));

function seatLayout(layout) {
  const seats = [];
  if (layout === 'seater') {
    for (let row = 1; row <= 10; row++) [0, 1, 3, 4].forEach((col, i) => seats.push({ id: `${row}${'ABCD'[i]}`, deck: 'main', row, col }));
  } else {
    for (const deck of ['lower', 'upper']) {
      let n = 1;
      for (let row = 1; row <= 5; row++) for (const col of [0, 2, 3]) seats.push({ id: `${deck === 'lower' ? 'L' : 'U'}${n++}`, deck, row, col });
    }
  }
  return seats;
}

// ===== Dates in Indian Standard Time =====
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
function nowMinIST() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value);
}
function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function dateError(d) {
  if (!validDate(d)) return 'Please choose a valid travel date.';
  if (d < todayIST()) return 'Tickets cannot be booked for a past date. Please choose today or a future date.';
  return null;
}
const departed = (bus, d) => d === todayIST() && toMin(bus.depart) <= nowMinIST();

// ===== Storage =====
// "shared": the Vercel API stores seats in Upstash Redis, so every visitor sees the same seats.
// "browser": no database configured (or opened without a server) - bookings stay in this browser.
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const store = {
  remote: false, canWrite: true,
  trips: {}, tickets: [],
  async init() {
    try {
      const r = await fetch('/api/meta', { cache: 'no-store' });
      if (r.ok) { const m = await r.json(); this.remote = m.storage === 'shared'; }
    } catch { /* no server: browser-only mode */ }
    this.trips = LS.get('payanam:trips', {});
    this.tickets = LS.get('payanam:tickets', []);
  },
  async booked(busId, date) { return Object.keys(this.trips[`${busId}_${date}`] || {}); },
  watch(busId, date, cb) {
    if (!this.remote) return () => {};
    // Refresh the open seat map every 15 seconds so seats booked by others turn grey.
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/buses/${encodeURIComponent(busId)}/seats?date=${date}`, { cache: 'no-store' });
        if (r.ok) cb((await r.json()).booked);
      } catch { /* try again next tick */ }
    }, 15000);
    return () => clearInterval(timer);
  },
  async claim(busId, date, seats, bookingId) {
    const key = `${busId}_${date}`; const map = { ...(this.trips[key] || {}) };
    const taken = seats.filter((s) => map[s]); if (taken.length) return { taken };
    seats.forEach((s) => (map[s] = bookingId)); this.trips[key] = map; LS.set('payanam:trips', this.trips);
    return { ok: true };
  },
  async saveTicket(b) { this.tickets.push(b); LS.set('payanam:tickets', this.tickets); },
  async myTickets() { return [...this.tickets].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); },
};

async function remoteApi(url, options = {}) {
  let res;
  try { res = await fetch(url, { cache: 'no-store', ...options }); }
  catch { throw new ApiError(503, 'Could not reach the booking service. Please check your connection and try again.'); }
  let body = {};
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, body.error || 'Something went wrong. Please try again.', body);
  return body;
}

// ===== Same API the Node version serves, answered in the page =====
class ApiError extends Error { constructor(status, message, body) { super(message); this.status = status; this.body = body || {}; } }

async function api(url, options = {}) {
  if (store.remote) {
    const out = await remoteApi(url, options);
    if (out.booking && options.method === 'POST') await store.saveTicket(out.booking);
    return out;
  }
  const u = new URL(url, 'https://local.invalid');
  const q = Object.fromEntries(u.searchParams);
  const path = u.pathname;
  if (path === '/api/meta') return { cities: CITIES, today: todayIST(), maxSeats: MAX_SEATS };

  if (path === '/api/buses') {
    if (!CITIES.includes(q.from) || !CITIES.includes(q.to)) throw new ApiError(400, 'Please choose valid From and To cities.');
    if (q.from === q.to) throw new ApiError(400, 'From and To cities must be different.');
    const e = dateError(q.date); if (e) throw new ApiError(400, e);
    const list = BUSES.filter((b) => b.from === q.from && b.to === q.to);
    const counts = await Promise.all(list.map((b) => store.booked(b.id, q.date).catch(() => [])));
    return {
      date: q.date,
      buses: list.map((b, i) => {
        const total = seatLayout(b.layout).length;
        return { ...b, totalSeats: total, seatsAvailable: total - counts[i].length, departed: departed(b, q.date) };
      }).sort((a, b) => a.depart.localeCompare(b.depart)),
    };
  }

  const m = path.match(/^\/api\/buses\/([A-Z0-9-]+)\/seats$/);
  if (m) {
    const bus = BUS_BY_ID.get(m[1]); if (!bus) throw new ApiError(404, 'Bus not found.');
    const e = dateError(q.date); if (e) throw new ApiError(400, e);
    return { bus, seats: seatLayout(bus.layout), booked: await store.booked(bus.id, q.date), departed: departed(bus, q.date) };
  }

  if (path === '/api/bookings' && options.method === 'POST') {
    const { busId, date, passengers, contact, paymentMethod } = JSON.parse(options.body || '{}');
    const bus = BUS_BY_ID.get(busId); if (!bus) throw new ApiError(404, 'Bus not found.');
    const e = dateError(date); if (e) throw new ApiError(400, e);
    if (departed(bus, date)) throw new ApiError(400, 'This bus has already departed today. Please choose another bus or date.');
    if (!store.canWrite) throw new ApiError(403, 'You have view-only access to this page, so you can browse buses but not book seats.');
    if (!Array.isArray(passengers) || !passengers.length) throw new ApiError(400, 'Please select at least one seat.');
    if (passengers.length > MAX_SEATS) throw new ApiError(400, `You can book up to ${MAX_SEATS} seats at a time.`);
    const valid = new Set(seatLayout(bus.layout).map((s) => s.id));
    const seats = [];
    for (const p of passengers) {
      if (!valid.has(p.seat) || seats.includes(p.seat)) throw new ApiError(400, `Seat ${p.seat} is not valid.`);
      if (!p.name || p.name.trim().length < 2) throw new ApiError(400, 'Each passenger needs a name.');
      if (!Number.isInteger(p.age) || p.age < 1 || p.age > 120) throw new ApiError(400, `Please enter a valid age for ${p.name}.`);
      seats.push(p.seat);
    }
    if (!/^[6-9]\d{9}$/.test(contact?.phone || '')) throw new ApiError(400, 'Please enter a valid 10-digit mobile number.');
    const id = 'PYN' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    let result;
    try { result = await store.claim(bus.id, date, seats, id); }
    catch { throw new ApiError(503, 'Could not reach the booking service. Please try again.'); }
    if (result.busy) throw new ApiError(503, 'Someone else is booking on this bus right now. Please try again in a moment.');
    if (result.taken) {
      const t = result.taken;
      throw new ApiError(409, `Sorry, seat${t.length > 1 ? 's' : ''} ${t.join(', ')} ${t.length > 1 ? 'were' : 'was'} just booked by someone else. Please pick again.`, { taken: t });
    }
    const booking = {
      id, status: 'CONFIRMED', busId: bus.id, operator: bus.operator, busType: bus.type, from: bus.from, to: bus.to,
      date, depart: bus.depart, arrive: bus.arrive, nextDay: bus.nextDay, seats,
      passengers: passengers.map((p) => ({ seat: p.seat, name: p.name.trim(), age: p.age, gender: p.gender })),
      contact: { phone: contact.phone, email: contact.email || '' }, farePerSeat: bus.fare, totalFare: bus.fare * seats.length,
      payment: { method: paymentMethod, demo: true }, createdAt: new Date().toISOString(),
    };
    await store.saveTicket(booking);
    return { booking };
  }
  throw new ApiError(404, 'Not found');
}

(() => {
  'use strict';

  // ---------- State ----------
  const state = {
    cities: [],
    today: null,        // YYYY-MM-DD in Indian Standard Time (from server)
    maxSeats: 6,
    date: null,         // selected travel date
    calMonth: null,     // { y, m } month shown in calendar (m = 0..11)
    search: null,       // { from, to, date }
    buses: [],
    openBusId: null,
    seatData: null,     // { bus, seats, booked }
    selected: [],       // selected seat ids
    passengers: null,   // passengers entered in checkout
    contact: null,
  };

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN');

  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function toDateString(dt) {
    return dt.toISOString().slice(0, 10);
  }
  function addDays(s, n) {
    const dt = parseDate(s);
    dt.setUTCDate(dt.getUTCDate() + n);
    return toDateString(dt);
  }
  function prettyDate(s) {
    return parseDate(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function prettyTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
  }
  function duration(mins) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  // Original bus illustration (inline SVG). AC buses are teal, Non-AC marigold; sleepers show two rows of windows.
  function busArt(type, size) {
    const ac = !/^Non-AC/.test(type);
    const sleeper = /Sleeper/.test(type);
    const win = [];
    for (let x = 72; x <= 192; x += 30) {
      if (sleeper) {
        win.push(`<rect x="${x}" y="22" width="24" height="15" rx="3" class="bus-glass"/>`);
        win.push(`<rect x="${x}" y="42" width="24" height="11" rx="3" class="bus-glass"/>`);
      } else {
        win.push(`<rect x="${x}" y="22" width="24" height="28" rx="3" class="bus-glass"/>`);
      }
    }
    const wheel = (cx) => `<circle cx="${cx}" cy="86" r="14" class="bus-tyre"/><circle cx="${cx}" cy="86" r="6" class="bus-hub"/>`;
    return `<svg class="bus-art bus-art-${size}" viewBox="0 0 240 104" role="img" aria-label="${esc(type)} bus">
      <rect x="6" y="10" width="228" height="74" rx="14" class="${ac ? 'bus-ac' : 'bus-nonac'}"/>
      <rect x="6" y="62" width="228" height="6" class="bus-stripe"/>
      <rect x="14" y="20" width="30" height="36" rx="6" class="bus-glass"/>
      <rect x="50" y="22" width="16" height="54" rx="3" class="bus-door"/>
      ${win.join('')}
      <rect x="10" y="72" width="10" height="6" rx="2" class="bus-light"/>
      ${ac ? '<rect x="150" y="4" width="54" height="8" rx="3" class="bus-roof"/>' : ''}
      ${wheel(60)}${wheel(186)}
    </svg>`;
  }

  function show(sectionId) {
    for (const id of ['resultsSection', 'checkoutSection', 'ticketSection', 'lookupSection']) {
      $(id).hidden = id !== sectionId;
    }
    $('homeSection').hidden = !!sectionId;
  }

  // ---------- Search form ----------
  function fillCities() {
    const opts = state.cities.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('fromCity').innerHTML = opts;
    $('toCity').innerHTML = opts;
    $('fromCity').value = state.cities[0];
    $('toCity').value = state.cities[1];
  }

  function setDate(s) {
    if (s < state.today) return; // never allow a past date
    state.date = s;
    $('dateLabel').textContent = prettyDate(s);
    $('searchError').textContent = '';
  }

  $('swapBtn').addEventListener('click', () => {
    const a = $('fromCity').value;
    $('fromCity').value = $('toCity').value;
    $('toCity').value = a;
  });

  document.querySelectorAll('[data-quick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setDate(addDays(state.today, Number(btn.dataset.quick)));
      closeCalendar();
    });
  });

  $('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const from = $('fromCity').value;
    const to = $('toCity').value;
    const err = $('searchError');
    if (from === to) { err.textContent = 'From and To cities must be different.'; return; }
    if (!state.date) { err.textContent = 'Please select your date of journey.'; return; }
    if (state.date < state.today) { err.textContent = 'You can only book for today or a future date.'; return; }
    err.textContent = '';
    searchBuses({ from, to, date: state.date });
  });

  // ---------- Calendar (past dates disabled) ----------
  const calendar = $('calendar');

  function openCalendar() {
    const base = parseDate(state.date || state.today);
    state.calMonth = { y: base.getUTCFullYear(), m: base.getUTCMonth() };
    renderCalendar();
    calendar.hidden = false;
    $('dateBtn').setAttribute('aria-expanded', 'true');
  }
  function closeCalendar() {
    calendar.hidden = true;
    $('dateBtn').setAttribute('aria-expanded', 'false');
  }

  function renderCalendar() {
    const { y, m } = state.calMonth;
    const todayDt = parseDate(state.today);
    const isCurrentMonth = y === todayDt.getUTCFullYear() && m === todayDt.getUTCMonth();
    const monthName = new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay(); // 0 = Sunday
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

    let cells = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
    for (let i = 0; i < firstDow; i++) cells += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const s = toDateString(new Date(Date.UTC(y, m, d)));
      const past = s < state.today;
      const cls = ['cal-day', s === state.today ? 'today' : '', s === state.date ? 'selected' : ''].join(' ');
      cells += `<button type="button" class="${cls}" data-date="${s}" ${past ? 'disabled aria-disabled="true"' : ''} aria-label="${prettyDate(s)}${past ? ' (past date, not available)' : ''}">${d}</button>`;
    }

    calendar.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1" ${isCurrentMonth ? 'disabled' : ''} aria-label="Previous month">‹</button>
        <span>${monthName}</span>
        <button type="button" class="cal-nav" data-nav="1" aria-label="Next month">›</button>
      </div>
      <div class="cal-grid">${cells}</div>
      <p class="cal-note">Past dates can't be booked.</p>`;
  }

  calendar.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav && !nav.disabled) {
      let { y, m } = state.calMonth;
      m += Number(nav.dataset.nav);
      if (m < 0) { m = 11; y--; }
      if (m > 11) { m = 0; y++; }
      state.calMonth = { y, m };
      renderCalendar();
      return;
    }
    const day = e.target.closest('[data-date]');
    if (day && !day.disabled) {
      setDate(day.dataset.date);
      closeCalendar();
    }
  });

  $('dateBtn').addEventListener('click', () => (calendar.hidden ? openCalendar() : closeCalendar()));
  document.addEventListener('click', (e) => {
    if (!calendar.hidden && !e.target.closest('.date-field')) closeCalendar();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCalendar(); });

  // ---------- Results ----------
  async function searchBuses(search) {
    state.search = search;
    state.openBusId = null;
    show('resultsSection');
    $('resultsTitle').textContent = `${search.from} → ${search.to}`;
    $('resultsSub').textContent = prettyDate(search.date);
    $('busList').innerHTML = '<div class="empty">Loading buses…</div>';
    try {
      const data = await api(`/api/buses?from=${encodeURIComponent(search.from)}&to=${encodeURIComponent(search.to)}&date=${search.date}`);
      state.buses = data.buses;
      renderBuses();
      $('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      $('busList').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function visibleBuses() {
    const f = $('typeFilter').value;
    let list = state.buses.filter((b) => {
      if (!f) return true;
      if (f === 'AC') return b.type.startsWith('AC');
      if (f === 'Non-AC') return b.type.startsWith('Non-AC');
      if (f === 'Sleeper') return b.layout === 'sleeper';
      if (f === 'Seater') return b.layout === 'seater';
      return true;
    });
    const sort = $('sortBy').value;
    list = [...list].sort((a, b) => {
      if (sort === 'fare') return a.fare - b.fare;
      if (sort === 'seats') return b.seatsAvailable - a.seatsAvailable;
      return a.depart.localeCompare(b.depart);
    });
    return list;
  }

  function renderBuses() {
    const list = visibleBuses();
    $('resultsSub').textContent = `${prettyDate(state.search.date)} · ${list.length} bus${list.length === 1 ? '' : 'es'}`;
    if (!list.length) {
      $('busList').innerHTML = '<div class="empty">No buses match this filter.</div>';
      return;
    }
    $('busList').innerHTML = list.map((b) => {
      const soldOut = b.seatsAvailable === 0;
      let action;
      if (b.departed) action = '<span class="tag">Departed</span>';
      else if (soldOut) action = '<span class="tag">Sold out</span>';
      else action = `<button type="button" class="btn btn-primary" data-open="${b.id}">${state.openBusId === b.id ? 'Hide seats' : 'View seats'}</button>`;
      return `
        <article class="bus-card ${b.departed ? 'departed' : ''}" id="bus-${b.id}">
          <div class="bus-main">
            <div class="op-cell">
              ${busArt(b.type, 'card')}
              <div>
                <div class="op-name">${esc(b.operator)}</div>
                <div class="bus-type">${esc(b.type)}</div>
              </div>
            </div>
            <div class="times">
              <div><div class="time">${prettyTime(b.depart)}</div><div class="city">${esc(b.from)}</div></div>
              <div class="duration">${duration(b.durationMins)}</div>
              <div><div class="time">${prettyTime(b.arrive)}${b.nextDay ? '<span class="plus1">+1</span>' : ''}</div><div class="city">${esc(b.to)}</div></div>
            </div>
            <div>
              <div class="fare">${rupees(b.fare)}</div>
              <div class="seats-left ${b.seatsAvailable <= 5 ? 'low' : ''}">${b.seatsAvailable} of ${b.totalSeats} seats left</div>
            </div>
            <div>${action}</div>
          </div>
          <div class="seat-slot"></div>
        </article>`;
    }).join('');

    if (state.openBusId) {
      const card = $(`bus-${state.openBusId}`);
      if (card && state.seatData) renderSeatPanel(card.querySelector('.seat-slot'));
    }
  }

  $('typeFilter').addEventListener('change', renderBuses);
  $('sortBy').addEventListener('change', renderBuses);

  $('busList').addEventListener('click', async (e) => {
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) {
      const id = openBtn.dataset.open;
      if (state.openBusId === id) {
        state.openBusId = null;
        state.seatData = null;
        unwatch();
        renderBuses();
        return;
      }
      await loadSeats(id);
      return;
    }
    const seatBtn = e.target.closest('[data-seat]');
    if (seatBtn && !seatBtn.disabled) toggleSeat(seatBtn.dataset.seat);
    if (e.target.closest('[data-continue]')) goToCheckout();
  });

  async function loadSeats(busId, keepSelection) {
    try {
      const data = await api(`/api/buses/${busId}/seats?date=${state.search.date}`);
      state.openBusId = busId;
      state.seatData = data;
      state.selected = keepSelection ? state.selected.filter((s) => !data.booked.includes(s)) : [];
      // keep the list's seat counts in sync
      const listed = state.buses.find((b) => b.id === busId);
      if (listed) listed.seatsAvailable = data.seats.length - data.booked.length;
      renderBuses();
      watchOpenTrip();
    } catch (err) {
      const card = $(`bus-${busId}`);
      if (card) card.querySelector('.seat-slot').innerHTML = `<div class="seat-panel"><p class="form-error">${esc(err.message)}</p></div>`;
    }
  }

  // Live seat updates: when someone else books on the open bus, mark those seats taken.
  let unwatch = () => {};
  function watchOpenTrip() {
    unwatch();
    if (!state.openBusId || !state.search) return;
    const busId = state.openBusId, date = state.search.date;
    unwatch = store.watch(busId, date, (booked) => {
      if (!state.seatData || state.openBusId !== busId || state.search.date !== date) return;
      const prev = state.seatData.booked;
      if (prev.length === booked.length && booked.every((s) => prev.includes(s))) return;
      state.seatData = { ...state.seatData, booked };
      const lost = state.selected.filter((s) => booked.includes(s));
      state.selected = state.selected.filter((s) => !booked.includes(s));
      const listed = state.buses.find((b) => b.id === busId);
      if (listed) listed.seatsAvailable = state.seatData.seats.length - booked.length;
      const card = $(`bus-${busId}`);
      if (card && !$('resultsSection').hidden) {
        card.querySelector('.seats-left').textContent = `${listed.seatsAvailable} of ${listed.totalSeats} seats left`;
        renderSeatPanel(card.querySelector('.seat-slot'), lost.length ? `Seat ${lost.join(', ')} was just booked by someone else.` : '');
      }
    });
  }

  // ---------- Seat picker ----------
  function renderSeatPanel(slot, message) {
    const { bus, seats, booked } = state.seatData;
    const bookedSet = new Set(booked);
    const decks = bus.layout === 'sleeper' ? ['lower', 'upper'] : ['main'];
    const deckHtml = decks.map((deck) => {
      const cells = seats.filter((s) => s.deck === deck).map((s) => {
        const taken = bookedSet.has(s.id);
        const sel = state.selected.includes(s.id);
        return `<button type="button" class="seat ${sel ? 'selected' : ''}" data-seat="${s.id}"
          style="grid-row:${s.row};grid-column:${s.col + 1}" ${taken ? 'disabled' : ''}
          aria-pressed="${sel}" aria-label="Seat ${s.id}${taken ? ' booked' : sel ? ' selected' : ' available'}">${s.id}</button>`;
      }).join('');
      const title = deck === 'main' ? 'Seats' : deck === 'lower' ? 'Lower deck' : 'Upper deck';
      return `<div class="deck ${bus.layout}">
        <div class="deck-title">${title}${deck !== 'upper' ? '<span class="steering" title="Driver"></span>' : ''}</div>
        <div class="seat-grid">${cells}</div>
      </div>`;
    }).join('');

    const total = state.selected.length * bus.fare;
    slot.innerHTML = `
      <div class="seat-panel">
        <div>
          <div class="legend">
            <span><i></i> Available</span>
            <span><i class="sel"></i> Selected</span>
            <span><i class="tkn"></i> Booked</span>
          </div>
          <div class="decks">${deckHtml}</div>
        </div>
        <div class="seat-summary">
          ${message ? `<p class="form-error">${esc(message)}</p>` : ''}
          <div class="muted small">Up to ${state.maxSeats} seats per booking · ${rupees(bus.fare)} per seat</div>
          <div>Selected: <span class="sel-seats">${state.selected.length ? state.selected.join(', ') : 'none'}</span></div>
          <div class="total">${rupees(total)}</div>
          <button type="button" class="btn btn-primary" data-continue ${state.selected.length ? '' : 'disabled'}>Continue</button>
        </div>
      </div>`;
  }

  function toggleSeat(id) {
    const i = state.selected.indexOf(id);
    let message;
    if (i >= 0) state.selected.splice(i, 1);
    else if (state.selected.length >= state.maxSeats) message = `You can select up to ${state.maxSeats} seats.`;
    else state.selected.push(id);
    const card = $(`bus-${state.openBusId}`);
    renderSeatPanel(card.querySelector('.seat-slot'), message);
  }

  // ---------- Checkout ----------
  function goToCheckout() {
    if (!state.selected.length) return;
    const prev = state.passengers || [];
    $('passengerFields').innerHTML = state.selected.map((seat, i) => {
      const p = prev.find((x) => x.seat === seat) || {};
      return `
        <div class="pax">
          <div class="pax-title">Passenger ${i + 1} · Seat ${esc(seat)}</div>
          <div class="pax-row">
            <div class="field"><label for="name-${i}">Full name</label><input id="name-${i}" data-name="${esc(seat)}" maxlength="60" value="${esc(p.name || '')}" required></div>
            <div class="field"><label for="age-${i}">Age</label><input id="age-${i}" data-age="${esc(seat)}" inputmode="numeric" maxlength="3" value="${esc(p.age || '')}" required></div>
            <div class="field"><label for="gender-${i}">Gender</label>
              <select id="gender-${i}" data-gender="${esc(seat)}" required>
                <option value="">Select</option>
                ${['Male', 'Female', 'Other'].map((g) => `<option ${p.gender === g ? 'selected' : ''}>${g}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>`;
    }).join('');
    $('passengerError').textContent = '';
    $('paymentError').textContent = '';
    $('passengerForm').hidden = false;
    $('paymentPanel').hidden = true;
    renderSummary();
    show('checkoutSection');
    window.scrollTo({ top: $('checkoutSection').offsetTop - 10, behavior: 'smooth' });
  }

  function renderSummary() {
    const bus = state.seatData.bus;
    const total = bus.fare * state.selected.length;
    $('tripSummary').innerHTML = `
      <h3>Trip summary</h3>
      ${busArt(bus.type, 'summary')}
      <div class="sum-line"><span>${esc(bus.from)} → ${esc(bus.to)}</span></div>
      <div class="sum-line"><span class="muted">Date</span><span>${prettyDate(state.search.date)}</span></div>
      <div class="sum-line"><span class="muted">Departure</span><span>${prettyTime(bus.depart)}</span></div>
      <div class="sum-line"><span class="muted">Arrival</span><span>${prettyTime(bus.arrive)}${bus.nextDay ? ' (next day)' : ''}</span></div>
      <div class="sum-line"><span class="muted">Bus</span><span>${esc(bus.operator)}</span></div>
      <div class="sum-line"><span class="muted">Type</span><span>${esc(bus.type)}</span></div>
      <div class="sum-line"><span class="muted">Seats</span><span>${state.selected.join(', ')}</span></div>
      <div class="sum-line"><span class="muted">Fare</span><span>${rupees(bus.fare)} × ${state.selected.length}</span></div>
      <div class="sum-line sum-total"><span>Total</span><span>${rupees(total)}</span></div>`;
    $('payBtn').textContent = `Pay ${rupees(total)} (demo)`;
  }

  $('passengerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('passengerError');
    const passengers = [];
    for (const seat of state.selected) {
      const name = document.querySelector(`[data-name="${CSS.escape(seat)}"]`).value.trim();
      const ageRaw = document.querySelector(`[data-age="${CSS.escape(seat)}"]`).value.trim();
      const gender = document.querySelector(`[data-gender="${CSS.escape(seat)}"]`).value;
      const age = Number(ageRaw);
      if (name.length < 2) { err.textContent = `Please enter the passenger name for seat ${seat}.`; return; }
      if (!/^\d{1,3}$/.test(ageRaw) || age < 1 || age > 120) { err.textContent = `Please enter a valid age for seat ${seat}.`; return; }
      if (!gender) { err.textContent = `Please choose a gender for seat ${seat}.`; return; }
      passengers.push({ seat, name, age, gender });
    }
    const phone = $('phone').value.trim();
    const email = $('email').value.trim();
    if (!/^[6-9]\d{9}$/.test(phone)) { err.textContent = 'Please enter a valid 10-digit mobile number.'; return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Please enter a valid email or leave it blank.'; return; }
    err.textContent = '';
    state.passengers = passengers;
    state.contact = { phone, email };
    $('passengerForm').hidden = true;
    $('paymentPanel').hidden = false;
  });

  $('editPassengers').addEventListener('click', () => {
    $('paymentPanel').hidden = true;
    $('passengerForm').hidden = false;
  });

  $('backToSeats').addEventListener('click', () => {
    show('resultsSection');
    renderBuses();
    const card = $(`bus-${state.openBusId}`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('payBtn').addEventListener('click', async () => {
    const btn = $('payBtn');
    const err = $('paymentError');
    const method = document.querySelector('input[name="pay"]:checked').value;
    btn.disabled = true;
    btn.textContent = 'Processing…';
    err.textContent = '';
    try {
      const { booking } = await api('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          busId: state.seatData.bus.id,
          date: state.search.date,
          passengers: state.passengers,
          contact: state.contact,
          paymentMethod: method,
        }),
      });
      renderTicket(booking);
      state.selected = [];
      state.passengers = null;
      state.seatData = null;
      state.openBusId = null;
      unwatch();
    } catch (e2) {
      if (e2.status === 409) {
        // Someone else got the seat first — send the user back to pick again.
        const taken = e2.body.taken || [];
        state.selected = state.selected.filter((s) => !taken.includes(s));
        const busId = state.seatData.bus.id;
        show('resultsSection');
        await loadSeats(busId, true);
        const card = $(`bus-${busId}`);
        if (card) {
          renderSeatPanel(card.querySelector('.seat-slot'), e2.message);
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } else {
        err.textContent = e2.message;
      }
    } finally {
      btn.disabled = false;
      if (state.seatData) renderSummary();
    }
  });

  // ---------- Ticket ----------
  function renderTicket(b) {
    $('ticket').innerHTML = `
      <div class="ticket">
        <div class="ticket-top">
          <div>
            <div class="small" style="opacity:.8">Booking ID</div>
            <div style="font-size:1.3rem;font-weight:800;letter-spacing:.04em">${esc(b.id)}</div>
          </div>
          <span class="ticket-status">${esc(b.status)}</span>
        </div>
        <div class="ticket-body">
          <div class="ticket-route">
            <div><div class="time">${prettyTime(b.depart)}</div><div class="city">${esc(b.from)}</div></div>
            <div class="ticket-mid">${busArt(b.busType, 'ticket')}<div class="duration">${prettyDate(b.date)}</div></div>
            <div style="text-align:right"><div class="time">${prettyTime(b.arrive)}${b.nextDay ? '<span class="plus1">+1</span>' : ''}</div><div class="city">${esc(b.to)}</div></div>
          </div>
          <div class="ticket-grid">
            <div><span>Operator</span><strong>${esc(b.operator)}</strong></div>
            <div><span>Bus type</span><strong>${esc(b.busType)}</strong></div>
            <div><span>Seats</span><strong>${esc(b.seats.join(', '))}</strong></div>
            <div><span>Mobile</span><strong>${esc(b.contact.phone)}</strong></div>
            <div><span>Payment</span><strong>${esc(b.payment.method)} (demo)</strong></div>
            <div><span>Booked on</span><strong>${new Date(b.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</strong></div>
          </div>
          <table class="pax-table">
            <thead><tr><th>Seat</th><th>Passenger</th><th>Age</th><th>Gender</th></tr></thead>
            <tbody>${b.passengers.map((p) => `<tr><td>${esc(p.seat)}</td><td>${esc(p.name)}</td><td>${esc(p.age)}</td><td>${esc(p.gender)}</td></tr>`).join('')}</tbody>
          </table>
          <div class="ticket-foot"><span>Total paid</span><span>${rupees(b.totalFare)}</span></div>
          <p class="ticket-note">Demo ticket with sample data — not valid for travel.</p>
        </div>
      </div>`;
    show('ticketSection');
    window.scrollTo({ top: $('ticketSection').offsetTop - 10, behavior: 'smooth' });
  }

  $('bookAnother').addEventListener('click', () => {
    unwatch();
    show(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---------- My bookings ----------
  const ticketsById = new Map();
  $('myBookingBtn').addEventListener('click', async () => {
    show('lookupSection');
    const list = $('myList');
    list.innerHTML = '<div class="empty">Loading your bookings…</div>';
    const tickets = await store.myTickets();
    tickets.forEach((t) => ticketsById.set(t.id, t));
    list.innerHTML = tickets.length
      ? '<h2>My bookings</h2>' + tickets.map((t) => `
        <div class="my-item">
          <div><strong>${esc(t.from)} → ${esc(t.to)}</strong><span class="muted small">${prettyDate(t.date)} · ${prettyTime(t.depart)} · Seats ${esc(t.seats.join(', '))} · ${esc(t.id)}</span></div>
          <button type="button" class="btn btn-ghost" data-ticket="${esc(t.id)}">View ticket</button>
        </div>`).join('')
      : '<div class="empty">You have no bookings yet. Search for a bus to book your first ticket.</div>';
  });
  $('myList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ticket]');
    if (btn && ticketsById.has(btn.dataset.ticket)) renderTicket(ticketsById.get(btn.dataset.ticket));
  });

  $('homeLink').addEventListener('click', (e) => {
    e.preventDefault();
    show(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---------- Popular routes ----------
  const POPULAR = [['Chennai', 'Coimbatore'], ['Coimbatore', 'Chennai'], ['Chennai', 'Erode'], ['Chennai', 'Tirupur'], ['Coimbatore', 'Tirupur'], ['Erode', 'Coimbatore']];
  function renderRoutes() {
    $('routeGrid').innerHTML = POPULAR.map(([from, to]) => {
      const overnight = from === 'Chennai' || to === 'Chennai';
      return `<button type="button" class="route-card" data-from="${from}" data-to="${to}">
        ${busArt(overnight ? 'AC Sleeper' : 'Non-AC Seater (2+2)', 'route')}
        <span class="route-text">
          <span class="route-cities">${from} → ${to}</span>
          <span class="route-meta">${overnight ? 'Overnight sleepers and seaters' : 'Buses through the day'}</span>
          <span class="route-go">View buses</span>
        </span>
      </button>`;
    }).join('');
  }
  $('routeGrid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-from]');
    if (!card || !state.date) return;
    $('fromCity').value = card.dataset.from;
    $('toCity').value = card.dataset.to;
    searchBuses({ from: card.dataset.from, to: card.dataset.to, date: state.date });
  });

  // ---------- Start ----------
  (async function init() {
    try {
      await store.init();
      if (!store.remote) {
        $('sampleBanner').insertAdjacentHTML('beforeend', ' Bookings are saved only in this browser.');
      }
      const meta = await api('/api/meta');
      state.cities = meta.cities;
      state.today = meta.today;
      state.maxSeats = meta.maxSeats;
      fillCities();
      renderRoutes();
      setDate(state.today);
    } catch {
      $('searchError').textContent = 'The page could not start. Please reload it.';
    }
  })();
})();
