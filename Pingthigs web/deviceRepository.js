const { all, get, run } = require("./db");

function mapDevice(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    target: row.target,
    device_type: row.device_type,
    protocol: row.protocol,
    port: row.port,
    path: row.path,
    check_interval_sec: row.check_interval_sec,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_status: row.last_checked_at
      ? {
          is_online: Boolean(row.last_is_online),
          latency_ms: row.last_latency_ms,
          status_code: row.last_status_code,
          message: row.last_message,
          checked_at: row.last_checked_at,
        }
      : null,
  };
}

const latestStatusJoin = `
  LEFT JOIN status_logs s
    ON s.id = (
      SELECT sl.id
      FROM status_logs sl
      WHERE sl.device_id = d.id
      ORDER BY sl.checked_at DESC, sl.id DESC
      LIMIT 1
    )
`;

async function listDevices() {
  const rows = await all(
    `
      SELECT
        d.*,
        s.is_online AS last_is_online,
        s.latency_ms AS last_latency_ms,
        s.status_code AS last_status_code,
        s.message AS last_message,
        s.checked_at AS last_checked_at
      FROM devices d
      ${latestStatusJoin}
      ORDER BY d.created_at DESC, d.id DESC
    `
  );

  return rows.map(mapDevice);
}

async function getDeviceById(id) {
  const row = await get(
    `
      SELECT
        d.*,
        s.is_online AS last_is_online,
        s.latency_ms AS last_latency_ms,
        s.status_code AS last_status_code,
        s.message AS last_message,
        s.checked_at AS last_checked_at
      FROM devices d
      ${latestStatusJoin}
      WHERE d.id = ?
      LIMIT 1
    `,
    [id]
  );

  return mapDevice(row);
}

async function listActiveDevices() {
  return all(
    `
      SELECT id, name, target, device_type, protocol, port, path, check_interval_sec, is_active
      FROM devices
      WHERE is_active = 1
      ORDER BY id ASC
    `
  );
}

async function createDevice(device) {
  const result = await run(
    `
      INSERT INTO devices (
        name,
        target,
        device_type,
        protocol,
        port,
        path,
        check_interval_sec,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      device.name,
      device.target,
      device.deviceType,
      device.protocol,
      device.port,
      device.path,
      device.checkIntervalSec,
      device.isActive ? 1 : 0,
    ]
  );

  return getDeviceById(result.lastID);
}

async function updateDevice(id, patch) {
  const fields = [];
  const values = [];

  const mappings = [
    ["name", "name"],
    ["target", "target"],
    ["deviceType", "device_type"],
    ["protocol", "protocol"],
    ["port", "port"],
    ["path", "path"],
    ["checkIntervalSec", "check_interval_sec"],
    ["isActive", "is_active"],
  ];

  for (const [inputKey, column] of mappings) {
    if (!Object.prototype.hasOwnProperty.call(patch, inputKey)) {
      continue;
    }

    fields.push(`${column} = ?`);
    values.push(inputKey === "isActive" ? (patch[inputKey] ? 1 : 0) : patch[inputKey]);
  }

  if (fields.length === 0) {
    return getDeviceById(id);
  }

  fields.push("updated_at = CURRENT_TIMESTAMP");

  const result = await run(
    `
      UPDATE devices
      SET ${fields.join(", ")}
      WHERE id = ?
    `,
    [...values, id]
  );

  if (result.changes === 0) {
    return null;
  }

  return getDeviceById(id);
}

async function deleteDevice(id) {
  const result = await run("DELETE FROM devices WHERE id = ?", [id]);
  return result.changes > 0;
}

async function insertStatusLog(deviceId, status) {
  await run(
    `
      INSERT INTO status_logs (device_id, is_online, latency_ms, status_code, message)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      deviceId,
      status.isOnline ? 1 : 0,
      status.latencyMs ?? null,
      status.statusCode ?? null,
      status.message ?? null,
    ]
  );
}

async function getHistory(deviceId, limit) {
  return all(
    `
      SELECT id, device_id, is_online, latency_ms, status_code, message, checked_at
      FROM status_logs
      WHERE device_id = ?
      ORDER BY checked_at DESC, id DESC
      LIMIT ?
    `,
    [deviceId, limit]
  );
}

module.exports = {
  listDevices,
  getDeviceById,
  listActiveDevices,
  createDevice,
  updateDevice,
  deleteDevice,
  insertStatusLog,
  getHistory,
};
