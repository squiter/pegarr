import { feasibilityView, itemAnalysisSummary, rowsFromInventory, rowsWithAnalysis, selectReleases, selectRows } from "/assets/dashboard-model.js";

const elements = {
  accessPanel: document.querySelector("#access-panel"),
  accessForm: document.querySelector("#access-form"),
  accessToken: document.querySelector("#access-token"),
  analysisFilter: document.querySelector("#analysis-filter"),
  bestConfidenceFilter: document.querySelector("#best-confidence-filter"),
  connectButton: document.querySelector("#connect-button"),
  dashboard: document.querySelector("#dashboard"),
  emptyState: document.querySelector("#empty-state"),
  feasibilityClose: document.querySelector("#feasibility-close"),
  feasibilityContext: document.querySelector("#feasibility-context"),
  feasibilityNotice: document.querySelector("#feasibility-notice"),
  feasibilityPanel: document.querySelector("#feasibility-panel"),
  feasibilityRefresh: document.querySelector("#feasibility-refresh"),
  feasibilitySummary: document.querySelector("#feasibility-summary"),
  feasibilityTitle: document.querySelector("#feasibility-title"),
  inventoryList: document.querySelector("#inventory-list"),
  kindFilter: document.querySelector("#kind-filter"),
  providerEvidenceFilter: document.querySelector("#provider-evidence-filter"),
  refreshButton: document.querySelector("#refresh-button"),
  releaseConfidenceFilter: document.querySelector("#release-confidence-filter"),
  releaseControls: document.querySelector("#release-controls"),
  releaseDecisionFilter: document.querySelector("#release-decision-filter"),
  releaseSortOrder: document.querySelector("#release-sort-order"),
  releaseTableBody: document.querySelector("#release-table-body"),
  releaseTableWrap: document.querySelector("#release-table-wrap"),
  releaseVisibleCount: document.querySelector("#release-visible-count"),
  requiredCoverageFilter: document.querySelector("#required-coverage-filter"),
  searchInput: document.querySelector("#search-input"),
  sortOrder: document.querySelector("#sort-order"),
  sourceStatus: document.querySelector("#source-status"),
  statusMessage: document.querySelector("#status-message"),
  visibleCount: document.querySelector("#visible-count"),
  visibleLabel: document.querySelector("#visible-label"),
};

let accessToken;
let inventoryRows = [];
let selectedRow;
let activeFeasibility;
let pageBusy = false;
const feasibilityCache = new Map();
const analysisByItem = new Map();

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
elements.feasibilityRefresh?.addEventListener("click", () => selectedRow && loadFeasibility(selectedRow, true));
elements.feasibilityClose?.addEventListener("click", closeFeasibility);
for (const control of [elements.searchInput, elements.kindFilter, elements.analysisFilter, elements.bestConfidenceFilter, elements.requiredCoverageFilter, elements.providerEvidenceFilter, elements.sortOrder]) {
  control?.addEventListener("input", renderInventory);
  control?.addEventListener("change", renderInventory);
}
for (const control of [elements.releaseDecisionFilter, elements.releaseConfidenceFilter, elements.releaseSortOrder]) {
  control?.addEventListener("change", renderReleaseSelection);
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
      clearPageEvidence();
      showAccess("That token was not accepted. Check the configured secret and try again.");
      return;
    }
    if (response.status === 404) {
      accessToken = undefined;
      clearPageEvidence();
      showAccess("Private library access is not enabled on this Pegarr server.");
      return;
    }
    if (!response.ok) throw new Error("inventory_unavailable");
    const inventory = await response.json();
    inventoryRows = rowsFromInventory(inventory);
    feasibilityCache.clear();
    pruneAnalysisMemory();
    if (selectedRow !== undefined && !inventoryRows.some(({ key }) => key === selectedRow.key)) closeFeasibility();
    renderSources(inventory);
    elements.accessPanel.hidden = true;
    elements.dashboard.hidden = false;
    renderInventory();
    setStatus(
      inventory.status === "partial"
        ? "Inventory loaded with one unavailable integration."
        : inventoryRows.length === 1
          ? "Inventory loaded. 1 missing item is ready to review."
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
  const rows = selectRows(rowsWithAnalysis(inventoryRows, analysisByItem), {
    query: elements.searchInput?.value,
    kind: elements.kindFilter?.value,
    analysis: elements.analysisFilter?.value,
    confidence: elements.bestConfidenceFilter?.value,
    requiredCoverage: elements.requiredCoverageFilter?.value,
    providerEvidence: elements.providerEvidenceFilter?.value,
    sort: elements.sortOrder?.value,
  });
  elements.inventoryList.replaceChildren(...rows.map(renderItem));
  elements.visibleCount.textContent = String(rows.length);
  elements.visibleLabel.textContent = rows.length === 1 ? "item" : "items";
  elements.emptyState.hidden = rows.length !== 0;
}

