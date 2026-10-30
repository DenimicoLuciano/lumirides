// LumiRides — Express backend + API. Serves the PWA and all JSON APIs.
//
// One driver (Denim) giving personal rides in Markham & the GTA. Riders make
// an account, request a trip, and choose to pay by Interac e-transfer or cash
// on arrival. Every booking is a REQUEST until the driver confirms it and
// sets the price by hand — there is no fare automation and no maps API.
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // The service worker must never be cached by the browser's HTTP cache.
    if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ---------- service facts ----------
const DRIVER_NAME = process.env.DRIVER_NAME || 'Denim';
const DRIVER_PHONE = process.env.DRIVER_PHONE || '705-308-4489';
const ETRANSFER_EMAIL = process.env.ETRANSFER_EMAIL || 'lilleviedwards03@gmail.com';
const SERVICE_AREA = 'Markham & the GTA';

// ---------- users & auth (mirrors Luminous / Lumiveil) ----------
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');

// The driver account: whoever registers with the DRIVER_EMAIL address is the
// driver — no password is ever hardcoded.
const DRIVER_EMAIL = (process.env.DRIVER_EMAIL || 'denimdenimdenim00@gmail.com').toLowerCase();
function isDriverEmail(email) {
  return !!email && String(email).toLowerCase() === DRIVER_EMAIL;
}
function ensureDriverRole(u) {
  if (u && isDriverEmail(u.email) && u.role !== 'driver') {
    db.prepare("UPDATE users SET role = 'driver' WHERE id = ?").run(u.id);
    u.role = 'driver';
  }
  return u;
}
function isDriver(u) {
  return !!u && (u.role === 'driver' || isDriverEmail(u.email));
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    role: isDriver(u) ? 'driver' : 'rider', is_driver: isDriver(u),
    created_at: u.created_at,
  };
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  const s = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!s) return res.status(401).json({ error: 'INVALID_TOKEN' });
  const user = getUserById.get(s.user_id);
  if (!user) return res.status(401).json({ error: 'INVALID_TOKEN' });
  req.user = ensureDriverRole(user);
  next();
}
function driverRequired(req, res, next) {
  if (!isDriver(req.user)) return res.status(403).json({ error: 'DRIVER_ONLY', message: 'LumiRides has one driver — this area is his.' });
  next();
}

app.get('/api/config', (req, res) => {
  res.json({
    appName: 'LumiRides', driverName: DRIVER_NAME, serviceArea: SERVICE_AREA,
    etransferEmail: ETRANSFER_EMAIL,
  });
});

app.post('/api/auth/register', (req, res) => {
  const { email, password, name, phone } = req.body || {};
  if (!email || !password || !name || !phone)
    return res.status(400).json({ error: 'Name, phone, email and password are all required' });
  if (String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const cleanEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
    return res.status(400).json({ error: 'That email does not look right' });
  if (getUserByEmail.get(cleanEmail))
    return res.status(409).json({ error: 'That email already has an account — log in instead' });
  const hash = bcrypt.hashSync(String(password), 10);
  const role = isDriverEmail(cleanEmail) ? 'driver' : 'rider';
  const r = db.prepare('INSERT INTO users (email, password_hash, name, phone, role) VALUES (?,?,?,?,?)')
    .run(cleanEmail, hash, String(name).trim().slice(0, 60), String(phone).trim().slice(0, 30), role);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, r.lastInsertRowid);
  res.json({ token, user: publicUser(getUserById.get(r.lastInsertRowid)) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = email && getUserByEmail.get(String(email).trim().toLowerCase());
  if (!u || !u.password_hash || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });
  ensureDriverRole(u);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, u.id);
  res.json({ token, user: publicUser(getUserById.get(u.id)) });
});

app.post('/api/auth/logout', authRequired, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.headers.authorization.slice(7));
  res.json({ ok: true });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({ user: publicUser(getUserById.get(req.user.id)) });
});

// ---------- bookings ----------
const STATUSES = ['requested', 'confirmed', 'on_the_way', 'completed', 'declined', 'cancelled'];
const ACTIVE = ['requested', 'confirmed', 'on_the_way'];
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L lookalikes

function newRef() {
  for (let tries = 0; tries < 20; tries++) {
    let s = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) s += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
    const ref = 'LR-' + s;
    if (!db.prepare('SELECT 1 FROM bookings WHERE ref = ?').get(ref)) return ref;
  }
  throw new Error('Could not mint a booking reference');
}

