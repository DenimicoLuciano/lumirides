// Database: SQLite via libsql — Turso cloud when TURSO_DATABASE_URL is set
// (accounts and bookings persist across deploys), local file otherwise.
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'lumirides.db');

const Database = require('libsql');
const TURSO_URL = process.env.TURSO_DATABASE_URL || '';
let db;
if (TURSO_URL) {
  db = new Database(TURSO_URL, { authToken: process.env.TURSO_AUTH_TOKEN || '' });
  console.log('🗄️ LumiRides DB: Turso cloud (persistent)');
} else {
  db = new Database(DB_PATH);
  try { db.pragma('journal_mode = WAL'); } catch (e) {}
  console.log('🗄️ LumiRides DB: local file (ephemeral)');
}
try { db.pragma('foreign_keys = ON'); } catch (e) { /* best-effort on remote */ }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'rider',           -- rider | driver
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,                     -- short human reference, e.g. LR-8K2QPD
  rider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pickup TEXT NOT NULL,
  dropoff TEXT NOT NULL,
  ride_date TEXT NOT NULL,                      -- YYYY-MM-DD
  ride_time TEXT NOT NULL,                      -- HH:MM (24h)
  passengers INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'cash',  -- etransfer | cash
  -- Rider Notice: the rider must tick "I've read the Rider Notice…" to book.
  notice_acknowledged INTEGER NOT NULL DEFAULT 0,
  notice_acknowledged_at TEXT,
  status TEXT NOT NULL DEFAULT 'requested',     -- requested | confirmed | on_the_way | completed | declined | cancelled
  price_cents INTEGER,                          -- set by the driver on confirm; NULL until then
  payment_status TEXT NOT NULL DEFAULT 'unpaid',-- unpaid | paid
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_rider ON bookings(rider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
`;
db.exec(SCHEMA);

module.exports = db;
module.exports.DATA_DIR = DATA_DIR;
module.exports.DB_PATH = DB_PATH;
