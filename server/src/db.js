import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.EXPOSEX_DATA_DIR || path.resolve(__dirname, '../../data');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  review_interval_days INTEGER NOT NULL DEFAULT 30,
  breach_sim_minutes INTEGER NOT NULL DEFAULT 0,
  last_review_at TEXT,
  last_sim_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'account',
  name TEXT NOT NULL,
  service_type TEXT NOT NULL DEFAULT 'other',
  domain TEXT,
  identifier TEXT,
  importance INTEGER NOT NULL DEFAULT 3,
  twofa TEXT NOT NULL DEFAULT 'none',
  sign_in_methods TEXT NOT NULL DEFAULT '["password"]',
  password_group_id INTEGER REFERENCES password_groups(id) ON DELETE SET NULL,
  permissions TEXT NOT NULL DEFAULT '[]',
  data_shared TEXT NOT NULL DEFAULT '[]',
  carrier_pin INTEGER NOT NULL DEFAULT 0,
  last_active TEXT,
  member_since TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_id, target_id, type)
);
CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id);

CREATE TABLE IF NOT EXISTS breaches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  breach_date TEXT,
  data_classes TEXT NOT NULL DEFAULT '[]',
  severity TEXT NOT NULL DEFAULT 'medium',
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_breaches_user ON breaches(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS actions_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fix_key TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  account_id INTEGER,
  score_before INTEGER,
  score_after INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dismissed_fixes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fix_key TEXT NOT NULL,
  PRIMARY KEY (user_id, fix_key)
);

CREATE TABLE IF NOT EXISTS score_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  security_risk REAL,
  privacy_exposure REAL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_snapshots_user ON score_snapshots(user_id, created_at);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(file) {
  const target = file ?? (process.env.EXPOSEX_DB || path.join(DATA_DIR, 'exposex.db'));
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA foreign_keys = ON;');
  if (target !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