function renderItem(row) {
  const item = document.createElement("li");
  item.className = "inventory-card";

  const select = document.createElement("button");
  select.className = "inventory-select";
  select.type = "button";
  select.disabled = pageBusy;
  select.setAttribute("aria-label", `Investigate ${row.title}, ${row.context}`);
  select.addEventListener("click", () => loadFeasibility(row));

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
  if (row.analysis !== undefined) copy.append(renderItemAnalysis(row.analysis));

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
  select.append(icon, copy, metadata);
  item.append(select);
  return item;
}

function renderItemAnalysis(summary) {
  const analysis = document.createElement("div");
  analysis.className = "item-analysis";
  const badge = document.createElement("span");
  const badgeState = summary.state === "ready" ? summary.bestConfidence : summary.state;
  badge.className = `item-analysis-badge item-analysis-badge--${badgeState}`;
  badge.textContent = analysisBadgeLabel(summary);
  const coverageBadge = document.createElement("span");
  coverageBadge.className = `item-analysis-badge item-analysis-badge--coverage-${summary.requiredCoverage}`;
  coverageBadge.textContent = requiredCoverageLabel(summary.requiredCoverage);
  const providerBadge = document.createElement("span");
  providerBadge.className = `item-analysis-badge item-analysis-badge--provider-${summary.providerEvidence}`;
  providerBadge.textContent = providerEvidenceLabel(summary.providerEvidence);
  const detail = document.createElement("span");
  detail.className = "item-analysis-detail";
  if (summary.state === "ready" || summary.state === "stale") {
    const requiredLanguages = (summary.requiredLanguages ?? []).map(({ code, confidence }) => `${code} ${confidenceLabel(confidence)}`).join(", ");
    const providerCount = summary.providerResultCount === 0
      ? "No provider search result"
      : `${summary.availableProviderResultCount} of ${summary.providerResultCount} provider searches available`;
    const providerFailures = (summary.providerFailures ?? []).length > 0
      ? `Issues: ${summary.providerFailures.map(confidenceLabel).join(", ")}`
      : "";
    detail.textContent = [summary.policyName, requiredLanguages, providerCount, providerFailures, `${summary.acceptedCount} of ${summary.releaseCount} releases accepted by Arr`].filter(Boolean).join(" · ");
  } else {
    detail.textContent = summary.message ?? "The analysis needs attention before Pegarr can compare releases.";
  }
  analysis.append(badge);
  if (summary.state === "ready" || summary.state === "stale") analysis.append(coverageBadge, providerBadge);
  analysis.append(detail);
  if (summary.generatedAt) {
    const generated = document.createElement("time");
    generated.dateTime = summary.generatedAt;
    generated.textContent = `Analyzed ${formatDateTime(summary.generatedAt)}`;
    analysis.append(generated);
  }
  return analysis;
}

function requiredCoverageLabel(value) {
  const labels = {
    strong: "Required coverage strong",
    possible: "Required coverage possible",
    no_match_found: "Required no match",
    unknown: "Required coverage unknown",
    no_accepted_release: "Required coverage unavailable",
    no_required_languages: "No required languages",
  };
  return labels[value] ?? "Required coverage unknown";
}

function providerEvidenceLabel(value) {
  const labels = {
    available: "Providers available",
    partial: "Provider evidence partial",
    unavailable: "Providers unavailable",
    unknown: "Provider evidence unknown",
  };
  return labels[value] ?? "Provider evidence unknown";
}

