const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { config } = require("./config");

const resolvedDbPath = path.isAbsolute(config.dbPath)
  ? config.dbPath
  : path.resolve(process.cwd(), config.dbPath);

fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

const db = new sqlite3.Database(resolvedDbPath);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target TEXT NOT NULL,
      device_type TEXT NOT NULL DEFAULT 'other',
      protocol TEXT NOT NULL DEFAULT 'tcp',
      port INTEGER,
      path TEXT,
      check_interval_sec INTEGER NOT NULL DEFAULT 60,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS status_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      is_online INTEGER NOT NULL,
      latency_ms REAL,
      status_code INTEGER,
      message TEXT,
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_status_logs_device_checked
    ON status_logs (device_id, checked_at DESC)
  `);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

function close() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

module.exports = { db, run, get, all, close, resolvedDbPath };
