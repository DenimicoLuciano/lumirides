// LumiRides SPA — a public website that works like an app (PWA).
// One driver (Denim), rider accounts, trip requests, e-transfer or cash.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
const money = (n) => (n == null ? '' : '$' + Number(n).toFixed(2));
function fmtWhen(dateStr, timeStr) {
  let d = dateStr || '';
  const [y, m, dnum] = String(dateStr || '').split('-').map(Number);
  if (y && m && dnum) {
    d = new Date(Date.UTC(y, m - 1, dnum)).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  let t = timeStr || '';
  const [hh, mm] = String(timeStr || '').split(':').map(Number);
  if (!isNaN(hh)) { const ap = hh >= 12 ? 'PM' : 'AM'; const h12 = hh % 12 === 0 ? 12 : hh % 12; t = `${h12}:${String(mm || 0).padStart(2, '0')} ${ap}`; }
  return `${d} · ${t}`;
}
const STATUS_LABEL = { requested: 'Requested', confirmed: 'Confirmed', on_the_way: 'On the way', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled' };
const payLabel = (m) => (m === 'etransfer' ? '💸 Interac e-transfer' : '💵 Cash on arrival');

// ---------------- Rider Notice (read-only, static) ----------------
const NOTICE_HTML = `
  <h3>🚗 A personal ride service</h3>
  <p>LumiRides is a personal ride service run by <b>one independent driver — Denim</b> — in Markham &amp; the GTA. It is <b>not</b> a licensed taxi company or rideshare service, and it is not affiliated with Uber, Lyft, or any taxi company.</p>
  <h3>🤝 Private arrangements</h3>
  <p>Every ride is a <b>private arrangement made directly between you (the rider) and Denim (the driver)</b>. When you book here, you are asking Denim personally for a ride — nothing more, nothing less.</p>
  <h3>💵 Payment goes directly to the driver</h3>
  <p>You pay Denim directly, in one of two ways: <b>Interac e-transfer</b>, or <b>cash on arrival</b>. There are <b>no card payments and no in-app payments</b>.</p>
  <h3>🛡️ A note on insurance</h3>
  <p>These rides <b>do not carry commercial ride-hailing insurance</b>. By booking a ride, you understand and accept the informal nature of this service.</p>
  <h3>🕐 Bookings are requests</h3>
  <p>A booking is a <b>request until Denim confirms it</b> and sets the price. He can decline any trip. Please <b>don't book a time-critical trip</b> (like a flight or an appointment you can't miss) relying on a confirmation that hasn't come yet.</p>
  <p class="muted">Questions before you book? Call or text Denim at <a href="tel:7053084489">705-308-4489</a>.</p>`;

const App = {
  user: null,
  cfg: { driverName: 'Denim', serviceArea: 'Markham & the GTA', etransferEmail: '' },
  _payMethod: 'etransfer',
  _authMode: 'register',

  get isDriver() { return !!(this.user && (this.user.is_driver || this.user.role === 'driver')); },

  async init() {
    try { this.cfg = await API.get('/config'); } catch (e) {}
    if (API.token) {
      try { const { user } = await API.get('/auth/me'); this.user = user; }
      catch (e) { API.setToken(null); }
    }
    window.addEventListener('hashchange', () => this.route());
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (el) this.onAction(el.dataset.act, el.dataset.id, el);
    });
    this.route();
  },

  route() {
    const h = (location.hash || '#/').replace(/^#/, '');
    this.renderChrome(h);
    const el = document.getElementById('app');
    if (!this.user) {
      if (h === '/notice') return this.viewNotice(el);
      return this.viewLanding(el);
    }
    if (h === '/trips') return this.viewTrips(el);
    if (h === '/driver' && this.isDriver) return this.viewDriver(el);
    if (h === '/account') return this.viewAccount(el);
    if (h === '/notice') return this.viewNotice(el);
    return this.viewBook(el);
  },

  renderChrome(h) {
    const nav = document.getElementById('bottomNav');
    const authArea = document.getElementById('authArea');
    if (!this.user) {
      nav.className = 'bottomnav'; nav.innerHTML = '';
      authArea.innerHTML = `<a class="btn sm ghost" href="#/">Log in</a>`;
      return;
    }
    authArea.innerHTML = `<span class="small muted">${esc(this.user.name.split(' ')[0])}${this.isDriver ? ' 🧭' : ''}</span>`;
    const item = (href, ic, label) => `<a href="#${href}" class="${h === href ? 'sel' : ''}"><span class="ic">${ic}</span>${label}</a>`;
    nav.className = 'bottomnav on';
    nav.innerHTML =
      item('/', '🚗', 'Book') +
      item('/trips', '🧾', 'My Trips') +
      (this.isDriver ? item('/driver', '🧭', 'Driver') : '') +
      item('/account', '👤', 'Account');
  },

  // ---------------- "Your driver" card ----------------
  driverCard() {
    return `<div class="card" style="display:flex;gap:14px;align-items:center">
      <div style="font-size:42px;line-height:1">🧑‍✈️</div>
      <div>
        <h3 style="margin:0 0 2px">Your driver — ${esc(this.cfg.driverName)}</h3>
        <p class="small" style="margin:0 0 3px">📍 Markham-based · one driver, every trip, so you always know who's picking you up.</p>
        <p class="small muted" style="margin:0">⭐ 3 years of delivery driving across the GTA (DoorDash, since 2022), plus long-haul drives to Alberta and Colorado — zero accidents.</p>
      </div>
    </div>`;
  },

  // ---------------- landing + auth ----------------
  viewLanding(el) {
    el.innerHTML = `
      <div class="hero">
        <div class="big">🚗</div>
        <h1>LumiRides</h1>
        <p style="margin:4px 0 2px">Personal rides in <b>${esc(this.cfg.serviceArea)}</b> — one driver, ${esc(this.cfg.driverName)}.</p>
        <p class="muted" style="margin:2px 0 0">Book a trip, get a price, pay by Interac e-transfer or cash on arrival.</p>
      </div>
      <div class="card">
        <h3>How it works</h3>
        <p class="prose" style="font-size:14.5px">
          1️⃣ Make a free rider account.<br>
          2️⃣ Book your trip — pickup, dropoff, date &amp; time.<br>
          3️⃣ ${esc(this.cfg.driverName)} confirms your trip and sets the price.<br>
          4️⃣ Pay by e-transfer or cash. That's it.
        </p>
        <p class="small muted">LumiRides is a personal, unlicensed ride service — please read the <a href="#/notice">Rider Notice</a> before booking.</p>
      </div>
      ${this.driverCard()}
      <div class="card">
        <div class="seg" role="tablist">
          <button id="tabRegister" class="${this._authMode === 'register' ? 'sel' : ''}">Create account</button>
          <button id="tabLogin" class="${this._authMode === 'login' ? 'sel' : ''}">Log in</button>
        </div>
        ${this._authMode === 'register' ? `
        <form id="authForm">
          <label class="f">Your name</label><input type="text" id="aName" required maxlength="60" autocomplete="name">
          <label class="f">Phone (your driver needs this)</label><input type="tel" id="aPhone" required maxlength="30" autocomplete="tel">
          <label class="f">Email</label><input type="email" id="aEmail" required autocomplete="email">
          <label class="f">Password (6+ characters)</label><input type="password" id="aPass" required minlength="6" autocomplete="new-password">
          <label class="checkline" style="background:none;border:none;padding-left:0"><input type="checkbox" id="aRemember" checked> Keep me signed in</label>
          <div class="err" id="authErr"></div>
          <button class="btn gold block" style="margin-top:14px" type="submit">Create rider account</button>
        </form>` : `
        <form id="authForm">
          <label class="f">Email</label><input type="email" id="aEmail" required autocomplete="email">
          <label class="f">Password</label><input type="password" id="aPass" required autocomplete="current-password">
          <label class="checkline" style="background:none;border:none;padding-left:0"><input type="checkbox" id="aRemember" checked> Keep me signed in</label>
          <div class="err" id="authErr"></div>
          <button class="btn gold block" style="margin-top:14px" type="submit">Log in</button>
        </form>`}
      </div>`;
    document.getElementById('tabRegister').onclick = () => { this._authMode = 'register'; this.route(); };
    document.getElementById('tabLogin').onclick = () => { this._authMode = 'login'; this.route(); };
    document.getElementById('authForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById('authErr');
      err.style.display = 'none';
      try {
        let data;
        if (this._authMode === 'register') {
          data = await API.post('/auth/register', {
            name: document.getElementById('aName').value,
            phone: document.getElementById('aPhone').value,
            email: document.getElementById('aEmail').value,
            password: document.getElementById('aPass').value,
          });
        } else {
          data = await API.post('/auth/login', {
            email: document.getElementById('aEmail').value,
            password: document.getElementById('aPass').value,
          });
        }
        API.setToken(data.token, document.getElementById('aRemember').checked);
        this.user = data.user;
        toast(this.isDriver ? 'Welcome back, Driver 🧭' : `Welcome to LumiRides, ${this.user.name.split(' ')[0]} 🚗`);
        location.hash = '#/';
        this.route();
      } catch (ex) {
        err.textContent = ex.message || 'Something went wrong';
        err.style.display = 'block';
      }
    };
  },

  // ---------------- rider notice ----------------
  viewNotice(el) {
    el.innerHTML = `
      <h2>📜 Rider Notice</h2>
      <p class="muted small">Please read this before you book — it explains exactly what LumiRides is (and isn't).</p>
      <div class="card prose">${NOTICE_HTML}</div>
      ${this.user ? `<a class="btn block" href="#/">← Back to booking</a>` : `<a class="btn block" href="#/">← Back</a>`}`;
  },

  // ---------------- book a ride ----------------
  viewBook(el) {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    el.innerHTML = `
      <h2>Book a ride 🚗</h2>
      <p class="muted small" style="margin-top:-4px">Personal rides in ${esc(this.cfg.serviceArea)} with ${esc(this.cfg.driverName)}. Bookings are <b>requests</b> — ${esc(this.cfg.driverName)} confirms each trip and sets the price.</p>
      ${this.driverCard()}
      <form class="card" id="bookForm">
        <label class="f">Pickup address</label>
        <input type="text" id="bPickup" required maxlength="200" placeholder="Where are you being picked up?">
        <label class="f">Dropoff address</label>
        <input type="text" id="bDropoff" required maxlength="200" placeholder="Where are you going?">
        <label class="f">Date</label>
        <input type="date" id="bDate" required value="${iso}">
        <label class="f">Time</label>
        <input type="time" id="bTime" required>
        <label class="f">Passengers</label>
        <select id="bPax">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}">${n} passenger${n > 1 ? 's' : ''}</option>`).join('')}</select>
        <label class="f">How you'll pay</label>
        <div class="seg">
          <button type="button" id="payEt" class="${this._payMethod === 'etransfer' ? 'sel' : ''}">💸 E-transfer</button>
          <button type="button" id="payCash" class="${this._payMethod === 'cash' ? 'sel' : ''}">💵 Cash</button>
        </div>
        <label class="f">Notes for your driver (optional)</label>
        <textarea id="bNotes" maxlength="500" placeholder="Gate code, landmarks, luggage, anything helpful…"></textarea>
        <label class="checkline">
          <input type="checkbox" id="bNotice">
          <span>I've read the <a href="#/notice">Rider Notice</a> and I understand this is a personal, unlicensed ride service.</span>
        </label>
        <div class="err" id="bookErr"></div>
        <button class="btn gold block" style="margin-top:16px" type="submit">Request this trip</button>
        <p class="small muted center" style="margin-bottom:0">No payment now — you pay ${esc(this.cfg.driverName)} directly once your trip is confirmed.</p>
      </form>`;
    const setPay = (m) => {
      this._payMethod = m;
      document.getElementById('payEt').classList.toggle('sel', m === 'etransfer');
      document.getElementById('payCash').classList.toggle('sel', m === 'cash');
    };
    document.getElementById('payEt').onclick = () => setPay('etransfer');
    document.getElementById('payCash').onclick = () => setPay('cash');
    document.getElementById('bookForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById('bookErr');
      err.style.display = 'none';
      const ack = document.getElementById('bNotice').checked;
      if (!ack) {
        err.textContent = 'Please read the Rider Notice and tick the box to book.';
        err.style.display = 'block';
        return;
      }
      try {
        const { booking } = await API.post('/bookings', {
          pickup: document.getElementById('bPickup').value,
          dropoff: document.getElementById('bDropoff').value,
          ride_date: document.getElementById('bDate').value,
          ride_time: document.getElementById('bTime').value,
          passengers: parseInt(document.getElementById('bPax').value, 10),
          notes: document.getElementById('bNotes').value,
          payment_method: this._payMethod,
          notice_acknowledged: ack,
        });
        toast(`Trip requested 🚗 Reference ${booking.ref} — ${this.cfg.driverName} will confirm & set your price.`);
        location.hash = '#/trips';
        this.route();
      } catch (ex) {
        err.textContent = (ex.data && ex.data.message) || ex.message || 'Booking failed';
        err.style.display = 'block';
      }
    };
  },
  // ---------------- my trips ----------------
  bookingCard(b, mine) {
    const canCancel = mine && ['requested', 'confirmed'].includes(b.status);
    return `<div class="card">
      <div class="row" style="justify-content:space-between">
        <span class="ref">${esc(b.ref)}</span>
        <span><span class="pill ${b.status}">${STATUS_LABEL[b.status] || esc(b.status)}</span>
        <span class="pill ${b.payment_status}">${b.payment_status === 'paid' ? 'Paid' : 'Unpaid'}</span></span>
      </div>
      <div class="route" style="margin-top:10px">📍 ${esc(b.pickup)}<br><span class="arrow">➜</span> 🏁 ${esc(b.dropoff)}</div>
      <div class="meta">
        <span>🗓️ ${esc(fmtWhen(b.ride_date, b.ride_time))}</span>
        <span>👥 ${b.passengers} passenger${b.passengers > 1 ? 's' : ''}</span>
        <span>${payLabel(b.payment_method)}</span>
        ${b.price != null ? `<span>💰 <b style="color:var(--gold)">${money(b.price)}</b></span>` : '<span>💰 Price set on confirm</span>'}
      </div>
      ${b.notes ? `<p class="small muted" style="margin:8px 0 0">📝 ${esc(b.notes)}</p>` : ''}
      ${b.driver ? `<div class="notice-box">Your driver: <b>${esc(b.driver.name)}</b> · <a href="tel:${esc(b.driver.phone.replace(/[^+\d]/g, ''))}">📞 ${esc(b.driver.phone)}</a></div>` : ''}
      ${b.payment_instructions ? `<div class="notice-box">💳 ${esc(b.payment_instructions)}</div>` : ''}
      ${canCancel ? `<div class="actions"><button class="btn sm danger" data-act="cancel" data-id="${b.id}">Cancel this trip</button></div>` : ''}
    </div>`;
  },

  async viewTrips(el) {
    el.innerHTML = `<h2>My trips 🧾</h2><div class="empty">Loading…</div>`;
    try {
      const { bookings } = await API.get('/bookings/mine');
      el.innerHTML = `<h2>My trips 🧾</h2>` + (bookings.length
        ? bookings.map(b => this.bookingCard(b, true)).join('')
        : `<div class="card empty">No trips yet.<br><br><a class="btn" href="#/">Book your first ride 🚗</a></div>`);
    } catch (e) {
      el.innerHTML = `<h2>My trips 🧾</h2><div class="card">Couldn't load your trips (${esc(e.message)}). Pull to retry.</div>`;
    }
  },

  // ---------------- driver dashboard ----------------
  async viewDriver(el) {
    el.innerHTML = `<h2>Driver dashboard 🧭</h2><div class="empty">Loading…</div>`;
    try {
      const [{ bookings }, stats] = await Promise.all([API.get('/bookings'), API.get('/driver/stats')]);
      const active = bookings.filter(b => ['requested', 'confirmed', 'on_the_way'].includes(b.status)).length;
      el.innerHTML = `
        <h2>Driver dashboard 🧭</h2>
        <div class="stat-grid">
          <div class="stat"><div class="v">${money(stats.earnings)}</div><div class="k">Earnings (paid fares)</div></div>
          <div class="stat"><div class="v">${active}</div><div class="k">Active bookings</div></div>
        </div>
        ${bookings.length ? bookings.map(b => this.driverBookingCard(b)).join('') : '<div class="card empty">No bookings yet.</div>'}`;
    } catch (e) {
      el.innerHTML = `<h2>Driver dashboard 🧭</h2><div class="card">Couldn't load the dashboard (${esc(e.message)}).</div>`;
    }
  },

  driverBookingCard(b) {
    const r = b.rider || {};
    const acts = [];
    if (b.status === 'requested') {
      acts.push(`<input type="number" class="price-in" id="price-${b.id}" placeholder="$ price" min="1" step="0.50">
        <button class="btn sm gold" data-act="confirm" data-id="${b.id}">Set price &amp; confirm</button>`);
    }
    if (['requested', 'confirmed'].includes(b.status)) acts.push(`<button class="btn sm danger" data-act="decline" data-id="${b.id}">Decline</button>`);
    if (b.status === 'confirmed') acts.push(`<button class="btn sm" data-act="on-the-way" data-id="${b.id}">On the way ▶</button>`);
    if (b.status === 'on_the_way') acts.push(`<button class="btn sm" data-act="complete" data-id="${b.id}">Complete ✓</button>`);
    if (b.price != null && b.payment_status !== 'paid' && !['cancelled', 'declined'].includes(b.status))
      acts.push(`<button class="btn sm gold" data-act="mark-paid" data-id="${b.id}">Mark paid 💰</button>`);
    return `<div class="card">
      <div class="row" style="justify-content:space-between">
        <span class="ref">${esc(b.ref)}</span>
        <span><span class="pill ${b.status}">${STATUS_LABEL[b.status] || esc(b.status)}</span>
        <span class="pill ${b.payment_status}">${b.payment_status === 'paid' ? 'Paid' : 'Unpaid'}</span></span>
      </div>
      <div class="route" style="margin-top:10px">📍 ${esc(b.pickup)}<br><span class="arrow">➜</span> 🏁 ${esc(b.dropoff)}</div>
      <div class="meta">
        <span>🗓️ ${esc(fmtWhen(b.ride_date, b.ride_time))}</span>
        <span>👥 ${b.passengers}</span>
        <span>${payLabel(b.payment_method)}</span>
        ${b.price != null ? `<span>💰 <b style="color:var(--gold)">${money(b.price)}</b></span>` : ''}
      </div>
      <p class="small" style="margin:8px 0 0">🧑 Rider: <b>${esc(r.name || '')}</b> · <a href="tel:${esc(String(r.phone || '').replace(/[^+\d]/g, ''))}">📞 ${esc(r.phone || '')}</a></p>
      ${b.notes ? `<p class="small muted" style="margin:6px 0 0">📝 ${esc(b.notes)}</p>` : ''}
      <p class="small" style="margin:6px 0 0">${b.notice_acknowledged
        ? `📜 Rider Notice: <span style="color:var(--good)">✓ acknowledged</span>${b.notice_acknowledged_at ? ` <span class="muted">(${esc(b.notice_acknowledged_at)} UTC)</span>` : ''}`
        : `📜 Rider Notice: <span style="color:var(--bad)">⚠ not acknowledged</span>`}</p>
      ${acts.length ? `<div class="actions">${acts.join('')}</div>` : ''}
    </div>`;
  },

  // ---------------- account ----------------
  viewAccount(el) {
    const u = this.user;
    el.innerHTML = `
      <h2>Account 👤</h2>
      <div class="card">
        <h3>${esc(u.name)} ${this.isDriver ? '<span class="pill confirmed">Driver</span>' : '<span class="pill unpaid">Rider</span>'}</h3>
        <div class="meta"><span>✉️ ${esc(u.email)}</span><span>📞 ${esc(u.phone)}</span></div>
      </div>
      <div class="card">
        <div class="menu-list">
          <a href="#/">🚗 Book a ride <span>›</span></a>
          <a href="#/trips">🧾 My trips <span>›</span></a>
          ${this.isDriver ? '<a href="#/driver">🧭 Driver dashboard <span>›</span></a>' : ''}
          <a href="#/notice">📜 Rider Notice <span>›</span></a>
        </div>
      </div>
      <div class="card">
        <h3>📱 Use LumiRides like an app</h3>
        <p class="small muted" style="line-height:1.55">Open your browser menu and choose <b>“Add to Home Screen”</b> — LumiRides installs on your phone and opens full-screen, just like an app.</p>
      </div>
      <button class="btn danger block" id="logoutBtn">Log out</button>`;
    document.getElementById('logoutBtn').onclick = async () => {
      try { await API.post('/auth/logout'); } catch (e) {}
      API.setToken(null);
      this.user = null;
      location.hash = '#/';
      this.route();
    };
  },

  // ---------------- shared actions ----------------
  async onAction(act, id, el) {
    const endpoints = { cancel: 'cancel', decline: 'decline', 'on-the-way': 'on-the-way', complete: 'complete', 'mark-paid': 'mark-paid' };
    try {
      if (act === 'confirm') {
        const input = document.getElementById('price-' + id);
        const price = parseFloat(input && input.value);
        if (!price || price <= 0) { toast('Enter the trip price first 💰'); return; }
        await API.post(`/bookings/${id}/confirm`, { price });
        toast('Trip confirmed ✓ Price set');
      } else if (endpoints[act]) {
        await API.post(`/bookings/${id}/${endpoints[act]}`);
        toast({ cancel: 'Trip cancelled', decline: 'Trip declined', 'on-the-way': 'Marked on the way ▶', complete: 'Trip completed ✓', 'mark-paid': 'Marked paid 💰' }[act] || 'Done');
      } else return;
      this.route();
    } catch (e) {
      toast((e.data && e.data.message) || e.message || 'Action failed');
    }
  },
};

App.init();