function analysisBadgeLabel(summary) {
  if (summary.state === "stale") return `Stale · ${confidenceLabel(summary.bestConfidence)}`;
  if (summary.state === "ready") return summary.bestConfidence === "none"
    ? "No accepted release"
    : `Best ${confidenceLabel(summary.bestConfidence)}`;
  const labels = {
    disabled: "Analysis disabled",
    policy_unresolved: "Policy unresolved",
    inventory_unavailable: "Inventory unavailable",
    integration_failure: "Analysis unavailable",
    not_found: "Item no longer missing",
    invalid: "Analysis unreadable",
  };
  return labels[summary.state] ?? "Analysis needs attention";
}

function confidenceLabel(value) {
  return value === "none" ? "no accepted release" : value.replaceAll("_", " ");
}

async function loadFeasibility(row, refresh = false) {
  const changedItem = selectedRow?.key !== row.key;
  selectedRow = row;
  activeFeasibility = undefined;
  if (changedItem) resetReleaseControls();
  elements.feasibilityPanel.hidden = false;
  elements.feasibilityTitle.textContent = row.title;
  elements.feasibilityContext.textContent = row.context;
  elements.feasibilitySummary.replaceChildren();
  elements.releaseTableBody.replaceChildren();
  elements.releaseTableWrap.hidden = true;
  elements.releaseControls.hidden = true;
  const cached = refresh ? undefined : feasibilityCache.get(row.key);
  if (cached !== undefined) {
    rememberAnalysis(row.key, cached);
    renderFeasibility(cached);
    elements.feasibilityTitle.focus();
    return;
  }
  setFeasibilityNotice("Searching releases, resolving Bazarr policy, and checking subtitle evidence…", "loading");
  setBusy(true);
  try {
    const endpoint = `/api/v1/library/items/${row.application}/${row.kind}/${row.itemId}/feasibility${refresh ? "?refresh=1" : ""}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 401) {
      accessToken = undefined;
      clearPageEvidence();
      showAccess("That token was not accepted. Check the configured secret and try again.");
      return;
    }
    const result = feasibilityView(await response.json());
    if (response.status >= 500 && result.state === "invalid") throw new Error("feasibility_unavailable");
    if (result.state === "ready") feasibilityCache.set(row.key, result);
    rememberAnalysis(row.key, result);
    renderFeasibility(result);
    elements.feasibilityTitle.focus();
  } catch {
    setFeasibilityNotice("Pegarr could not complete this analysis. Subtitle availability remains Unknown.", "error");
  } finally {
    setBusy(false);
  }
}

function renderFeasibility(view) {
  if (view.state !== "ready") {
    activeFeasibility = undefined;
    elements.feasibilitySummary.replaceChildren();
    elements.releaseControls.hidden = true;
    elements.releaseTableWrap.hidden = true;
    setFeasibilityNotice(view.message, view.state === "policy_unresolved" ? "warning" : "error");
    return;
  }
  const policy = document.createElement("div");
  policy.className = "policy-summary";
  const policyLabel = document.createElement("strong");
  policyLabel.textContent = view.policyName;
  const languages = document.createElement("span");
  languages.textContent = view.languages.length === 0
    ? "No policy languages"
    : view.languages.map(({ code, required }) => `${code}${required ? " required" : ""}`).join(" · ");
  policy.append(policyLabel, languages);

  const analysis = document.createElement("div");
  analysis.className = `analysis-summary${view.analysis.source === "stale_cache" ? " analysis-summary--stale" : ""}`;
  const analysisSource = document.createElement("strong");
  analysisSource.textContent = view.analysis.source === "stale_cache"
    ? "Stale cached analysis"
    : view.analysis.source === "memory_cache"
      ? "Pegarr item cache"
      : "Fresh Arr/Bazarr analysis";
  const analysisTiming = document.createElement("span");
  analysisTiming.textContent = `${view.analysis.elapsedMs} ms · ${view.analysis.arrRequests} Arr · ${view.analysis.bazarrRequests} Bazarr · ${view.analysis.providerRequests} provider ${view.analysis.providerRequests === 1 ? "request" : "requests"}`;
  analysis.append(analysisSource, analysisTiming);
  if (view.analysis.generatedAt) {
    const generated = document.createElement("time");
    generated.dateTime = view.analysis.generatedAt;
    generated.textContent = `Generated ${formatDateTime(view.analysis.generatedAt)}`;
    analysis.append(generated);
  }
  if (view.analysis.source === "stale_cache" && view.analysis.staleUntil) {
    const staleUntil = document.createElement("time");
    staleUntil.dateTime = view.analysis.staleUntil;
    staleUntil.textContent = `Stale fallback expires ${formatDateTime(view.analysis.staleUntil)}`;
    analysis.append(staleUntil);
  }

  const providers = document.createElement("div");
  providers.className = "provider-summary";
  providers.replaceChildren(...view.providers.map((provider) => {
    const card = document.createElement("div");
    card.className = "provider-card";
    const chip = document.createElement("span");
    chip.className = `provider-chip provider-chip--${provider.status}`;
    chip.textContent = `${provider.provider}: ${provider.status.replaceAll("_", " ")}`;
    if (provider.detail) chip.title = provider.detail;
    card.append(chip);
    if (provider.cacheStatus) {
      const cache = document.createElement("span");
      cache.textContent = `Provider cache ${provider.cacheStatus}${provider.cachedAt ? ` · stored ${formatDateTime(provider.cachedAt)}` : ""}`;
      card.append(cache);
    }
    if (provider.quota.remaining !== undefined || provider.quota.limit !== undefined) {
      const quota = document.createElement("span");
      quota.textContent = provider.quota.remaining !== undefined && provider.quota.limit !== undefined
        ? `${provider.quota.remaining.toLocaleString()} of ${provider.quota.limit.toLocaleString()} provider requests remaining`
        : `${(provider.quota.remaining ?? provider.quota.limit)?.toLocaleString()} provider requests ${provider.quota.remaining !== undefined ? "remaining" : "in quota"}`;
      card.append(quota);
    }
    if (provider.quota.resetAtEpochSeconds !== undefined) {
      const reset = document.createElement("time");
      reset.dateTime = new Date(provider.quota.resetAtEpochSeconds * 1_000).toISOString();
      reset.textContent = `Quota resets ${formatDateTime(reset.dateTime)}`;
      card.append(reset);
    }
    return card;
  }));
  elements.feasibilitySummary.replaceChildren(policy, analysis, providers);
  activeFeasibility = view;
  elements.releaseControls.hidden = view.releases.length === 0;
  renderReleaseSelection();
}

function renderReleaseSelection() {
  const view = activeFeasibility;
  if (view === undefined) return;
  const releases = selectReleases(view.releases, {
    decision: elements.releaseDecisionFilter?.value,
    confidence: elements.releaseConfidenceFilter?.value,
    sort: elements.releaseSortOrder?.value,
  });
  elements.releaseTableBody.replaceChildren(...releases.map(renderRelease));
  elements.releaseTableWrap.hidden = releases.length === 0;
  elements.releaseVisibleCount.textContent = `${releases.length} of ${view.releases.length} ${view.releases.length === 1 ? "release" : "releases"} shown`;
  const stale = view.analysis.source === "stale_cache";
  const unavailable = view.analysis.unavailableIntegrations.length > 0
    ? view.analysis.unavailableIntegrations.map(capitalize).join(" and ")
    : "an integration";
  setFeasibilityNotice(
    stale
      ? releases.length === 0
        ? `No cached release candidates match these local filters. ${unavailable} could not refresh, so the underlying evidence is not current.`
        : `${releases.length}${releases.length === view.releases.length ? "" : ` of ${view.releases.length}`} cached release ${releases.length === 1 ? "candidate" : "candidates"} shown because ${unavailable} could not refresh. This evidence is not current.`
      : view.releases.length === 0
      ? "The Arr search returned no release candidates."
      : releases.length === 0
        ? `No release candidates match these local filters. ${view.releases.length} ${view.releases.length === 1 ? "candidate remains" : "candidates remain"} in the analysis.`
        : releases.length === view.releases.length
          ? `${releases.length} release ${releases.length === 1 ? "candidate" : "candidates"} evaluated. Video and subtitle decisions remain separate.`
          : `${releases.length} of ${view.releases.length} release candidates shown. These filters are local and make no new provider requests.`,
    stale || view.releases.length === 0 || releases.length === 0 ? "warning" : "success",
  );
}

function renderRelease(row) {
  const tableRow = document.createElement("tr");
  const release = document.createElement("td");
  release.dataset.label = "Video release";
  const title = document.createElement("strong");
  title.textContent = row.title;
  const metadata = document.createElement("span");
  metadata.textContent = `${row.quality} · ${row.indexer} · ${row.protocol}`;
  release.append(title, metadata);

  const video = document.createElement("td");
  video.dataset.label = "Arr decision";
  const decision = document.createElement("span");
  decision.className = `decision-badge decision-badge--${row.downloadAllowed ? "accepted" : "rejected"}`;
  decision.textContent = row.downloadAllowed ? "Accepted" : "Rejected by Arr";
  const score = document.createElement("span");
  score.textContent = `Custom format ${row.customFormatScore}`;
  video.append(decision, score);
  for (const reason of row.rejectionReasons) {
    const rejection = document.createElement("span");
    rejection.className = "rejection-reason";
    rejection.textContent = reason;
    video.append(rejection);
  }

  const subtitle = document.createElement("td");
  subtitle.dataset.label = "Subtitle confidence";
  const confidence = document.createElement("span");
  confidence.className = `confidence-badge confidence-badge--${row.confidence}`;
  confidence.textContent = row.confidence.replaceAll("_", " ");
  subtitle.append(confidence);
  for (const language of row.languages) {
    const languageStatus = document.createElement("span");
    languageStatus.textContent = `${language.language}: ${language.confidence.replaceAll("_", " ")} · ${language.providerCount} ${language.providerCount === 1 ? "provider" : "providers"}`;
    subtitle.append(languageStatus);
  }

  const evidenceCell = document.createElement("td");
  evidenceCell.dataset.label = "Evidence";
  const evidence = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Why this confidence?";
  evidence.append(summary);
  const evidenceList = document.createElement("ul");
  const messages = row.languages.flatMap((language) => [
    ...(language.evidence?.reasons ?? []),
    ...language.warnings,
    ...(language.evidence ? [`${language.evidence.provider}: ${language.evidence.releaseName}`] : []),
  ]);
  for (const message of messages.length > 0 ? messages : ["No release-specific subtitle evidence was available."]) {
    const reason = document.createElement("li");
    reason.textContent = message;
    evidenceList.append(reason);
  }
  evidence.append(evidenceList);
  evidenceCell.append(evidence);
  tableRow.append(release, video, subtitle, evidenceCell);
  return tableRow;
}

function rememberAnalysis(key, view) {
  analysisByItem.set(key, itemAnalysisSummary(view));
  renderInventory();
}

function pruneAnalysisMemory() {
  const currentKeys = new Set(inventoryRows.map(({ key }) => key));
  for (const key of analysisByItem.keys()) {
    if (!currentKeys.has(key)) analysisByItem.delete(key);
  }
}

function clearPageEvidence() {
  inventoryRows = [];
  feasibilityCache.clear();
  analysisByItem.clear();
  closeFeasibility();
  renderInventory();
}

function closeFeasibility() {
  selectedRow = undefined;
  activeFeasibility = undefined;
  elements.feasibilityPanel.hidden = true;
  elements.releaseTableBody.replaceChildren();
  elements.releaseControls.hidden = true;
  elements.feasibilitySummary.replaceChildren();
}

function resetReleaseControls() {
  elements.releaseDecisionFilter.value = "all";
  elements.releaseConfidenceFilter.value = "all";
  elements.releaseSortOrder.value = "recommended";
}

function setFeasibilityNotice(message, state) {
  elements.feasibilityNotice.textContent = message;
  elements.feasibilityNotice.dataset.state = state;
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

function setBusy(value) {
  pageBusy = value;
  elements.connectButton.disabled = value;
  elements.refreshButton.disabled = value;
  elements.accessToken.disabled = value;
  elements.dashboard?.setAttribute("aria-busy", String(value));
  elements.feasibilityPanel?.setAttribute("aria-busy", String(value));
  for (const button of document.querySelectorAll(".inventory-select")) button.disabled = value;
  elements.feasibilityRefresh.disabled = value;
}

function setStatus(message, state) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.state = state;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Integration";
}
