const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const defaultDbPath = process.env.RENDER
  ? "/var/data/monitor.db"
  : path.resolve(process.cwd(), "data", "monitor.db");

const config = {
  appName: "PingThings Web",
  port: toNumber(process.env.PORT, 4000),
  dbPath: process.env.DB_PATH || defaultDbPath,
  defaultCheckIntervalSec: clamp(toNumber(process.env.DEFAULT_CHECK_INTERVAL_SEC, 60), 10, 3600),
  requestTimeoutMs: clamp(toNumber(process.env.REQUEST_TIMEOUT_MS, 5000), 1000, 30000),
  syncIntervalSec: clamp(toNumber(process.env.SYNC_INTERVAL_SEC, 15), 10, 300),
  maxHistoryLimit: clamp(toNumber(process.env.MAX_HISTORY_LIMIT, 200), 10, 1000),
};

const supportedProtocols = ["http", "https", "tcp", "dns"];
const supportedDeviceTypes = [
  "router",
  "switch",
  "server",
  "access_point",
  "station",
  "other",
];

module.exports = {
  config,
  supportedProtocols,
  supportedDeviceTypes,
};
