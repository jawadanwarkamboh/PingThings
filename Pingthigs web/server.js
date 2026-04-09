const path = require("path");
const express = require("express");
const { config, supportedDeviceTypes, supportedProtocols } = require("./config");
const repository = require("./deviceRepository");
const monitorService = require("./monitorService");
const { close, resolvedDbPath } = require("./db");

const app = express();

app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), "public")));

function parseId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalText(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function parseBoolean(value) {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  return null;
}

function parsePort(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function parseInterval(value) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 10 || parsed > 3600) {
    return null;
  }
  return parsed;
}

function parseProtocol(value) {
  if (value === undefined) return undefined;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return supportedProtocols.includes(normalized) ? normalized : null;
}

function parseDeviceType(value) {
  if (value === undefined) return undefined;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return supportedDeviceTypes.includes(normalized) ? normalized : null;
}

function serializeHistory(rows) {
  return rows.map((row) => ({
    ...row,
    is_online: Boolean(row.is_online),
  }));
}

app.get("/health", async (req, res) => {
  res.json({
    ok: true,
    service: config.appName,
    timestamp: new Date().toISOString(),
    dbPath: resolvedDbPath,
  });
});

app.get("/api/meta", async (req, res) => {
  res.json({
    protocols: supportedProtocols,
    deviceTypes: supportedDeviceTypes,
    renderNote:
      "Render can monitor internet-reachable targets only. Private LAN hosts are not reachable from the cloud.",
  });
});

app.get("/api/devices", async (req, res, next) => {
  try {
    const devices = await repository.listDevices();
    const summary = {
      total: devices.length,
      active: devices.filter((device) => device.is_active).length,
      online: devices.filter((device) => device.last_status?.is_online).length,
      offline: devices.filter(
        (device) => device.last_status && device.last_status.is_online === false
      ).length,
      paused: devices.filter((device) => !device.is_active).length,
    };

    res.json({ devices, summary });
  } catch (error) {
    next(error);
  }
});

app.get("/api/devices/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid device id" });
      return;
    }

    const device = await repository.getDeviceById(id);
    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    res.json({ device });
  } catch (error) {
    next(error);
  }
});

app.post("/api/devices", async (req, res, next) => {
  try {
    const name = normalizeText(req.body.name);
    const target = normalizeText(req.body.target);
    const deviceType = parseDeviceType(req.body.deviceType);
    const protocol = parseProtocol(req.body.protocol);
    const port = parsePort(req.body.port);
    const pathValue = normalizeOptionalText(req.body.path);
    const checkIntervalSec = parseInterval(req.body.checkIntervalSec);
    const isActive = parseBoolean(req.body.isActive);

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    if (!target) {
      res.status(400).json({ error: "target is required" });
      return;
    }

    if (deviceType === null) {
      res.status(400).json({ error: "Invalid deviceType" });
      return;
    }

    if (protocol === null) {
      res.status(400).json({ error: "Invalid protocol" });
      return;
    }

    if (port === null && req.body.port !== undefined && req.body.port !== "") {
      res.status(400).json({ error: "port must be between 1 and 65535" });
      return;
    }

    if (checkIntervalSec === null) {
      res.status(400).json({ error: "checkIntervalSec must be between 10 and 3600" });
      return;
    }

    if (isActive === null) {
      res.status(400).json({ error: "isActive must be true or false" });
      return;
    }

    const device = await repository.createDevice({
      name,
      target,
      deviceType: deviceType || "other",
      protocol: protocol || "tcp",
      port: port === undefined ? null : port,
      path: pathValue === undefined ? null : pathValue,
      checkIntervalSec: checkIntervalSec || config.defaultCheckIntervalSec,
      isActive: isActive !== undefined ? isActive : true,
    });

    await monitorService.syncDevices();
    res.status(201).json({ device });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/devices/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid device id" });
      return;
    }

    const patch = {};

    if (req.body.name !== undefined) {
      const value = normalizeText(req.body.name);
      if (!value) {
        res.status(400).json({ error: "name must be a non-empty string" });
        return;
      }
      patch.name = value;
    }

    if (req.body.target !== undefined) {
      const value = normalizeText(req.body.target);
      if (!value) {
        res.status(400).json({ error: "target must be a non-empty string" });
        return;
      }
      patch.target = value;
    }

    if (req.body.deviceType !== undefined) {
      const value = parseDeviceType(req.body.deviceType);
      if (!value) {
        res.status(400).json({ error: "Invalid deviceType" });
        return;
      }
      patch.deviceType = value;
    }

    if (req.body.protocol !== undefined) {
      const value = parseProtocol(req.body.protocol);
      if (!value) {
        res.status(400).json({ error: "Invalid protocol" });
        return;
      }
      patch.protocol = value;
    }

    if (req.body.port !== undefined) {
      const value = parsePort(req.body.port);
      if (value === null && req.body.port !== null && req.body.port !== "") {
        res.status(400).json({ error: "port must be between 1 and 65535" });
        return;
      }
      patch.port = value;
    }

    if (req.body.path !== undefined) {
      const value = normalizeOptionalText(req.body.path);
      if (value === null && req.body.path !== null && req.body.path !== "") {
        res.status(400).json({ error: "path must be a string" });
        return;
      }
      patch.path = value;
    }

    if (req.body.checkIntervalSec !== undefined) {
      const value = parseInterval(req.body.checkIntervalSec);
      if (value === null) {
        res.status(400).json({ error: "checkIntervalSec must be between 10 and 3600" });
        return;
      }
      patch.checkIntervalSec = value;
    }

    if (req.body.isActive !== undefined) {
      const value = parseBoolean(req.body.isActive);
      if (value === null) {
        res.status(400).json({ error: "isActive must be true or false" });
        return;
      }
      patch.isActive = value;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "No valid fields provided" });
      return;
    }

    const device = await repository.updateDevice(id, patch);
    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    await monitorService.syncDevices();
    res.json({ device });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/devices/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid device id" });
      return;
    }

    const deleted = await repository.deleteDevice(id);
    if (!deleted) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    await monitorService.syncDevices();
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/devices/:id/history", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid device id" });
      return;
    }

    const device = await repository.getDeviceById(id);
    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    const requestedLimit = Number(req.query.limit);
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, config.maxHistoryLimit)
        : 50;

    const history = await repository.getHistory(id, limit);
    res.json({ device, history: serializeHistory(history) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/devices/:id/check", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid device id" });
      return;
    }

    const updated = await monitorService.runCheck(id);
    if (!updated) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    res.json({ device: updated });
  } catch (error) {
    next(error);
  }
});

app.get("/{*rest}", (req, res) => {
  res.sendFile(path.resolve(process.cwd(), "public", "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(config.port, async () => {
  console.log(`${config.appName} running on http://localhost:${config.port}`);
  try {
    await monitorService.start();
    console.log("Monitor service started");
  } catch (error) {
    console.error("Monitor service failed to start:", error.message);
  }
});

async function shutdown() {
  await monitorService.stop();
  server.close(async () => {
    await close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
