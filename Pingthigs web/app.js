const state = {
  devices: [],
  summary: {
    total: 0,
    active: 0,
    online: 0,
    offline: 0,
    paused: 0,
  },
  meta: {
    protocols: [],
    deviceTypes: [],
  },
  filter: "all",
  search: "",
  editingDevice: null,
};

const summaryCards = document.querySelector("#summaryCards");
const filterChips = document.querySelector("#filterChips");
const deviceGrid = document.querySelector("#deviceGrid");
const emptyState = document.querySelector("#emptyState");
const historyPanel = document.querySelector("#historyPanel");
const historyTitle = document.querySelector("#historyTitle");
const historyList = document.querySelector("#historyList");
const deviceDialog = document.querySelector("#deviceDialog");
const deviceForm = document.querySelector("#deviceForm");
const dialogTitle = document.querySelector("#dialogTitle");
const searchInput = document.querySelector("#searchInput");
const deviceCardTemplate = document.querySelector("#deviceCardTemplate");
const protocolSelect = document.querySelector("#protocolSelect");
const deviceTypeSelect = document.querySelector("#deviceTypeSelect");
const formField = (name) => deviceForm.elements.namedItem(name);

function titleCase(value) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = "Request failed";
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch (error) {
      void error;
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function relativeTime(value) {
  if (!value) {
    return "Never";
  }

  const diffMs = Date.now() - new Date(value).getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day ago`;
}

function buildEndpoint(device) {
  const protocol = device.protocol.toUpperCase();
  const port = device.port ? `:${device.port}` : "";
  const path = device.path ? device.path : "";
  return `${protocol} ${device.target}${port}${path}`;
}

function deriveStatus(device) {
  if (!device.is_active) {
    return { label: "Paused", className: "paused" };
  }

  if (!device.last_status) {
    return { label: "Unknown", className: "unknown" };
  }

  if (device.last_status.is_online) {
    return { label: "Online", className: "online" };
  }

  return { label: "Offline", className: "offline" };
}

function getVisibleDevices() {
  const search = state.search.trim().toLowerCase();

  return state.devices.filter((device) => {
    const matchesFilter = state.filter === "all" || device.device_type === state.filter;
    const haystack = `${device.name} ${device.target} ${device.protocol}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    return matchesFilter && matchesSearch;
  });
}

function renderSummary() {
  const cards = [
    ["Total", state.summary.total],
    ["Online", state.summary.online],
    ["Offline", state.summary.offline],
    ["Paused", state.summary.paused],
  ];

  summaryCards.innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="summary-card">
          <div class="summary-label">${label}</div>
          <div class="summary-value">${value}</div>
        </div>
      `
    )
    .join("");
}

function renderFilters() {
  const filters = ["all", ...state.meta.deviceTypes];
  filterChips.innerHTML = "";

  for (const filter of filters) {
    const button = document.createElement("button");
    button.className = `filter-chip ${state.filter === filter ? "active" : ""}`;
    button.textContent = filter === "all" ? "All Devices" : titleCase(filter);
    button.addEventListener("click", () => {
      state.filter = filter;
      render();
    });
    filterChips.appendChild(button);
  }
}

function renderDevices() {
  const devices = getVisibleDevices();
  deviceGrid.innerHTML = "";
  emptyState.classList.toggle("hidden", state.devices.length !== 0);

  for (const device of devices) {
    const fragment = deviceCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".device-card");
    const typeBadge = fragment.querySelector(".device-type-badge");
    const name = fragment.querySelector(".device-name");
    const statusPill = fragment.querySelector(".status-pill");
    const meta = fragment.querySelector(".device-meta");
    const latency = fragment.querySelector(".latency-value");
    const lastCheck = fragment.querySelector(".last-check-value");
    const message = fragment.querySelector(".status-message");
    const historyButton = fragment.querySelector(".history-button");
    const checkButton = fragment.querySelector(".check-button");
    const editButton = fragment.querySelector(".edit-button");
    const deleteButton = fragment.querySelector(".delete-button");

    const status = deriveStatus(device);
    typeBadge.textContent = titleCase(device.device_type);
    name.textContent = device.name;
    statusPill.textContent = status.label;
    statusPill.classList.add(status.className);
    meta.textContent = buildEndpoint(device);
    latency.textContent = device.last_status?.latency_ms
      ? `${Math.round(device.last_status.latency_ms)} ms`
      : "-";
    lastCheck.textContent = relativeTime(device.last_status?.checked_at);
    message.textContent = device.last_status?.message || "No checks have run yet.";

    historyButton.addEventListener("click", () => loadHistory(device));
    checkButton.addEventListener("click", () => checkNow(device.id));
    editButton.addEventListener("click", () => openDialog(device));
    deleteButton.addEventListener("click", () => removeDevice(device));

    card.animate(
      [
        { opacity: 0, transform: "translateY(12px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 240, easing: "ease-out" }
    );

    deviceGrid.appendChild(fragment);
  }
}

function render() {
  renderSummary();
  renderFilters();
  renderDevices();
}

async function loadMeta() {
  const payload = await api("/api/meta");
  state.meta = payload;

  protocolSelect.innerHTML = state.meta.protocols
    .map((item) => `<option value="${item}">${item.toUpperCase()}</option>`)
    .join("");

  deviceTypeSelect.innerHTML = state.meta.deviceTypes
    .map((item) => `<option value="${item}">${titleCase(item)}</option>`)
    .join("");
}

async function loadDevices() {
  const payload = await api("/api/devices");
  state.devices = payload.devices;
  state.summary = payload.summary;
  render();
}

function openDialog(device = null) {
  state.editingDevice = device;
  dialogTitle.textContent = device ? "Edit Device" : "Add Device";

  formField("name").value = device?.name || "";
  formField("target").value = device?.target || "";
  formField("deviceType").value = device?.device_type || "other";
  formField("protocol").value = device?.protocol || "tcp";
  formField("port").value = device?.port || "";
  formField("path").value = device?.path || "";
  formField("checkIntervalSec").value = device?.check_interval_sec || 60;
  formField("isActive").checked = device ? device.is_active : true;

  deviceDialog.showModal();
}

function closeDialog() {
  deviceDialog.close();
  state.editingDevice = null;
}

async function submitForm(event) {
  event.preventDefault();

  const payload = {
    name: formField("name").value.trim(),
    target: formField("target").value.trim(),
    deviceType: formField("deviceType").value,
    protocol: formField("protocol").value,
    port: formField("port").value ? Number(formField("port").value) : null,
    path: formField("path").value.trim() || null,
    checkIntervalSec: Number(formField("checkIntervalSec").value),
    isActive: formField("isActive").checked,
  };

  try {
    if (state.editingDevice) {
      await api(`/api/devices/${state.editingDevice.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/devices", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    closeDialog();
    await loadDevices();
  } catch (error) {
    alert(error.message);
  }
}