// What each side sees. Riders get the driver's phone and payment instructions
// once a trip is confirmed or on its way; the driver always sees rider contact.
function publicBooking(b, viewer) {
  const out = {
    id: b.id, ref: b.ref,
    pickup: b.pickup, dropoff: b.dropoff,
    ride_date: b.ride_date, ride_time: b.ride_time,
    passengers: b.passengers, notes: b.notes,
    payment_method: b.payment_method, payment_status: b.payment_status,
    notice_acknowledged: !!b.notice_acknowledged,
    notice_acknowledged_at: b.notice_acknowledged_at || null,
    status: b.status,
    price: b.price_cents == null ? null : b.price_cents / 100,
    price_cents: b.price_cents,
    created_at: b.created_at, updated_at: b.updated_at,
  };
  if (viewer && isDriver(viewer)) {
    const rider = getUserById.get(b.rider_id);
    out.rider = rider ? { id: rider.id, name: rider.name, phone: rider.phone, email: rider.email } : null;
  } else {
    out.rider_id = b.rider_id;
    if (b.status === 'confirmed' || b.status === 'on_the_way') {
      out.driver = { name: DRIVER_NAME, phone: DRIVER_PHONE };
      out.payment_instructions = b.payment_method === 'etransfer'
        ? `Send Interac e-transfer to ${ETRANSFER_EMAIL} and put your booking reference ${b.ref} in the message.`
        : 'Pay your driver in cash on arrival.';
    }
  }
  return out;
}

