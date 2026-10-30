# 🚗 LumiRides

Denim's personal ride-booking site for **Markham & the GTA**. One driver
(Denim), rider accounts, trip requests, and payment directly to the driver by
**Interac e-transfer** or **cash on arrival**. A public website that operates
like an app — installable as a PWA ("Add to Home Screen", full-screen,
app-shell caching), with no native app to download.

## How it works

- **Riders** register, then book a trip: pickup, dropoff, date, time,
  passengers, notes, and how they'll pay. Every booking is a **request**
  until the driver confirms it.
- Before booking, riders must read the **Rider Notice** (in-app, linked from
  the booking form and the account menu) and tick: *"I've read the Rider
  Notice and I understand this is a personal, unlicensed ride service."*
  The acknowledgment flag + timestamp are stored on each booking and shown
  in the driver dashboard.
- **The driver** (the account registered with `DRIVER_EMAIL`) gets a
  dashboard: confirm a request and **set the price by hand** (no fare
  automation, no maps API), decline, mark on-the-way, mark completed, and
  mark paid. An earnings total sums all paid fares.
- Each booking carries a short human reference (e.g. `LR-8K2QPD`); riders
  put it in their e-transfer message so payments match trips.
- On confirmed trips, riders see the driver's phone number and their payment
  instructions (e-transfer address / "cash on arrival").

Status flow: `requested → confirmed → on_the_way → completed`, with
`declined` (driver) and `cancelled` (rider, while requested/confirmed) exits.
Payment status: `unpaid → paid`, marked by the driver when the money lands.

## Run locally

```bash
npm install
node server.js          # http://localhost:3000
```

Data lands in `data/lumirides.db` (local fallback). For permanent storage in
production, set the Turso env vars below — same pattern as Luminous/Lumiveil.

## Environment

| Var | Purpose |
| --- | --- |
| `PORT` | Listen port (default 3000) |
| `DATA_DIR` | Local DB directory (default `./data`) |
| `DRIVER_EMAIL` | Account with this email is automatically the Driver (default `denimdenimdenim00@gmail.com`) |
| `DRIVER_NAME` / `DRIVER_PHONE` | Shown to riders on confirmed trips |
| `ETRANSFER_EMAIL` | Interac e-transfer address shown to riders |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Turso cloud DB; without them, a local SQLite file is used (ephemeral on free hosting) |

See `.env.example`. No real credentials live in this repo.

## Deploy (Render)

The included `render.yaml` blueprint creates one free Docker web service
named `lumirides` from the `Dockerfile`. After the first deploy, set
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in the Render dashboard so
accounts and bookings survive redeploys, then redeploy once.
