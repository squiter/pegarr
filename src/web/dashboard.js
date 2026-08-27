import { rowsFromInventory, selectRows } from "/assets/dashboard-model.js";

const elements = {
  accessPanel: document.querySelector("#access-panel"),
  accessForm: document.querySelector("#access-form"),
  accessToken: document.querySelector("#access-token"),
  connectButton: document.querySelector("#connect-button"),
  dashboard: document.querySelector("#dashboard"),
  emptyState: document.querySelector("#empty-state"),
  inventoryList: document.querySelector("#inventory-list"),
  kindFilter: document.querySelector("#kind-filter"),
  refreshButton: document.querySelector("#refresh-button"),
  searchInput: document.querySelector("#search-input"),
  sortOrder: document.querySelector("#sort-order"),
  sourceStatus: document.querySelector("#source-status"),
  statusMessage: document.querySelector("#status-message"),
  visibleCount: document.querySelector("#visible-count"),
};

let accessToken;
let inventoryRows = [];

elements.accessForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const candidate = elements.accessToken?.value ?? "";
  if (candidate.length < 32) {
    setStatus("Enter the access token configured for this Pegarr server.", "error");
    return;
  }
  accessToken = candidate;
  elements.accessToken.value = "";
  await loadInventory();
});

elements.refreshButton?.addEventListener("click", loadInventory);
for (const control of [elements.searchInput, elements.kindFilter, elements.sortOrder]) {
  control?.addEventListener("input", renderInventory);
  control?.addEventListener("change", renderInventory);
}

async function loadInventory() {
  if (accessToken === undefined) {
    showAccess("Enter your access token to reconnect.");
    return;
  }
  setBusy(true);
  setStatus("Loading missing items…", "loading");
  try {
    const response = await fetch("/api/v1/library/missing", {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 401) {
      accessToken = undefined;
      showAccess("That token was not accepted. Check the configured secret and try again.");
      return;
    }
    if (response.status === 404) {
      accessToken = undefined;
      showAccess("Private library access is not enabled on this Pegarr server.");
      return;
    }
    if (!response.ok) throw new Error("inventory_unavailable");
    const inventory = await response.json();
    inventoryRows = rowsFromInventory(inventory);
    renderSources(inventory);
    elements.accessPanel.hidden = true;
    elements.dashboard.hidden = false;
    renderInventory();
    setStatus(
      inventory.status === "partial"
        ? "Inventory loaded with one unavailable integration."
        : `Inventory loaded. ${inventoryRows.length} missing items are ready to review.`,
      inventory.status === "partial" ? "warning" : "success",
    );
  } catch {
    setStatus("Pegarr could not load the inventory. Try again when the server is available.", "error");
  } finally {
    setBusy(false);
  }
}

function showAccess(message) {
  elements.dashboard.hidden = true;
  elements.accessPanel.hidden = false;
  setStatus(message, "error");
  elements.accessToken?.focus();
}

function renderInventory() {
  const rows = selectRows(inventoryRows, {
    query: elements.searchInput?.value,
    kind: elements.kindFilter?.value,
    sort: elements.sortOrder?.value,
  });
  elements.inventoryList.replaceChildren(...rows.map(renderItem));
  elements.visibleCount.textContent = String(rows.length);
  elements.emptyState.hidden = rows.length !== 0;
}

function renderItem(row) {
  const item = document.createElement("li");
  item.className = "inventory-card";

  const icon = document.createElement("span");
  icon.className = `kind-icon kind-icon--${row.kind}`;
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = row.kind === "episode" ? "E" : "M";

  const copy = document.createElement("div");
  copy.className = "item-copy";
  const title = document.createElement("h3");
  title.textContent = row.title;
  const context = document.createElement("p");
  context.textContent = row.context;
  copy.append(title, context);

  const metadata = document.createElement("div");
  metadata.className = "item-metadata";
  const application = document.createElement("span");
  application.className = "application-badge";
  application.textContent = row.application === "sonarr" ? "Sonarr" : "Radarr";
  const date = document.createElement("time");
  if (row.availableAt) {
    date.dateTime = row.availableAt;
    date.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(row.availableAt));
  } else {
    date.textContent = "Availability unknown";
  }
  metadata.append(application, date);
  item.append(icon, copy, metadata);
  return item;
}

function renderSources(inventory) {
  const statuses = Array.isArray(inventory?.sources) ? inventory.sources : [];
  const chips = statuses.map((source) => {
    const chip = document.createElement("span");
    const status = typeof source?.status === "string" ? source.status : "unavailable";
    chip.className = `source-chip source-chip--${status}`;
    const name = source?.integration === "sonarr" ? "Sonarr" : source?.integration === "radarr" ? "Radarr" : "Integration";
    chip.textContent = `${name}: ${status.replaceAll("_", " ")}`;
    return chip;
  });
  elements.sourceStatus.replaceChildren(...chips);
}

function setBusy(busy) {
  elements.connectButton.disabled = busy;
  elements.refreshButton.disabled = busy;
  elements.accessToken.disabled = busy;
  elements.dashboard?.setAttribute("aria-busy", String(busy));
}

function setStatus(message, state) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.state = state;
}