// Upcoming first (active trips by date/time), then the rest newest-first.
function sortBookings(list) {
  return list.sort((a, b) => {
    const aActive = ACTIVE.includes(a.status), bActive = ACTIVE.includes(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;
    const aWhen = a.ride_date + ' ' + a.ride_time, bWhen = b.ride_date + ' ' + b.ride_time;
    if (aActive) return aWhen < bWhen ? -1 : 1;
    return bWhen < aWhen ? -1 : 1;
  });
}

app.post('/api/bookings', authRequired, (req, res) => {
  const { pickup, dropoff, ride_date, ride_time, passengers, notes, payment_method } = req.body || {};
  const cleanPickup = String(pickup || '').trim().slice(0, 200);
  const cleanDropoff = String(dropoff || '').trim().slice(0, 200);
  if (!cleanPickup || !cleanDropoff)
    return res.status(400).json({ error: 'Pickup and dropoff addresses are required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ride_date || '')) || isNaN(Date.parse(ride_date)))
    return res.status(400).json({ error: 'Pick a valid date' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(ride_time || '')))
    return res.status(400).json({ error: 'Pick a valid time' });
  const pax = parseInt(passengers, 10);
  if (!Number.isInteger(pax) || pax < 1 || pax > 6)
    return res.status(400).json({ error: 'Passengers must be between 1 and 6' });
  if (!['etransfer', 'cash'].includes(payment_method))
    return res.status(400).json({ error: 'Payment method must be e-transfer or cash' });
  // The Rider Notice acknowledgment is required before any booking is taken.
  if (!((req.body || {}).notice_acknowledged === true))
    return res.status(400).json({ error: 'NOTICE_REQUIRED', message: 'Please read the Rider Notice and tick the acknowledgment box to book.' });
  const ref = newRef();
  const r = db.prepare(`INSERT INTO bookings
    (ref, rider_id, pickup, dropoff, ride_date, ride_time, passengers, notes, payment_method, notice_acknowledged, notice_acknowledged_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,datetime('now'))`)
    .run(ref, req.user.id, cleanPickup, cleanDropoff, ride_date, ride_time, pax,
      String(notes || '').trim().slice(0, 500), payment_method);
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(r.lastInsertRowid);
  res.json({ booking: publicBooking(b, req.user) });
});

app.get('/api/bookings/mine', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM bookings WHERE rider_id = ?').all(req.user.id);
  res.json({ bookings: sortBookings(rows).map(b => publicBooking(b, req.user)) });
});

app.get('/api/bookings', authRequired, driverRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM bookings').all();
  res.json({ bookings: sortBookings(rows).map(b => publicBooking(b, req.user)) });
});

app.get('/api/driver/stats', authRequired, driverRequired, (req, res) => {
  const row = db.prepare(`SELECT COALESCE(SUM(price_cents),0) AS cents, COUNT(*) AS trips
    FROM bookings WHERE payment_status = 'paid' AND status NOT IN ('cancelled','declined')`).get();
  const counts = {};
  for (const s of STATUSES) counts[s] = 0;
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM bookings GROUP BY status').all()) counts[r.status] = r.n;
  res.json({ earnings: row.cents / 100, earnings_cents: row.cents, paid_trips: row.trips, counts });
});

const getBooking = db.prepare('SELECT * FROM bookings WHERE id = ?');
function loadBooking(req, res) {
  const b = getBooking.get(parseInt(req.params.id, 10));
  if (!b) { res.status(404).json({ error: 'Booking not found' }); return null; }
  return b;
}
function touch(id) {
  db.prepare("UPDATE bookings SET updated_at = datetime('now') WHERE id = ?").run(id);
}

// Rider cancels their own trip while it is still requested or confirmed.
app.post('/api/bookings/:id/cancel', authRequired, (req, res) => {
  const b = loadBooking(req, res); if (!b) return;
  if (b.rider_id !== req.user.id && !isDriver(req.user))
    return res.status(403).json({ error: 'That is not your trip' });
  if (!['requested', 'confirmed'].includes(b.status))
    return res.status(409).json({ error: `A ${b.status} trip cannot be cancelled` });
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
  touch(b.id);
  res.json({ booking: publicBooking(getBooking.get(b.id), req.user) });
});

// Driver sets the price (CAD dollars) and confirms the request.
app.post('/api/bookings/:id/confirm', authRequired, driverRequired, (req, res) => {
  const b = loadBooking(req, res); if (!b) return;
  if (b.status !== 'requested')
    return res.status(409).json({ error: `Only a requested trip can be confirmed (this one is ${b.status})` });
  const price = Number((req.body || {}).price);
  if (!Number.isFinite(price) || price <= 0 || price > 100000)
    return res.status(400).json({ error: 'Set a price in CAD dollars (e.g. 25 or 25.50)' });
  db.prepare("UPDATE bookings SET status = 'confirmed', price_cents = ? WHERE id = ?")
    .run(Math.round(price * 100), b.id);
  touch(b.id);
  res.json({ booking: publicBooking(getBooking.get(b.id), req.user) });
});

app.post('/api/bookings/:id/decline', authRequired, driverRequired, (req, res) => {
  const b = loadBooking(req, res); if (!b) return;
  if (!['requested', 'confirmed'].includes(b.status))
    return res.status(409).json({ error: `A ${b.status} trip cannot be declined` });
  db.prepare("UPDATE bookings SET status = 'declined' WHERE id = ?").run(b.id);
  touch(b.id);
  res.json({ booking: publicBooking(getBooking.get(b.id), req.user) });
});

app.post('/api/bookings/:id/on-the-way', authRequired, driverRequired, (req, res) => {
  const b = loadBooking(req, res); if (!b) return;
  if (b.status !== 'confirmed')
    return res.status(409).json({ error: `Only a confirmed trip can be on the way (this one is ${b.status})` });
  db.prepare("UPDATE bookings SET status = 'on_the_way' WHERE id = ?").run(b.id);
  touch(b.id);
  res.json({ booking: publicBooking(getBooking.get(b.id), req.user) });
});

app.post('/api/bookings/:id/complete', authRequired, driverRequired, (req, res) => {
  const b = loadBooking(req, res); if (!b) return;
  if (b.status !== 'on_the_way')
    return res.status(409).json({ error: `Only an on-the-way trip can be completed (this one is ${b.status})` });
  db.prepare("UPDATE bookings SET status = 'completed' WHERE id = ?").run(b.id);
  touch(b.id);
  res.json({ booking: publicBooking(getBooking.get(b.id), req.user) });
});

// Driver marks the fare received — e-transfer landed, or cash in hand.
app.post('/api/bookings/:id/mark-paid', authRequired, driverRequired, (req, res) => {
  const b = loadBooking(req, res); if (!b) return;
  if (['cancelled', 'declined'].includes(b.status))
    return res.status(409).json({ error: `A ${b.status} trip cannot be marked paid` });
  if (b.price_cents == null)
    return res.status(409).json({ error: 'Set the price first (confirm the trip)' });
  db.prepare("UPDATE bookings SET payment_status = 'paid' WHERE id = ?").run(b.id);
  touch(b.id);
  res.json({ booking: publicBooking(getBooking.get(b.id), req.user) });
});

// SPA fallback: any non-API route serves the app shell.
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚗 LumiRides listening on http://localhost:${PORT}`);
});