async function loadHistory(device) {
  historyTitle.textContent = `${device.name} History`;
  historyList.innerHTML = "<p class=\"history-item-meta\">Loading...</p>";
  historyPanel.classList.remove("hidden");

  try {
    const payload = await api(`/api/devices/${device.id}/history?limit=30`);
    historyList.innerHTML = "";

    if (!payload.history.length) {
      historyList.innerHTML =
        "<div class=\"history-item\"><div class=\"history-item-meta\">No history yet.</div></div>";
      return;
    }

    for (const entry of payload.history) {
      const item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML = `
        <div class="history-item-top">
          <strong>${entry.is_online ? "Online" : "Offline"}</strong>
          <span>${new Date(entry.checked_at).toLocaleString()}</span>
        </div>
        <p class="history-item-meta">
          ${entry.latency_ms ? `${Math.round(entry.latency_ms)} ms` : "No latency"}
          ${entry.status_code ? ` • HTTP ${entry.status_code}` : ""}
        </p>
        <p class="history-item-meta">${entry.message || "No message"}</p>
      `;
      historyList.appendChild(item);
    }
  } catch (error) {
    historyList.innerHTML = `<div class="history-item">${error.message}</div>`;
  }
}

async function checkNow(id) {
  try {
    await api(`/api/devices/${id}/check`, {
      method: "POST",
    });
    await loadDevices();
  } catch (error) {
    alert(error.message);
  }
}

async function removeDevice(device) {
  const confirmed = window.confirm(`Delete "${device.name}"?`);
  if (!confirmed) {
    return;
  }

  try {
    await api(`/api/devices/${device.id}`, {
      method: "DELETE",
    });
    await loadDevices();
  } catch (error) {
    alert(error.message);
  }
}

document.querySelector("#addButton").addEventListener("click", () => openDialog());
document.querySelector("#cancelButton").addEventListener("click", closeDialog);
document.querySelector("#closeHistoryButton").addEventListener("click", () => {
  historyPanel.classList.add("hidden");
});
deviceDialog.addEventListener("close", () => {
  state.editingDevice = null;
});
deviceForm.addEventListener("submit", submitForm);
searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderDevices();
});

async function init() {
  try {
    await loadMeta();
    await loadDevices();
    setInterval(() => {
      loadDevices().catch(() => {});
    }, 15000);
  } catch (error) {
    alert(`Failed to load app: ${error.message}`);
  }
}

init();
