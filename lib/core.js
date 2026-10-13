// Shared booking logic for the Vercel functions in /api.
//
// SAMPLE DATA ONLY: operators, timings, durations and fares are made up
// for demonstration and are not real schedules.

const crypto = require('crypto');

// ---------- Sample data ----------
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

// ---------- Dates in Indian Standard Time ----------
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

// ---------- Storage: Upstash Redis over its REST API ----------
// Adding an Upstash Redis database to the Vercel project sets these variables.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const storageReady = () => Boolean(REDIS_URL && REDIS_TOKEN);

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `Redis request failed (${res.status})`);
  return json.result;
}

const tripKey = (busId, date) => `payanam:trip:${busId}:${date}`;
const bookingKey = (id) => `payanam:booking:${id}`;

// Claims all seats or none: runs inside Redis as one step, so two visitors can't get the same seat.
const CLAIM_SCRIPT = `
local taken = {}
for i = 2, #ARGV do
  if redis.call('HEXISTS', KEYS[1], ARGV[i]) == 1 then table.insert(taken, ARGV[i]) end
end
if #taken > 0 then return taken end
for i = 2, #ARGV do redis.call('HSET', KEYS[1], ARGV[i], ARGV[1]) end
return {}`;

async function bookedSeats(busId, date) {
  const keys = await redis(['HKEYS', tripKey(busId, date)]);
  return Array.isArray(keys) ? keys : [];
}

// ---------- Request handling ----------
const ok = (body, status = 200) => ({ status, body });
const fail = (status, error, extra) => ({ status, body: { error, ...(extra || {}) } });
const NO_STORAGE = () => fail(503, 'Booking storage is not set up on this deployment yet.');

function meta() {
  return ok({ cities: CITIES, today: todayIST(), maxSeats: MAX_SEATS, storage: storageReady() ? 'shared' : 'none' });
}

async function listBuses(q) {
  if (!CITIES.includes(q.from) || !CITIES.includes(q.to)) return fail(400, 'Please choose valid From and To cities.');
  if (q.from === q.to) return fail(400, 'From and To cities must be different.');
  const e = dateError(q.date); if (e) return fail(400, e);
  if (!storageReady()) return NO_STORAGE();
  const list = BUSES.filter((b) => b.from === q.from && b.to === q.to);
  const counts = await Promise.all(list.map((b) => bookedSeats(b.id, q.date)));
  return ok({
    date: q.date,
    buses: list.map((b, i) => {
      const total = seatLayout(b.layout).length;
      return { ...b, totalSeats: total, seatsAvailable: total - counts[i].length, departed: departed(b, q.date) };
    }).sort((a, b) => a.depart.localeCompare(b.depart)),
  });
}

async function seats(id, q) {
  const bus = BUS_BY_ID.get(id); if (!bus) return fail(404, 'Bus not found.');
  const e = dateError(q.date); if (e) return fail(400, e);
  if (!storageReady()) return NO_STORAGE();
  return ok({ bus, seats: seatLayout(bus.layout), booked: await bookedSeats(bus.id, q.date), departed: departed(bus, q.date) });
}

async function createBooking(body) {
  const { busId, date, passengers, contact, paymentMethod } = body || {};
  const bus = BUS_BY_ID.get(busId); if (!bus) return fail(404, 'Bus not found.');
  const e = dateError(date); if (e) return fail(400, e);
  if (departed(bus, date)) return fail(400, 'This bus has already departed today. Please choose another bus or date.');
  if (!Array.isArray(passengers) || !passengers.length) return fail(400, 'Please select at least one seat.');
  if (passengers.length > MAX_SEATS) return fail(400, `You can book up to ${MAX_SEATS} seats at a time.`);
  const valid = new Set(seatLayout(bus.layout).map((s) => s.id));
  const seatIds = []; const clean = [];
  for (const p of passengers) {
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const age = Number(p.age);
    if (!valid.has(p.seat)) return fail(400, `Seat ${p.seat} does not exist on this bus.`);
    if (seatIds.includes(p.seat)) return fail(400, `Seat ${p.seat} was selected twice.`);
    if (name.length < 2 || name.length > 60) return fail(400, 'Each passenger needs a name (2–60 characters).');
    if (!Number.isInteger(age) || age < 1 || age > 120) return fail(400, `Please enter a valid age for ${name}.`);
    if (!['Male', 'Female', 'Other'].includes(p.gender)) return fail(400, `Please choose a gender for ${name}.`);
    seatIds.push(p.seat); clean.push({ seat: p.seat, name, age, gender: p.gender });
  }
  const phone = String(contact?.phone || '').trim();
  const email = String(contact?.email || '').trim();
  if (!/^[6-9]\d{9}$/.test(phone)) return fail(400, 'Please enter a valid 10-digit mobile number.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'Please enter a valid email address or leave it blank.');
  if (!['UPI', 'Card', 'Net Banking'].includes(paymentMethod)) return fail(400, 'Please choose a payment method.');
  if (!storageReady()) return NO_STORAGE();

  const id = 'PYN' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const taken = await redis(['EVAL', CLAIM_SCRIPT, '1', tripKey(bus.id, date), id, ...seatIds]);
  if (Array.isArray(taken) && taken.length) {
    return fail(409, `Sorry, seat${taken.length > 1 ? 's' : ''} ${taken.join(', ')} ${taken.length > 1 ? 'were' : 'was'} just booked by someone else. Please pick again.`, { taken });
  }
  const booking = {
    id, status: 'CONFIRMED', busId: bus.id, operator: bus.operator, busType: bus.type, from: bus.from, to: bus.to,
    date, depart: bus.depart, arrive: bus.arrive, nextDay: bus.nextDay, seats: seatIds, passengers: clean,
    contact: { phone, email }, farePerSeat: bus.fare, totalFare: bus.fare * seatIds.length,
    payment: { method: paymentMethod, demo: true }, createdAt: new Date().toISOString(),
  };
  await redis(['SET', bookingKey(id), JSON.stringify(booking)]);
  return ok({ booking }, 201);
}

async function getBooking(id, q) {
  if (!storageReady()) return NO_STORAGE();
  const raw = await redis(['GET', bookingKey(String(id).trim().toUpperCase())]);
  const booking = raw ? JSON.parse(raw) : null;
  if (!booking || booking.contact.phone !== String(q.phone || '').trim()) {
    return fail(404, 'No booking found with that booking ID and mobile number.');
  }
  return ok({ booking });
}

// Wraps a handler for Vercel's Node.js runtime.
function handler(methods, fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const query = Object.fromEntries(url.searchParams);
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const result = await fn({ query, body: body || {}, path: url.pathname });
      res.status(result.status).json(result.body);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
    }
  };
}

module.exports = { meta, listBuses, seats, createBooking, getBooking, handler, storageReady };
