const dns = require("dns").promises;
const net = require("net");
const repository = require("./deviceRepository");
const { config } = require("./config");

class MonitorService {
  constructor() {
    this.running = false;
    this.syncTimer = null;
    this.syncInProgress = false;
    this.jobs = new Map();
  }

  async start() {
    if (this.running) {
      return;
    }

    this.running = true;
    await this.syncDevices();

    this.syncTimer = setInterval(() => {
      this.syncDevices().catch((error) => {
        console.error("Device sync failed:", error.message);
      });
    }, config.syncIntervalSec * 1000);
  }

  async stop() {
    this.running = false;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    for (const job of this.jobs.values()) {
      clearTimeout(job.timeout);
    }

    this.jobs.clear();
  }

  async syncDevices() {
    if (!this.running || this.syncInProgress) {
      return;
    }

    this.syncInProgress = true;

    try {
      const devices = await repository.listActiveDevices();
      const activeById = new Map(devices.map((device) => [device.id, device]));

      for (const device of devices) {
        const existing = this.jobs.get(device.id);
        const changed =
          !existing ||
          existing.target !== device.target ||
          existing.protocol !== device.protocol ||
          existing.port !== device.port ||
          existing.path !== device.path ||
          existing.check_interval_sec !== device.check_interval_sec;

        if (changed) {
          this.scheduleDeviceCheck(device, true);
        }
      }

      for (const [deviceId, job] of this.jobs.entries()) {
        if (!activeById.has(deviceId)) {
          clearTimeout(job.timeout);
          this.jobs.delete(deviceId);
        }
      }
    } finally {
      this.syncInProgress = false;
    }
  }

  scheduleDeviceCheck(device, runNow = false) {
    const existing = this.jobs.get(device.id);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    const execute = async () => {
      if (!this.running) {
        return;
      }

      const latest = await repository.getDeviceById(device.id);
      if (!latest || !latest.is_active) {
        this.jobs.delete(device.id);
        return;
      }

      await this.runCheck(latest.id);

      const nextDelaySec = Math.max(10, latest.check_interval_sec || config.defaultCheckIntervalSec);
      const timeout = setTimeout(() => {
        execute().catch((error) => {
          console.error(`Scheduled check failed for device ${latest.id}:`, error.message);
        });
      }, nextDelaySec * 1000);

      this.jobs.set(device.id, {
        timeout,
        target: latest.target,
        protocol: latest.protocol,
        port: latest.port,
        path: latest.path,
        check_interval_sec: nextDelaySec,
      });
    };

    const initialDelay = runNow ? 0 : Math.max(10, device.check_interval_sec) * 1000;
    const timeout = setTimeout(() => {
      execute().catch((error) => {
        console.error(`Initial check failed for device ${device.id}:`, error.message);
      });
    }, initialDelay);

    this.jobs.set(device.id, {
      timeout,
      target: device.target,
      protocol: device.protocol,
      port: device.port,
      path: device.path,
      check_interval_sec: device.check_interval_sec,
    });
  }

  async runCheck(deviceId) {
    const device = await repository.getDeviceById(deviceId);
    if (!device) {
      return null;
    }

    const result = await this.performCheck(device);
    await repository.insertStatusLog(device.id, result);
    return repository.getDeviceById(device.id);
  }

  async performCheck(device) {
    const startedAt = Date.now();

    try {
      switch (device.protocol) {
        case "http":
        case "https":
          return await this.performHttpCheck(device, startedAt);
        case "dns":
          return await this.performDnsCheck(device, startedAt);
        case "tcp":
        default:
          return await this.performTcpCheck(device, startedAt);
      }
    } catch (error) {
      return {
        isOnline: false,
        latencyMs: null,
        statusCode: null,
        message: String(error.message || "Check failed").slice(0, 250),
      };
    }
  }

  async performHttpCheck(device, startedAt) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    const portSegment = device.port ? `:${device.port}` : "";
    const pathSegment = device.path && device.path.trim() ? device.path.trim() : "/";
    const normalizedPath = pathSegment.startsWith("/") ? pathSegment : `/${pathSegment}`;
    const url = `${device.protocol}://${device.target}${portSegment}${normalizedPath}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
      });

      return {
        isOnline: response.status < 500,
        latencyMs: Date.now() - startedAt,
        statusCode: response.status,
        message: `${response.status} ${response.statusText}`.trim().slice(0, 250),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async performDnsCheck(device, startedAt) {
    const result = await dns.lookup(device.target);
    return {
      isOnline: true,
      latencyMs: Date.now() - startedAt,
      statusCode: null,
      message: `Resolved ${result.address}`.slice(0, 250),
    };
  }

  async performTcpCheck(device, startedAt) {
    const port = device.port || 80;

    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;

      const finish = (payload) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        resolve(payload);
      };

      socket.setTimeout(config.requestTimeoutMs);

      socket.once("connect", () => {
        finish({
          isOnline: true,
          latencyMs: Date.now() - startedAt,
          statusCode: null,
          message: `Connected on port ${port}`,
        });
      });

      socket.once("timeout", () => {
        finish({
          isOnline: false,
          latencyMs: null,
          statusCode: null,
          message: `TCP timeout on port ${port}`,
        });
      });

      socket.once("error", (error) => {
        finish({
          isOnline: false,
          latencyMs: null,
          statusCode: null,
          message: String(error.message || "TCP connection failed").slice(0, 250),
        });
      });

      socket.connect(port, device.target);
    });
  }
}

module.exports = new MonitorService();
