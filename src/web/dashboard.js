import { activeInventoryFilterCount, feasibilityView, itemAnalysisSummary, leadingRelease, releaseComparison, rowsFromInventory, rowsWithAnalysis, selectReleases, selectRows, subtitleLanguageRequirements } from "/assets/dashboard-model.js";

const elements = {
  accessPanel: document.querySelector("#access-panel"),
  accessForm: document.querySelector("#access-form"),
  accessToken: document.querySelector("#access-token"),
  loginUsername: document.querySelector("#login-username"),
  loginPassword: document.querySelector("#login-password"),
  onboarding: document.querySelector("#onboarding"),
  onboardingAccess: document.querySelector("#onboarding-access"),
  onboardingState: document.querySelector("#onboarding-state"),
  onboardingSteps: document.querySelector("#onboarding-steps"),
  onboardingSummary: document.querySelector("#onboarding-summary"),
  activeFilterCount: document.querySelector("#active-filter-count"),
  analysisFilter: document.querySelector("#analysis-filter"),
  analysisAgeFilter: document.querySelector("#analysis-age-filter"),
  applicationFilter: document.querySelector("#application-filter"),
  bestConfidenceFilter: document.querySelector("#best-confidence-filter"),
  connectButton: document.querySelector("#connect-button"),
  catalog: document.querySelector("#catalog"),
  catalogApplication: document.querySelector("#catalog-application"),
  catalogForm: document.querySelector("#catalog-form"),
  catalogQuery: document.querySelector("#catalog-query"),
  catalogResults: document.querySelector("#catalog-results"),
  catalogStatus: document.querySelector("#catalog-status"),
  catalogSubmit: document.querySelector("#catalog-submit"),
  subtitleSettings: document.querySelector("#subtitle-settings"),
  subtitleSettingsForm: document.querySelector("#subtitle-settings-form"),
  subtitleLanguages: document.querySelector("#subtitle-languages"),
  subtitleLanguagePreferences: document.querySelector("#subtitle-language-preferences"),
  subtitleSettingsSave: document.querySelector("#subtitle-settings-save"),
  subtitleSettingsStatus: document.querySelector("#subtitle-settings-status"),
  providerConfiguration: document.querySelector("#provider-configuration"),
  clearInventoryFilters: document.querySelector("#clear-inventory-filters"),
  dashboard: document.querySelector("#dashboard"),
  emptyState: document.querySelector("#empty-state"),
  feasibilityClose: document.querySelector("#feasibility-close"),
  feasibilityContext: document.querySelector("#feasibility-context"),
  feasibilityNotice: document.querySelector("#feasibility-notice"),
  feasibilityPanel: document.querySelector("#feasibility-panel"),
  feasibilityRefresh: document.querySelector("#feasibility-refresh"),
  feasibilitySummary: document.querySelector("#feasibility-summary"),
  feasibilityTitle: document.querySelector("#feasibility-title"),
  grabAdminToken: document.querySelector("#grab-admin-token"),
  grabAuthStep: document.querySelector("#grab-auth-step"),
  grabClose: document.querySelector("#grab-close"),
  grabConfirmation: document.querySelector("#grab-confirmation"),
  grabConfirmationPhrase: document.querySelector("#grab-confirmation-phrase"),
  grabConfirmStep: document.querySelector("#grab-confirm-step"),
  grabDialog: document.querySelector("#grab-dialog"),
  grabExecute: document.querySelector("#grab-execute"),
  grabForm: document.querySelector("#grab-form"),
  grabHistoryAuth: document.querySelector("#grab-history-auth"),
  grabHistoryClose: document.querySelector("#grab-history-close"),
  grabHistoryDialog: document.querySelector("#grab-history-dialog"),
  grabHistoryForm: document.querySelector("#grab-history-form"),
  grabHistoryList: document.querySelector("#grab-history-list"),
  grabHistoryLoad: document.querySelector("#grab-history-load"),
  grabHistoryOpen: document.querySelector("#grab-history-open"),
  grabHistoryRefresh: document.querySelector("#grab-history-refresh"),
  grabHistoryResults: document.querySelector("#grab-history-results"),
  grabHistoryStatus: document.querySelector("#grab-history-status"),
  grabHistoryToken: document.querySelector("#grab-history-token"),
  grabPrepare: document.querySelector("#grab-prepare"),
  grabRelease: document.querySelector("#grab-release"),
  grabStatus: document.querySelector("#grab-status"),
  grabTarget: document.querySelector("#grab-target"),
  grabReconcileCancel: document.querySelector("#grab-reconcile-cancel"),
  grabReconcileConfirmation: document.querySelector("#grab-reconcile-confirmation"),
  grabReconcileOutcome: document.querySelector("#grab-reconcile-outcome"),
  grabReconcilePhrase: document.querySelector("#grab-reconcile-phrase"),
  grabReconcileRelease: document.querySelector("#grab-reconcile-release"),
  grabReconcileStep: document.querySelector("#grab-reconcile-step"),
  grabReconcileSubmit: document.querySelector("#grab-reconcile-submit"),
  grabReconcileTarget: document.querySelector("#grab-reconcile-target"),
  inventoryList: document.querySelector("#inventory-list"),
  kindFilter: document.querySelector("#kind-filter"),
  providerEvidenceFilter: document.querySelector("#provider-evidence-filter"),
  profileFilter: document.querySelector("#profile-filter"),
  policyLanguageFilter: document.querySelector("#policy-language-filter"),
  refreshButton: document.querySelector("#refresh-button"),
  releaseConfidenceFilter: document.querySelector("#release-confidence-filter"),
  releaseControls: document.querySelector("#release-controls"),
  releaseDecisionFilter: document.querySelector("#release-decision-filter"),
  releaseLanguageConfidenceFilter: document.querySelector("#release-language-confidence-filter"),
  releaseLanguageFilter: document.querySelector("#release-language-filter"),
  releaseLeading: document.querySelector("#release-leading"),
  releaseLeadingDetail: document.querySelector("#release-leading-detail"),
  releaseLeadingTitle: document.querySelector("#release-leading-title"),
  releaseProtocolFilter: document.querySelector("#release-protocol-filter"),
  releaseRequiredFitFilter: document.querySelector("#release-required-fit-filter"),
  releaseSearchInput: document.querySelector("#release-search-input"),
  releaseShortlist: document.querySelector("#release-shortlist"),
  releaseShortlistClear: document.querySelector("#release-shortlist-clear"),
  releaseShortlistCount: document.querySelector("#release-shortlist-count"),
  releaseShortlistItems: document.querySelector("#release-shortlist-items"),
  releaseSortOrder: document.querySelector("#release-sort-order"),
  releaseTableBody: document.querySelector("#release-table-body"),
  releaseTableWrap: document.querySelector("#release-table-wrap"),
  releaseVisibleCount: document.querySelector("#release-visible-count"),
  requiredCoverageFilter: document.querySelector("#required-coverage-filter"),
  searchInput: document.querySelector("#search-input"),
  sessionLogout: document.querySelector("#session-logout"),
  sortOrder: document.querySelector("#sort-order"),
  sourceStatus: document.querySelector("#source-status"),
  statusMessage: document.querySelector("#status-message"),
  visibleCount: document.querySelector("#visible-count"),
  visibleLabel: document.querySelector("#visible-label"),
};

let libraryAuthorization;
let sessionCsrfToken;
let inventoryRows = [];
let selectedRow;
let activeFeasibility;
let pageBusy = false;
let grabContext;
let administratorToken;
let historyAdministratorToken;
let reconciliationContext;
let catalogAddEnabled = false;
let subtitleLanguagePreferences = new Map();
const feasibilityCache = new Map();
const analysisByItem = new Map();
const shortlistedReleaseIds = new Set();

elements.accessForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = elements.loginUsername?.value.trim() ?? "";
  const password = elements.loginPassword?.value ?? "";
  const legacyToken = elements.accessToken?.value ?? "";
  if (username && password.length >= 32) {
    const authenticated = await establishSession(username, password);
    elements.loginPassword.value = "";
    if (!authenticated) return;
  } else if (legacyToken.length >= 32) {
    libraryAuthorization = `Bearer ${legacyToken}`;
    sessionCsrfToken = undefined;
  } else {
    setStatus("Enter your Pegarr username and password, or a legacy access token.", "error");
    return;
  }
  elements.loginPassword.value = "";
  elements.accessToken.value = "";
  await loadInventory();
});

elements.catalogForm?.addEventListener("submit", searchCatalog);
elements.subtitleSettingsForm?.addEventListener("submit", saveSubtitleSettings);
elements.subtitleLanguages?.addEventListener("input", renderSubtitleLanguagePreferences);
elements.sessionLogout?.addEventListener("click", signOut);

elements.refreshButton?.addEventListener("click", loadInventory);
elements.feasibilityRefresh?.addEventListener("click", () => selectedRow && loadFeasibility(selectedRow, true));
elements.feasibilityClose?.addEventListener("click", closeFeasibility);
elements.grabClose?.addEventListener("click", closeGrabDialog);
elements.grabDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeGrabDialog();
});
elements.grabDialog?.addEventListener("close", clearGrabDialog);
elements.grabForm?.addEventListener("submit", (event) => event.preventDefault());
elements.grabPrepare?.addEventListener("click", prepareControlledGrab);
elements.grabExecute?.addEventListener("click", executeControlledGrab);
elements.grabConfirmation?.addEventListener("input", () => {
  elements.grabExecute.disabled = elements.grabConfirmation.value !== grabContext?.confirmation;
});
elements.grabHistoryOpen?.addEventListener("click", openGrabHistory);
elements.grabHistoryClose?.addEventListener("click", closeGrabHistory);
elements.grabHistoryDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeGrabHistory();
});
elements.grabHistoryDialog?.addEventListener("close", clearGrabHistory);
elements.grabHistoryForm?.addEventListener("submit", (event) => event.preventDefault());
elements.grabHistoryLoad?.addEventListener("click", loadGrabHistory);
elements.grabHistoryRefresh?.addEventListener("click", loadGrabHistory);
elements.grabReconcileCancel?.addEventListener("click", clearReconciliation);
elements.grabReconcileOutcome?.addEventListener("change", updateReconciliationConfirmation);
elements.grabReconcileConfirmation?.addEventListener("input", updateReconciliationConfirmation);
elements.grabReconcileSubmit?.addEventListener("click", submitReconciliation);
elements.releaseShortlistClear?.addEventListener("click", clearShortlist);
elements.clearInventoryFilters?.addEventListener("click", clearInventoryFilters);
for (const control of [elements.searchInput, elements.applicationFilter, elements.kindFilter, elements.analysisFilter, elements.bestConfidenceFilter, elements.requiredCoverageFilter, elements.providerEvidenceFilter, elements.profileFilter, elements.policyLanguageFilter, elements.analysisAgeFilter, elements.sortOrder]) {
  control?.addEventListener("input", renderInventory);
  control?.addEventListener("change", renderInventory);
}
for (const control of [elements.releaseSearchInput, elements.releaseDecisionFilter, elements.releaseConfidenceFilter, elements.releaseProtocolFilter, elements.releaseRequiredFitFilter, elements.releaseLanguageFilter, elements.releaseLanguageConfidenceFilter, elements.releaseSortOrder]) {
  control?.addEventListener("input", renderReleaseSelection);
  control?.addEventListener("change", renderReleaseSelection);
}

void restoreSession();

async function establishSession(username, password) {
  try {
    const response = await fetch("/api/v1/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const result = await response.json();
    if (!response.ok || typeof result?.csrfToken !== "string") {
      showAccess("Those credentials were not accepted. Check the configured login and try again.");
      return false;
    }
    libraryAuthorization = undefined;
    sessionCsrfToken = result.csrfToken;
    return true;
  } catch {
    showAccess("Pegarr could not start a private session. Try again when the server is available.");
    return false;
  }
}

async function restoreSession() {
  try {
    const response = await fetch("/api/v1/session", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) return;
    const result = await response.json();
    if (typeof result?.csrfToken !== "string") return;
    sessionCsrfToken = result.csrfToken;
    await loadInventory();
  } catch {
    // An absent or expired session leaves the normal sign-in form available.
  }
}

async function signOut() {
  const csrfToken = sessionCsrfToken;
  libraryAuthorization = undefined;
  sessionCsrfToken = undefined;
  if (csrfToken !== undefined) {
    try {
      await fetch("/api/v1/session/logout", {
        method: "POST",
        headers: { "x-pegarr-csrf": csrfToken },
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
    } catch {
      // Local page evidence is still cleared even if the server is unavailable.
    }
  }
  clearPageEvidence();
  showAccess("Signed out. Sign in again when you are ready.");
}

function libraryHeaders(extra = {}, mutation = false) {
  return {
    ...(libraryAuthorization === undefined ? {} : { authorization: libraryAuthorization }),
    ...(mutation && sessionCsrfToken !== undefined ? { "x-pegarr-csrf": sessionCsrfToken } : {}),
    ...extra,
  };
}

function hasLibraryAccess() {
  return libraryAuthorization !== undefined || sessionCsrfToken !== undefined;
}

function clearLibraryAuthentication() {
  libraryAuthorization = undefined;
  sessionCsrfToken = undefined;
}

async function loadInventory() {
  if (!hasLibraryAccess()) {
    showAccess("Sign in to reconnect.");
    return;
  }
  setBusy(true);
  setStatus("Loading missing items…", "loading");
  try {
    const response = await fetch("/api/v1/library/missing", {
      method: "GET",
      headers: libraryHeaders(),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 401) {
      clearLibraryAuthentication();
      clearPageEvidence();
      showAccess("Those credentials were not accepted. Check the configured login and try again.");
      return;
    }
    if (response.status === 404) {
      clearLibraryAuthentication();
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
    elements.onboarding.hidden = false;
    elements.catalog.hidden = false;
    elements.subtitleSettings.hidden = false;
    elements.dashboard.hidden = false;
    elements.sessionLogout.hidden = false;
    await Promise.all([loadSubtitleSettings(), loadOnboarding()]);
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
  elements.onboarding.hidden = true;
  elements.catalog.hidden = true;
  elements.subtitleSettings.hidden = true;
  elements.sessionLogout.hidden = true;
  elements.accessPanel.hidden = false;
  setStatus(message, "error");
  elements.loginUsername?.focus();
}

async function loadOnboarding() {
  try {
    const response = await fetch("/api/v1/onboarding", {
      method: "GET",
      headers: libraryHeaders(),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("onboarding_unavailable");
    renderOnboarding(await response.json());
  } catch {
    elements.onboardingState.className = "source-chip source-chip--integration_failure";
    elements.onboardingState.textContent = "Status unavailable";
    elements.onboardingSummary.textContent = "Pegarr could not read the setup guide. Existing discovery actions remain unchanged.";
    elements.onboardingSteps.replaceChildren();
    elements.onboardingAccess.textContent = "No configuration was changed.";
  }
}

function renderOnboarding(status) {
  const requirements = status?.requirements ?? {};
  const arr = requirements.arrCatalog ?? {};
  const policy = requirements.subtitlePolicy ?? {};
  const provider = requirements.subtitleProvider ?? {};
  const providers = Array.isArray(provider.providers) ? provider.providers : [];
  const sonarrCount = Number.isSafeInteger(arr.sonarrInstances) ? arr.sonarrInstances : 0;
  const radarrCount = Number.isSafeInteger(arr.radarrInstances) ? arr.radarrInstances : 0;
  const languageCount = Number.isSafeInteger(policy.languageCount) ? policy.languageCount : 0;
  const steps = [
    {
      title: "Connect a catalog",
      ready: arr.status === "ready",
      detail: arr.status === "ready"
        ? `${sonarrCount} Sonarr and ${radarrCount} Radarr ${sonarrCount + radarrCount === 1 ? "instance" : "instances"} configured.`
        : "Configure at least one Sonarr or Radarr instance in the deployment.",
    },
    {
      title: "Choose subtitle languages",
      ready: policy.status === "ready",
      detail: policy.status === "ready"
        ? `${languageCount} ${languageCount === 1 ? "language" : "languages"} in the active Pegarr policy.`
        : "Choose at least one language in Subtitle policy below.",
    },
    {
      title: "Connect a subtitle provider",
      ready: provider.status === "ready",
      detail: provider.status === "ready"
        ? `${providers.map(providerName).join(" and ")} ${providers.length === 1 ? "is" : "are"} configured without exposing credentials.`
        : "Configure SubDL or OpenSubtitles below to preview coverage.",
    },
  ];
  elements.onboardingSteps.replaceChildren(...steps.map(renderOnboardingStep));
  const ready = status?.status === "ready";
  elements.onboardingState.className = `source-chip ${ready ? "source-chip--ready" : ""}`;
  elements.onboardingState.textContent = ready ? "Discovery ready" : "Setup needed";
  elements.onboardingSummary.textContent = ready
    ? "Catalog search and subtitle preview are ready. Adding and downloading remain separate explicit capabilities."
    : "Complete the required steps below. Missing setup never becomes a false No match found result.";

  const access = status?.access ?? {};
  const capabilityMessages = access.role === "legacy_read_only"
    ? ["Legacy token: search and preview only. Sign in with the Pegarr username and password to change settings or add titles."]
    : [
        access.catalogAddMutation
          ? "Operator session: settings changes and explicit catalog add are available."
          : "Operator session: settings changes are available; catalog add is disabled by deployment configuration.",
      ];
  capabilityMessages.push(
    access.controlledGrab === "administrator_token_required"
      ? "Controlled Grab is enabled but always requires the separate administrator token and exact confirmation."
      : "Controlled Grab is disabled; every analysis remains read-only.",
  );
  elements.onboardingAccess.textContent = capabilityMessages.join(" ");
}

function renderOnboardingStep(step) {
  const item = document.createElement("li");
  item.className = `onboarding-step ${step.ready ? "onboarding-step--ready" : "onboarding-step--missing"}`;
  const marker = document.createElement("span");
  marker.className = "onboarding-step-marker";
  marker.textContent = step.ready ? "Ready" : "Needed";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = step.title;
  const detail = document.createElement("span");
  detail.textContent = step.detail;
  copy.append(title, detail);
  item.append(marker, copy);
  return item;
}

function providerName(value) {
  return value === "opensubtitles" ? "OpenSubtitles" : value === "subdl" ? "SubDL" : "Provider";
}

async function searchCatalog(event) {
  event.preventDefault();
  if (!hasLibraryAccess()) return showAccess("Sign in to search the catalog.");
  const query = elements.catalogQuery.value.trim();
  if (query.length < 2 || query.length > 200) {
    setCatalogStatus("Enter at least two characters.", "error");
    return;
  }
  elements.catalogSubmit.disabled = true;
  setCatalogStatus("Searching Sonarr and Radarr…", "loading");
  try {
    const application = elements.catalogApplication.value;
    const endpoint = `/api/v1/catalog/search?q=${encodeURIComponent(query)}${application === "all" ? "" : `&application=${encodeURIComponent(application)}`}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: libraryHeaders(),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 401) {
      clearLibraryAuthentication();
      clearPageEvidence();
      showAccess("Those credentials were not accepted. Sign in again.");
      return;
    }
    if (!response.ok) throw new Error("catalog_unavailable");
    const result = await response.json();
    catalogAddEnabled = result?.capabilities?.catalogAdd === true;
    const items = Array.isArray(result?.items) ? result.items : [];
    elements.catalogResults.replaceChildren(...items.map(renderCatalogItem));
    setCatalogStatus(
      items.length === 0
        ? "No catalog matches were returned."
        : `${items.length} catalog ${items.length === 1 ? "match" : "matches"}. Exact release search continues after an explicit add.`,
      result?.status === "partial" ? "warning" : "success",
    );
  } catch {
    elements.catalogResults.replaceChildren();
    setCatalogStatus("Catalog search is unavailable. No title was added.", "error");
  } finally {
    elements.catalogSubmit.disabled = false;
  }
}

function renderCatalogItem(item) {
  const row = document.createElement("li");
  row.className = "catalog-result";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = typeof item?.title === "string" ? item.title : "Untitled result";
  const detail = document.createElement("span");
  const application = item?.application === "sonarr" ? "Sonarr series" : "Radarr movie";
  detail.textContent = `${application}${Number.isInteger(item?.year) ? ` · ${item.year}` : ""} · ${item?.instanceId ?? "default"}`;
  copy.append(title, detail);
  const actions = document.createElement("div");
  actions.className = "catalog-result-actions";
  const state = document.createElement("span");
  state.className = `source-chip ${item?.alreadyAdded ? "source-chip--ready" : ""}`;
  state.textContent = item?.alreadyAdded ? "Already added" : "Available to add";
  const preview = document.createElement("button");
  preview.className = "secondary-button catalog-preview-button";
  preview.type = "button";
  preview.textContent = "Preview subtitles";
  const coverage = document.createElement("div");
  coverage.className = "catalog-coverage";
  coverage.hidden = true;
  preview.addEventListener("click", () => previewCatalogCoverage(item, preview, coverage));
  actions.append(state, preview);
  const addPanel = document.createElement("div");
  addPanel.className = "catalog-add-panel";
  addPanel.hidden = true;
  if (!item?.alreadyAdded && catalogAddEnabled && sessionCsrfToken !== undefined) {
    const add = document.createElement("button");
    add.className = "primary-button catalog-add-button";
    add.type = "button";
    add.textContent = `Add to ${item?.application === "sonarr" ? "Sonarr" : "Radarr"}`;
    add.addEventListener("click", () => loadCatalogAddOptions(item, add, addPanel));
    actions.append(add);
  }
  row.append(copy, actions, coverage, addPanel);
  return row;
}

async function loadCatalogAddOptions(item, button, panel) {
  const identity = catalogIdentity(item);
  if (identity === undefined) {
    panel.hidden = false;
    panel.textContent = "This result has no safe Arr catalog identity.";
    return;
  }
  button.disabled = true;
  panel.hidden = false;
  panel.textContent = "Loading server-owned add options…";
  try {
    const response = await fetch(`${catalogItemEndpoint(item, identity)}/add-options`, {
      method: "GET",
      headers: libraryHeaders(),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("catalog_add_options_unavailable");
    renderCatalogAddForm(item, identity, await response.json(), panel, button);
  } catch {
    panel.textContent = "Pegarr could not load the add options. Nothing was added.";
    button.disabled = false;
  }
}

function renderCatalogAddForm(item, identity, options, panel, openButton) {
  const form = document.createElement("form");
  form.className = "catalog-add-form";
  const warning = document.createElement("p");
  warning.className = "catalog-add-warning";
  warning.textContent = "This adds only the title. Automatic search stays off and no release will be downloaded.";
  const root = catalogAddSelect("Root folder", options?.rootFolders, "label");
  const profile = catalogAddSelect("Quality profile", options?.qualityProfiles, "name");
  const monitoredLabel = document.createElement("label");
  monitoredLabel.className = "catalog-add-check";
  const monitored = document.createElement("input");
  monitored.type = "checkbox";
  monitored.checked = options?.defaults?.monitored === true;
  monitoredLabel.append(monitored, document.createTextNode(" Monitor this title"));
  const applicationOption = item?.application === "sonarr"
    ? catalogAddChoice("Episodes to monitor", [
        ["all", "All episodes"], ["future", "Future episodes"], ["missing", "Missing episodes"],
        ["existing", "Existing episodes"], ["firstSeason", "First season"], ["lastSeason", "Last season"],
        ["pilot", "Pilot"], ["recent", "Recent episodes"], ["none", "None"],
      ], options?.defaults?.monitor ?? "all")
    : catalogAddChoice("Minimum availability", [
        ["announced", "Announced"], ["inCinemas", "In cinemas"], ["released", "Released"],
      ], options?.defaults?.minimumAvailability ?? "released");
  const confirmationLabel = document.createElement("label");
  confirmationLabel.textContent = "Type this confirmation phrase";
  const phrase = document.createElement("code");
  phrase.textContent = typeof options?.confirmation === "string" ? options.confirmation : "";
  const confirmation = document.createElement("input");
  confirmation.type = "text";
  confirmation.maxLength = 2048;
  confirmation.autocomplete = "off";
  confirmation.spellcheck = false;
  confirmationLabel.append(phrase, confirmation);
  const submit = document.createElement("button");
  submit.className = "primary-button";
  submit.type = "submit";
  submit.disabled = true;
  submit.textContent = `Confirm add to ${item.application === "sonarr" ? "Sonarr" : "Radarr"}`;
  const cancel = document.createElement("button");
  cancel.className = "secondary-button";
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    panel.replaceChildren();
    panel.hidden = true;
    openButton.disabled = false;
  });
  confirmation.addEventListener("input", () => {
    submit.disabled = confirmation.value !== options?.confirmation;
  });
  const status = document.createElement("p");
  status.className = "status-message catalog-add-status";
  form.addEventListener("submit", (event) => submitCatalogAdd(event, {
    item, identity, options, root: root.select, profile: profile.select,
    monitored, applicationOption: applicationOption.select, confirmation, submit, status,
  }));
  const actions = document.createElement("div");
  actions.className = "catalog-add-form-actions";
  actions.append(submit, cancel);
  form.append(warning, root.label, profile.label, applicationOption.label, monitoredLabel, confirmationLabel, actions, status);
  panel.replaceChildren(form);
}

async function submitCatalogAdd(event, context) {
  event.preventDefault();
  context.submit.disabled = true;
  context.status.textContent = "Adding the title with automatic search disabled…";
  context.status.dataset.state = "loading";
  const common = {
    rootFolderId: Number(context.root.value),
    qualityProfileId: Number(context.profile.value),
    monitored: context.monitored.checked,
    confirmation: context.confirmation.value,
  };
  const body = context.item.application === "sonarr"
    ? { ...common, monitor: context.applicationOption.value }
    : { ...common, minimumAvailability: context.applicationOption.value };
  try {
    const response = await fetch(`${catalogItemEndpoint(context.item, context.identity)}/add`, {
      method: "POST",
      headers: libraryHeaders({ "content-type": "application/json" }, true),
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const result = await response.json();
    if (response.status === 202 && (result?.status === "timeout_unknown" || result?.status === "verification_unknown")) {
      context.status.textContent = result.status === "verification_unknown"
        ? "Arr accepted the add, but Pegarr could not verify the returned identity. Check the Arr library before trying again."
        : "The add timed out, so its outcome is Unknown. Check the Arr library before trying again.";
      context.status.dataset.state = "warning";
      return;
    }
    if (!response.ok) throw new Error("catalog_add_failed");
    const next = result?.next?.action === "choose_series_scope"
      ? "Choose a season or episode next for exact release analysis."
      : "The movie is ready for exact release analysis in Pegarr.";
    context.status.textContent = `Added to ${context.item.application === "sonarr" ? "Sonarr" : "Radarr"}. Automatic search remained off. ${next}`;
    context.status.dataset.state = "success";
    context.confirmation.disabled = true;
    if (result?.next?.action === "exact_movie_release_analysis" && typeof result.next.continuationId === "string") {
      await loadCatalogContinuationAnalysis(result.next.continuationId, context.item, result.receipt, context.status);
    }
    if (result?.next?.action === "choose_series_scope" && typeof result.next.continuationId === "string") {
      await loadCatalogSeriesScopes(result.next.continuationId, context.item, result.receipt, context.status);
    }
  } catch {
    context.status.textContent = "Pegarr could not confirm the add. Nothing else was started.";
    context.status.dataset.state = "error";
    context.submit.disabled = context.confirmation.value !== context.options?.confirmation;
  }
}

async function loadCatalogSeriesScopes(continuationId, item, receipt, status) {
  status.textContent = "Added with automatic search off. Loading seasons and episodes…";
  status.dataset.state = "loading";
  try {
    const response = await fetch(`/api/v1/catalog/continuations/${encodeURIComponent(continuationId)}/scopes`, {
      method: "GET",
      headers: libraryHeaders(),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const result = await response.json();
    if (!response.ok || result?.status !== "ready") throw new Error("catalog_scopes_unavailable");
    const scopePanel = document.createElement("div");
    scopePanel.className = "catalog-scope-panel";
    const label = document.createElement("label");
    label.textContent = "Analyze a season or episode";
    const select = document.createElement("select");
    const seasonGroup = document.createElement("optgroup");
    seasonGroup.label = "Seasons";
    for (const season of Array.isArray(result.seasons) ? result.seasons : []) {
      if (!Number.isSafeInteger(season?.seasonNumber)) continue;
      const option = document.createElement("option");
      option.value = `season:${season.seasonNumber}`;
      option.textContent = `${season.label} · ${season.episodeCount} ${season.episodeCount === 1 ? "episode" : "episodes"}`;
      seasonGroup.append(option);
    }
    const episodeGroup = document.createElement("optgroup");
    episodeGroup.label = "Episodes";
    for (const episode of Array.isArray(result.episodes) ? result.episodes : []) {
      if (!Number.isSafeInteger(episode?.episodeId) || !Number.isSafeInteger(episode?.seasonNumber) || !Number.isSafeInteger(episode?.episodeNumber)) continue;
      const option = document.createElement("option");
      option.value = `episode:${episode.episodeId}`;
      option.textContent = `S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")} · ${episode.title}`;
      episodeGroup.append(option);
    }
    select.append(seasonGroup, episodeGroup);
    const analyze = document.createElement("button");
    analyze.className = "secondary-button";
    analyze.type = "button";
    analyze.textContent = "Analyze exact releases";
    analyze.disabled = select.options.length === 0;
    analyze.addEventListener("click", async () => {
      const [kind, rawValue] = select.value.split(":");
      const value = Number(rawValue);
      if ((kind !== "season" && kind !== "episode") || !Number.isSafeInteger(value)) return;
      analyze.disabled = true;
      await loadCatalogContinuationAnalysis(continuationId, item, receipt, status, { kind, value });
      analyze.disabled = false;
    });
    label.append(select);
    scopePanel.append(label, analyze);
    status.parentElement?.append(scopePanel);
    status.textContent = "Added with automatic search off. Choose one season or episode for exact analysis.";
    status.dataset.state = "success";
  } catch {
    status.textContent = "The series was added, but Pegarr could not load its season and episode choices.";
    status.dataset.state = "warning";
  }
}

async function loadCatalogContinuationAnalysis(continuationId, item, receipt, status, scope) {
  const applicationName = receipt?.application === "sonarr" ? "Sonarr" : "Radarr";
  status.textContent = `Added with automatic search off. Loading exact ${applicationName} releases and subtitle evidence…`;
  status.dataset.state = "loading";
  const scopeKind = scope?.kind === "season" || scope?.kind === "episode" ? scope.kind : undefined;
  const scopeValue = Number.isSafeInteger(scope?.value) ? scope.value : undefined;
  const scopePath = scopeKind === undefined ? "" : `/${scopeKind}/${scopeValue}`;
  const row = {
    key: `catalog-continuation:${continuationId}`,
    itemId: scopeKind === "episode" ? scopeValue : receipt?.itemId,
    application: receipt?.application,
    instanceId: item?.instanceId,
    kind: scopeKind ?? "movie",
    title: item?.title ?? "Added movie",
    context: scopeKind === "season"
      ? `Season ${scopeValue}`
      : scopeKind === "episode"
        ? "Selected episode"
        : Number.isSafeInteger(item?.year) ? String(item.year) : "Movie",
    grabEndpoint: `/api/v1/catalog/continuations/${encodeURIComponent(continuationId)}/analysis${scopePath}/grab`,
  };
  selectedRow = row;
  activeFeasibility = undefined;
  resetReleaseControls();
  elements.feasibilityPanel.hidden = false;
  elements.feasibilityTitle.textContent = row.title;
  elements.feasibilityContext.textContent = `${row.context} · added with automatic search off`;
  elements.feasibilitySummary.replaceChildren();
  elements.releaseTableBody.replaceChildren();
  elements.releaseTableWrap.hidden = true;
  elements.releaseControls.hidden = true;
  setFeasibilityNotice("Searching exact Radarr releases and checking subtitle evidence…", "loading");
  try {
    const response = await fetch(`/api/v1/catalog/continuations/${encodeURIComponent(continuationId)}/analysis${scopePath}`, {
      method: "GET",
      headers: libraryHeaders(),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 401) {
      clearLibraryAuthentication();
      clearPageEvidence();
      showAccess("Those credentials were not accepted. Sign in again.");
      return;
    }
    const view = feasibilityView(await response.json());
    if (!response.ok && view.state === "invalid") throw new Error("catalog_continuation_unavailable");
    renderFeasibility(view);
    status.textContent = view.state === "ready"
      ? "Added with automatic search off. Exact release analysis is ready below."
      : "The title was added, but exact release analysis needs attention below.";
    status.dataset.state = view.state === "ready" ? "success" : "warning";
    elements.feasibilityTitle.focus();
  } catch {
    setFeasibilityNotice("The movie was added, but Pegarr could not complete exact analysis. Subtitle availability remains Unknown.", "error");
    status.textContent = "Added with automatic search off, but exact release analysis is unavailable.";
    status.dataset.state = "warning";
  }
}

function catalogAddSelect(name, values, textKey) {
  const entries = Array.isArray(values) ? values : [];
  const label = document.createElement("label");
  label.textContent = name;
  const select = document.createElement("select");
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry?.id) || typeof entry?.[textKey] !== "string") continue;
    const option = document.createElement("option");
    option.value = String(entry.id);
    option.textContent = entry[textKey];
    option.disabled = entry?.accessible === false;
    select.append(option);
  }
  label.append(select);
  return { label, select };
}

function catalogAddChoice(name, values, selectedValue) {
  const label = document.createElement("label");
  label.textContent = name;
  const select = document.createElement("select");
  for (const [value, text] of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = value === selectedValue;
    select.append(option);
  }
  label.append(select);
  return { label, select };
}

function catalogIdentity(item) {
  const providerId = item?.application === "sonarr" ? "tvdb" : item?.application === "radarr" ? "tmdb" : undefined;
  const value = providerId === undefined ? undefined : item?.ids?.[providerId];
  return providerId !== undefined && typeof value === "string" ? { providerId, value } : undefined;
}

function catalogItemEndpoint(item, identity) {
  return `/api/v1/catalog/${item.application}/${encodeURIComponent(item.instanceId)}/${identity.providerId}/${encodeURIComponent(identity.value)}`;
}

async function loadSubtitleSettings() {
  try {
    const response = await fetch("/api/v1/settings/subtitles", {
      method: "GET",
      headers: libraryHeaders(),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("settings_unavailable");
    renderSubtitleSettings(await response.json());
  } catch {
    setSubtitleSettingsStatus("Subtitle settings are unavailable. Coverage remains unresolved.", "error");
  }
}

function renderSubtitleSettings(settings) {
  const languages = Array.isArray(settings?.policy?.languages) ? settings.policy.languages : [];
  elements.subtitleLanguages.value = languages.map(({ code }) => code).filter((code) => typeof code === "string").join(", ");
  subtitleLanguagePreferences = new Map(languages.flatMap((language) => typeof language?.code === "string"
    ? [[languagePreferenceKey(language.code), {
        code: language.code,
        required: language.required !== false,
        forced: language.forced === true,
        hearingImpaired: ["required", "prefer", "avoid", "either"].includes(language.hearingImpaired) ? language.hearingImpaired : "either",
      }]]
    : []));
  renderSubtitleLanguagePreferences();
  const providers = Array.isArray(settings?.providers) ? settings.providers : [];
  elements.providerConfiguration.replaceChildren(...providers.map((provider) => {
    const card = document.createElement("div");
    card.className = "provider-configuration-card";
    const name = document.createElement("strong");
    name.textContent = provider?.provider === "opensubtitles" ? "OpenSubtitles" : "SubDL";
    const state = document.createElement("span");
    state.className = `source-chip ${provider?.configured ? "source-chip--ready" : ""}`;
    state.textContent = provider?.configured ? "Credential configured" : "Credential not configured";
    const mappings = document.createElement("small");
    const count = Array.isArray(provider?.languageMappings) ? provider.languageMappings.length : 0;
    const origin = provider?.origin === "ui" ? "Saved in Pegarr" : provider?.origin === "deployment" ? "Deployment secret" : "No credential";
    mappings.textContent = `${origin} · ${count} language ${count === 1 ? "mapping" : "mappings"}`;

    const form = document.createElement("form");
    form.className = "provider-settings-form";
    const mappingLabel = document.createElement("label");
    mappingLabel.textContent = "Language mappings";
    const mappingInput = document.createElement("input");
    mappingInput.type = "text";
    mappingInput.maxLength = 1024;
    mappingInput.autocomplete = "off";
    mappingInput.spellcheck = false;
    mappingInput.placeholder = "pt-BR:PT-BR, en:EN";
    mappingInput.value = (provider?.languageMappings ?? []).map(({ policyCode, providerCode }) => `${policyCode}:${providerCode}`).join(", ");
    mappingLabel.append(mappingInput);

    const keyLabel = document.createElement("label");
    keyLabel.textContent = "API key";
    const keyInput = document.createElement("input");
    keyInput.type = "password";
    keyInput.maxLength = 4096;
    keyInput.minLength = 16;
    keyInput.autocomplete = "new-password";
    keyInput.spellcheck = false;
    keyInput.placeholder = provider?.configured ? "Leave blank to keep current key" : "Paste provider API key";
    keyLabel.append(keyInput);

    const save = document.createElement("button");
    save.className = "secondary-button";
    save.type = "submit";
    save.textContent = provider?.configured ? "Update provider" : "Configure provider";
    form.append(mappingLabel, keyLabel, save);
    form.addEventListener("submit", (event) => saveProviderSettings(event, provider, mappingInput, keyInput, save));
    card.append(name, state, mappings, form);
    return card;
  }));
  setSubtitleSettingsStatus(
    languages.length === 0 ? "Add at least one language before previewing subtitle coverage." : `Policy ready for ${languages.length} ${languages.length === 1 ? "language" : "languages"}.`,
    languages.length === 0 ? "warning" : "success",
  );
}

function renderSubtitleLanguagePreferences() {
  const codes = elements.subtitleLanguages.value.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 16);
  const nextPreferences = new Map();
  const rows = codes.map((code) => {
    const key = languagePreferenceKey(code);
    const preference = subtitleLanguagePreferences.get(key) ?? {
      code,
      required: true,
      forced: false,
      hearingImpaired: "either",
    };
    nextPreferences.set(key, { ...preference, code });
    const row = document.createElement("div");
    row.className = "subtitle-language-preference";
    const name = document.createElement("strong");
    name.textContent = code;
    const requiredLabel = document.createElement("label");
    requiredLabel.className = "subtitle-language-check";
    const required = document.createElement("input");
    required.type = "checkbox";
    required.checked = preference.required !== false;
    requiredLabel.append(required, " Required");
    const forcedLabel = document.createElement("label");
    forcedLabel.className = "subtitle-language-check";
    const forced = document.createElement("input");
    forced.type = "checkbox";
    forced.checked = preference.forced === true;
    forcedLabel.append(forced, " Forced subtitles only");
    const hearingLabel = document.createElement("label");
    hearingLabel.className = "subtitle-hearing-preference";
    const hearingText = document.createElement("span");
    hearingText.textContent = "Hearing-impaired subtitles";
    const hearing = document.createElement("select");
    hearing.replaceChildren(
      new Option("Either", "either"),
      new Option("Prefer", "prefer"),
      new Option("Require", "required"),
      new Option("Avoid", "avoid"),
    );
    hearing.value = preference.hearingImpaired;
    hearingLabel.append(hearingText, hearing);
    const update = () => subtitleLanguagePreferences.set(key, {
      code,
      required: required.checked,
      forced: forced.checked,
      hearingImpaired: hearing.value,
    });
    required.addEventListener("change", update);
    forced.addEventListener("change", update);
    hearing.addEventListener("change", update);
    row.append(name, requiredLabel, forcedLabel, hearingLabel);
    return row;
  });
  subtitleLanguagePreferences = nextPreferences;
  elements.subtitleLanguagePreferences.replaceChildren(...rows);
}

function languagePreferenceKey(value) {
  return value.trim().replaceAll("_", "-").toLocaleLowerCase();
}

async function saveProviderSettings(event, provider, mappingInput, keyInput, button) {
  event.preventDefault();
  if (sessionCsrfToken === undefined) {
    keyInput.value = "";
    setSubtitleSettingsStatus("Sign in with the Pegarr username and password to configure providers.", "error");
    return;
  }
  const providerId = provider?.provider;
  if (providerId !== "subdl" && providerId !== "opensubtitles") return;
  const apiKey = keyInput.value.trim();
  keyInput.value = "";
  if (!provider?.configured && apiKey.length === 0) {
    setSubtitleSettingsStatus("Paste an API key the first time you configure a provider.", "error");
    return;
  }
  let languageMappings;
  try {
    languageMappings = parseProviderMappings(mappingInput.value);
  } catch {
    setSubtitleSettingsStatus("Use comma-separated policy:provider pairs, such as pt-BR:PT-BR, en:EN.", "error");
    return;
  }
  button.disabled = true;
  try {
    const response = await fetch(`/api/v1/settings/providers/${providerId}`, {
      method: "PUT",
      headers: libraryHeaders({ "content-type": "application/json" }, true),
      body: JSON.stringify({ ...(apiKey.length === 0 ? {} : { apiKey }), languageMappings }),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("provider_settings_update_failed");
    renderSubtitleSettings(await response.json());
    setSubtitleSettingsStatus(`${providerId === "subdl" ? "SubDL" : "OpenSubtitles"} is ready for pre-add coverage.`, "success");
  } catch {
    setSubtitleSettingsStatus("Pegarr could not save that provider. The previous configuration remains active.", "error");
  } finally {
    button.disabled = false;
  }
}

function parseProviderMappings(value) {
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length > 64) throw new Error("too_many_mappings");
  return entries.map((entry) => {
    const parts = entry.split(":").map((part) => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("invalid_mapping");
    return { policyCode: parts[0], providerCode: parts[1] };
  });
}

async function saveSubtitleSettings(event) {
  event.preventDefault();
  if (sessionCsrfToken === undefined) {
    setSubtitleSettingsStatus("Sign in with the Pegarr username and password to change settings.", "error");
    return;
  }
  let languages;
  try {
    languages = subtitleLanguageRequirements(elements.subtitleLanguages.value, [...subtitleLanguagePreferences.values()]);
  } catch {
    setSubtitleSettingsStatus("Enter 1 to 16 unique comma-separated language codes.", "error");
    return;
  }
  elements.subtitleSettingsSave.disabled = true;
  try {
    const response = await fetch("/api/v1/settings/subtitles", {
      method: "PUT",
      headers: libraryHeaders({ "content-type": "application/json" }, true),
      body: JSON.stringify({ languages }),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("settings_update_failed");
    renderSubtitleSettings(await response.json());
  } catch {
    setSubtitleSettingsStatus("Pegarr could not save that policy. The previous settings remain active.", "error");
  } finally {
    elements.subtitleSettingsSave.disabled = false;
  }
}

async function previewCatalogCoverage(item, button, output) {
  const providerId = item?.application === "sonarr" ? "tvdb" : "tmdb";
  const value = item?.ids?.[providerId];
  if (typeof value !== "string") {
    output.hidden = false;
    output.textContent = `This result has no ${providerId.toUpperCase()} identity for a safe preview.`;
    return;
  }
  button.disabled = true;
  output.hidden = false;
  output.textContent = "Checking configured subtitle providers…";
  try {
    const endpoint = `/api/v1/catalog/${item.application}/${encodeURIComponent(item.instanceId)}/${providerId}/${encodeURIComponent(value)}/coverage`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: libraryHeaders(),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const result = await response.json();
    if (!response.ok) throw new Error("coverage_unavailable");
    if (result.status !== "ready") {
      const messages = {
        policy_unresolved: "Configure at least one subtitle language first.",
        provider_unconfigured: "Configure a supported subtitle provider on the server first.",
        item_not_found: "The catalog result is no longer available.",
      };
      output.textContent = messages[result.status] ?? "Subtitle coverage is unavailable.";
      return;
    }
    output.replaceChildren(...result.languages.map((language) => {
      const chip = document.createElement("span");
      chip.className = `coverage-chip coverage-chip--${language.state}`;
      chip.textContent = `${language.code}: ${language.state.replaceAll("_", " ")}${language.subtitleCount > 0 ? ` (${language.subtitleCount})` : ""}`;
      return chip;
    }));
  } catch {
    output.textContent = "Pegarr could not verify subtitle coverage. Availability remains Unknown.";
  } finally {
    button.disabled = false;
  }
}

function setSubtitleSettingsStatus(message, state) {
  elements.subtitleSettingsStatus.textContent = message;
  elements.subtitleSettingsStatus.dataset.state = state;
}

function setCatalogStatus(message, state) {
  elements.catalogStatus.textContent = message;
  elements.catalogStatus.dataset.state = state;
}

function renderInventory() {
  const analyzedRows = rowsWithAnalysis(inventoryRows, analysisByItem);
  populateInventoryAnalysisFilters(analyzedRows);
  const options = inventorySelectionOptions();
  const rows = selectRows(analyzedRows, {
    ...options,
    nowEpochMs: Date.now(),
  });
  const activeFilters = activeInventoryFilterCount(options);
  elements.activeFilterCount.textContent = `${activeFilters} ${activeFilters === 1 ? "filter" : "filters"} active`;
  elements.clearInventoryFilters.disabled = activeFilters === 0;
  elements.inventoryList.replaceChildren(...rows.map(renderItem));
  elements.visibleCount.textContent = String(rows.length);
  elements.visibleLabel.textContent = rows.length === 1 ? "item" : "items";
  elements.emptyState.hidden = rows.length !== 0;
}

function inventorySelectionOptions() {
  return {
    query: elements.searchInput?.value,
    application: elements.applicationFilter?.value,
    kind: elements.kindFilter?.value,
    analysis: elements.analysisFilter?.value,
    confidence: elements.bestConfidenceFilter?.value,
    requiredCoverage: elements.requiredCoverageFilter?.value,
    providerEvidence: elements.providerEvidenceFilter?.value,
    profile: elements.profileFilter?.value,
    language: elements.policyLanguageFilter?.value,
    analysisAge: elements.analysisAgeFilter?.value,
    sort: elements.sortOrder?.value,
  };
}

function populateInventoryAnalysisFilters(rows) {
  const profileOptions = [...new Map(rows.flatMap((row) => row.analysis?.policyName ? [[row.analysis.policyName.toLocaleLowerCase(), row.analysis.policyName]] : [])).values()]
    .toSorted((left, right) => left.localeCompare(right));
  const languagesByCode = new Map();
  for (const language of rows.flatMap((row) => row.analysis?.languages ?? [])) {
    const key = language.code.toLocaleLowerCase();
    const existing = languagesByCode.get(key) ?? { code: language.code, requirements: new Set() };
    existing.requirements.add(language.required);
    languagesByCode.set(key, existing);
  }
  const languageOptions = [...languagesByCode.values()]
    .toSorted((left, right) => left.code.localeCompare(right.code));
  replaceScopedOptions(elements.profileFilter, "All analyzed profiles", "profile", profileOptions.map((label) => ({ label, value: label })));
  replaceScopedOptions(elements.policyLanguageFilter, "All analyzed languages", "language", languageOptions.map(({ code, requirements }) => ({
    label: `${code} · ${requirements.size > 1 ? "mixed requirements" : requirements.has(true) ? "required" : "optional"}`,
    value: code,
  })));
}

function replaceScopedOptions(select, allLabel, scope, options) {
  const previous = select.value;
  const next = [new Option(allLabel, "all"), ...options.map(({ label, value }) => new Option(label, `${scope}:${value}`))];
  select.replaceChildren(...next);
  select.value = next.some(({ value }) => value === previous) ? previous : "all";
}

function clearInventoryFilters() {
  elements.searchInput.value = "";
  elements.applicationFilter.value = "all";
  elements.kindFilter.value = "all";
  elements.analysisFilter.value = "all";
  elements.bestConfidenceFilter.value = "all";
  elements.requiredCoverageFilter.value = "all";
  elements.providerEvidenceFilter.value = "all";
  elements.profileFilter.value = "all";
  elements.policyLanguageFilter.value = "all";
  elements.analysisAgeFilter.value = "all";
  renderInventory();
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
    const endpoint = `/api/v1/library/items/${row.application}/${encodeURIComponent(row.instanceId)}/${row.kind}/${row.itemId}/feasibility${refresh ? "?refresh=1" : ""}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: libraryHeaders(),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 401) {
      clearLibraryAuthentication();
      clearPageEvidence();
      showAccess("Those credentials were not accepted. Check the configured login and try again.");
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
  const policySource = document.createElement("span");
  policySource.textContent = view.policySource === "bazarr"
    ? "Resolved from Bazarr"
    : view.policySource === "explicit_default"
      ? "Resolved from explicit default"
      : "Policy source unresolved";
  const languages = document.createElement("div");
  languages.className = "policy-languages";
  if (view.languages.length === 0) {
    const emptyLanguage = document.createElement("span");
    emptyLanguage.className = "policy-language-chip";
    emptyLanguage.textContent = "No policy languages";
    languages.append(emptyLanguage);
  } else {
    languages.replaceChildren(...view.languages.map(policyLanguageChip));
  }
  policy.append(policyLabel, policySource, languages);

  const analysis = document.createElement("div");
  analysis.className = `analysis-summary${view.analysis.source === "stale_cache" ? " analysis-summary--stale" : ""}`;
  const analysisSource = document.createElement("strong");
  analysisSource.textContent = view.analysis.source === "stale_cache"
    ? "Stale cached analysis"
    : view.analysis.source === "memory_cache"
      ? "Pegarr item cache"
      : view.policySource === "explicit_default"
        ? "Fresh Arr and Pegarr-policy analysis"
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
      if (provider.quota.windowSeconds !== undefined) {
        quota.textContent += provider.quota.windowSeconds === 1
          ? " per second"
          : ` per ${provider.quota.windowSeconds.toLocaleString()} seconds`;
      }
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
  populatePolicyLanguageFilter(view.languages);
  renderLeadingRelease(view.releases);
  elements.releaseControls.hidden = view.releases.length === 0;
  renderReleaseSelection();
}

function renderReleaseSelection() {
  const view = activeFeasibility;
  if (view === undefined) return;
  const releases = selectReleases(view.releases, {
    query: elements.releaseSearchInput?.value,
    decision: elements.releaseDecisionFilter?.value,
    confidence: elements.releaseConfidenceFilter?.value,
    protocol: elements.releaseProtocolFilter?.value,
    requiredFit: elements.releaseRequiredFitFilter?.value,
    language: elements.releaseLanguageFilter?.value,
    languageConfidence: elements.releaseLanguageConfidenceFilter?.value,
    sort: elements.releaseSortOrder?.value,
  });
  pruneShortlist(view.releases);
  elements.releaseTableBody.replaceChildren(...releases.map(renderRelease));
  renderShortlist(view.releases);
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
  tableRow.dataset.releaseId = row.id;
  tableRow.tabIndex = -1;
  tableRow.classList.toggle("release-row--shortlisted", shortlistedReleaseIds.has(row.id));
  const release = document.createElement("td");
  release.dataset.label = "Video release";
  const title = document.createElement("strong");
  title.textContent = row.title;
  const metadata = document.createElement("span");
  metadata.textContent = `${row.quality} · ${row.indexer} · ${row.protocol}`;
  release.append(title, metadata);
  const traits = [row.releaseGroup ? `Group ${row.releaseGroup}` : "", row.edition ?? ""].filter(Boolean);
  if (traits.length > 0) {
    const traitLine = document.createElement("span");
    traitLine.className = "release-traits";
    traitLine.textContent = traits.join(" · ");
    release.append(traitLine);
  }
  const facts = releaseFacts(row);
  if (facts.length > 0) {
    const factLine = document.createElement("span");
    factLine.className = "release-facts";
    factLine.textContent = facts.join(" · ");
    release.append(factLine);
  }

  const video = document.createElement("td");
  video.dataset.label = "Arr decision";
  const decision = document.createElement("span");
  decision.className = `decision-badge decision-badge--${row.downloadAllowed ? "accepted" : "rejected"}`;
  decision.textContent = row.downloadAllowed ? "Accepted" : "Rejected by Arr";
  const score = document.createElement("span");
  score.textContent = `Custom format ${row.customFormatScore}`;
  video.append(decision, score);
  if (row.customFormats.length > 0) {
    const formats = document.createElement("span");
    formats.textContent = `Formats: ${row.customFormats.join(", ")}`;
    video.append(formats);
  }
  if (row.arrLanguages.length > 0) {
    const arrLanguages = document.createElement("span");
    arrLanguages.textContent = `Arr languages: ${row.arrLanguages.join(", ")}`;
    video.append(arrLanguages);
  }
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
  const requiredFit = document.createElement("span");
  requiredFit.className = `required-fit-badge required-fit-badge--${row.requiredFit}`;
  requiredFit.textContent = requiredFitLabel(row.requiredFit);
  subtitle.append(confidence, requiredFit);
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

  const shortlistCell = document.createElement("td");
  shortlistCell.dataset.label = "Shortlist";
  const shortlist = document.createElement("button");
  shortlist.className = "shortlist-toggle";
  shortlist.type = "button";
  updateShortlistButton(shortlist, row);
  shortlist.addEventListener("click", () => toggleShortlist(row, tableRow, shortlist));
  shortlistCell.append(shortlist);
  const grabCell = document.createElement("td");
  grabCell.dataset.label = "Controlled Grab";
  const grab = document.createElement("button");
  grab.className = "grab-button";
  grab.type = "button";
  const grabAvailable = activeFeasibility?.controlledGrab === true;
  const currentEvidence = activeFeasibility?.analysis.source !== "stale_cache";
  grab.dataset.eligible = String(grabAvailable && row.downloadAllowed && currentEvidence);
  grab.disabled = grab.dataset.eligible !== "true" || pageBusy;
  grab.textContent = grabAvailable ? "Prepare Grab" : "Not enabled";
  grab.setAttribute("aria-label", grabAvailable
    ? `Prepare controlled Grab for ${row.title}`
    : "Controlled Grab is not enabled on this server");
  if (grabAvailable && !row.downloadAllowed) grab.title = "Sonarr or Radarr rejected this release";
  else if (grabAvailable && !currentEvidence) grab.title = "Refresh stale evidence before preparing a Grab";
  else if (grabAvailable) grab.addEventListener("click", () => openGrabDialog(row));
  grabCell.append(grab);
  tableRow.append(release, video, subtitle, evidenceCell, shortlistCell, grabCell);
  return tableRow;
}

function openGrabDialog(release) {
  if (selectedRow === undefined || activeFeasibility?.controlledGrab !== true || !release.downloadAllowed || activeFeasibility.analysis.source === "stale_cache") return;
  clearGrabDialog();
  grabContext = { row: selectedRow, release };
  elements.grabTarget.textContent = `${selectedRow.title} · ${selectedRow.context}`;
  elements.grabRelease.textContent = release.title;
  elements.grabDialog.showModal();
  elements.grabAdminToken.focus();
}

async function prepareControlledGrab() {
  if (grabContext === undefined) return;
  const candidate = elements.grabAdminToken.value;
  if (candidate.length < 32) {
    setGrabStatus("Enter the independent administrator token configured for controlled Grab.", "error");
    return;
  }
  administratorToken = candidate;
  elements.grabAdminToken.value = "";
  setGrabBusy(true);
  setGrabStatus("Revalidating the release with Sonarr or Radarr…", "loading");
  try {
    const { row, release } = grabContext;
    const endpoint = typeof row.grabEndpoint === "string"
      ? `${row.grabEndpoint}/prepare`
      : `/api/v1/library/items/${row.application}/${encodeURIComponent(row.instanceId)}/${row.kind}/${row.itemId}/grab/prepare`;
    const result = await grabRequest(
      endpoint,
      { releaseId: release.id },
    );
    if (result.response.status === 401) {
      administratorToken = undefined;
      elements.grabAuthStep.hidden = false;
      setGrabStatus("That administrator token was not accepted.", "error");
      elements.grabAdminToken.focus();
      return;
    }
    if (result.body?.status !== "confirmation_required") {
      setGrabStatus(prepareGrabMessage(result.body?.status, result.body?.detailCode), "error");
      return;
    }
    grabContext = { ...grabContext, challengeId: result.body.challengeId, confirmation: result.body.confirmation };
    elements.grabConfirmationPhrase.textContent = result.body.confirmation;
    elements.grabAuthStep.hidden = true;
    elements.grabConfirmStep.hidden = false;
    setGrabStatus("The release is still available and accepted by Arr. Exact confirmation is now required.", "warning");
    elements.grabConfirmation.focus();
  } catch {
    setGrabStatus("Pegarr could not revalidate the release. No Grab request was sent.", "error");
  } finally {
    setGrabBusy(false);
  }
}

async function executeControlledGrab() {
  if (grabContext?.challengeId === undefined || grabContext.confirmation === undefined || administratorToken === undefined) return;
  if (elements.grabConfirmation.value !== grabContext.confirmation) {
    setGrabStatus("The confirmation must match the displayed phrase exactly.", "error");
    return;
  }
  setGrabBusy(true);
  setGrabStatus("Revalidating once more, then asking Arr to Grab this release…", "loading");
  try {
    const { row, challengeId, confirmation } = grabContext;
    const endpoint = typeof row.grabEndpoint === "string"
      ? `${row.grabEndpoint}/execute`
      : `/api/v1/library/items/${row.application}/${encodeURIComponent(row.instanceId)}/${row.kind}/${row.itemId}/grab/execute`;
    const result = await grabRequest(
      endpoint,
      { challengeId, confirmation, idempotencyKey: crypto.randomUUID() },
    );
    if (result.response.status === 401) {
      setGrabStatus("Administrator authorization expired. Close this dialog and start again.", "error");
      return;
    }
    if (result.body?.status === "grabbed") {
      closeGrabDialog();
      setFeasibilityNotice("Sonarr or Radarr accepted the controlled Grab. The request was recorded in Pegarr's audit history.", "success");
      return;
    }
    if (result.body?.status === "timeout_unknown") {
      setGrabStatus("The Arr request timed out, so the result is Unknown. Check Arr activity before retrying; Pegarr has blocked a duplicate for the reconciliation window.", "warning");
      return;
    }
    setGrabStatus(executeGrabMessage(result.body?.status), result.response.status >= 500 ? "error" : "warning");
  } catch {
    setGrabStatus("Pegarr could not determine the Grab result. Check Arr activity before trying again.", "error");
  } finally {
    setGrabBusy(false);
  }
}

async function grabRequest(endpoint, body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${administratorToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  let result;
  try {
    result = await response.json();
  } catch {
    result = undefined;
  }
  return { response, body: result };
}

function prepareGrabMessage(status, detailCode) {
  if (detailCode === "continuation_missing_or_expired") return "This catalog continuation expired. Add or search the title again before preparing a Grab.";
  if (detailCode === "scope_not_grabbable") return "Only an exact movie or episode can prepare a controlled Grab. Season analysis remains read-only.";
  const messages = {
    item_unavailable: "This item is no longer present in Pegarr's bounded missing inventory.",
    release_changed: "Arr no longer returns this exact release. Refresh the analysis before choosing another candidate.",
    release_rejected: "Arr now rejects this release, so Pegarr will not Grab it.",
    integration_failure: "Arr could not revalidate the release. No Grab request was sent.",
  };
  return messages[status] ?? "Pegarr could not prepare this controlled Grab.";
}

function executeGrabMessage(status) {
  const messages = {
    challenge_expired: "This confirmation expired. Close the dialog and prepare the release again.",
    confirmation_mismatch: "The confirmation did not match exactly. No Grab request was sent.",
    duplicate_blocked: "A recent or uncertain Grab already exists for this target and release. Reconcile it in Arr before retrying.",
    duplicate_in_progress: "This Grab is already in progress.",
    revalidation_failed: "The release changed or became rejected before execution. No Grab request was sent.",
    upstream_failure: "Arr rejected or could not complete the Grab request. Review Arr before trying again.",
  };
  return messages[status] ?? "Pegarr did not complete the controlled Grab.";
}

function setGrabBusy(value) {
  elements.grabPrepare.disabled = value;
  elements.grabExecute.disabled = value || elements.grabConfirmation.value !== grabContext?.confirmation;
  elements.grabAdminToken.disabled = value;
  elements.grabConfirmation.disabled = value;
  elements.grabClose.disabled = value;
  elements.grabDialog.setAttribute("aria-busy", String(value));
}

function setGrabStatus(message, state) {
  elements.grabStatus.textContent = message;
  elements.grabStatus.dataset.state = state;
}

function closeGrabDialog() {
  if (elements.grabDialog.open) elements.grabDialog.close();
  else clearGrabDialog();
}

function clearGrabDialog() {
  administratorToken = undefined;
  grabContext = undefined;
  elements.grabAdminToken.value = "";
  elements.grabConfirmation.value = "";
  elements.grabConfirmationPhrase.textContent = "";
  elements.grabTarget.textContent = "";
  elements.grabRelease.textContent = "";
  elements.grabAuthStep.hidden = false;
  elements.grabConfirmStep.hidden = true;
  elements.grabExecute.disabled = true;
  setGrabStatus("", "");
}

function openGrabHistory() {
  clearGrabHistory();
  elements.grabHistoryDialog.showModal();
  elements.grabHistoryToken.focus();
}

function closeGrabHistory() {
  if (elements.grabHistoryDialog.open) elements.grabHistoryDialog.close();
  else clearGrabHistory();
}

function clearGrabHistory() {
  historyAdministratorToken = undefined;
  reconciliationContext = undefined;
  elements.grabHistoryToken.value = "";
  elements.grabHistoryAuth.hidden = false;
  elements.grabHistoryResults.hidden = true;
  elements.grabHistoryList.replaceChildren();
  clearReconciliation();
  setGrabHistoryStatus("", "");
  setGrabHistoryBusy(false);
}

async function loadGrabHistory() {
  if (historyAdministratorToken === undefined) {
    const candidate = elements.grabHistoryToken.value;
    if (candidate.length < 32) {
      setGrabHistoryStatus("Enter the independent administrator token configured for controlled Grab.", "error");
      return;
    }
    historyAdministratorToken = candidate;
    elements.grabHistoryToken.value = "";
  }
  setGrabHistoryBusy(true);
  setGrabHistoryStatus("Loading bounded audit history…", "loading");
  try {
    const response = await fetch("/api/v1/grabs/history?limit=50", {
      method: "GET",
      headers: { authorization: `Bearer ${historyAdministratorToken}` },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 401) {
      historyAdministratorToken = undefined;
      elements.grabHistoryAuth.hidden = false;
      elements.grabHistoryResults.hidden = true;
      setGrabHistoryStatus("That administrator token was not accepted.", "error");
      elements.grabHistoryToken.focus();
      return;
    }
    if (response.status === 404) {
      historyAdministratorToken = undefined;
      setGrabHistoryStatus("Controlled Grab is not enabled on this server.", "warning");
      return;
    }
    if (!response.ok) throw new Error("history_unavailable");
    const result = await response.json();
    const events = Array.isArray(result.events) ? result.events : [];
    renderGrabHistory(events);
    elements.grabHistoryAuth.hidden = true;
    elements.grabHistoryResults.hidden = false;
    setGrabHistoryStatus(events.length === 1 ? "Loaded 1 audit event." : `Loaded ${events.length} audit events.`, "success");
  } catch {
    setGrabHistoryStatus("Pegarr could not load the controlled Grab history.", "error");
  } finally {
    setGrabHistoryBusy(false);
  }
}

function renderGrabHistory(events) {
  const nodes = events.map((auditEvent) => {
    const card = document.createElement("article");
    card.className = "grab-history-event";
    const heading = document.createElement("div");
    heading.className = "grab-history-event-heading";
    const title = document.createElement("strong");
    title.textContent = auditEvent.targetLabel ?? "Unknown target";
    const status = document.createElement("span");
    status.className = "grab-history-status-chip";
    status.dataset.state = auditEvent.status ?? "unknown";
    status.textContent = grabAuditStatusLabel(auditEvent);
    heading.append(title, status);
    const release = document.createElement("span");
    release.className = "grab-history-release";
    release.textContent = auditEvent.releaseTitle ?? "Unknown release";
    const timing = document.createElement("small");
    timing.textContent = `Requested ${formatAuditTime(auditEvent.requestedAt)}`;
    card.append(heading, release, timing);
    if (auditEvent.status === "timeout_unknown" && auditEvent.reconciliationOutcome === undefined && auditEvent.reconciliationConfirmations) {
      const reconcile = document.createElement("button");
      reconcile.className = "quiet-button";
      reconcile.type = "button";
      reconcile.textContent = "Reconcile Unknown outcome";
      reconcile.addEventListener("click", () => openReconciliation(auditEvent));
      card.append(reconcile);
    }
    return card;
  });
  if (nodes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "grab-history-empty";
    empty.textContent = "No controlled Grab events have been recorded yet.";
    nodes.push(empty);
  }
  elements.grabHistoryList.replaceChildren(...nodes);
}

function grabAuditStatusLabel(auditEvent) {
  if (auditEvent.status === "timeout_unknown" && auditEvent.reconciliationOutcome === "grabbed") return "Unknown · verified grabbed";
  if (auditEvent.status === "timeout_unknown" && auditEvent.reconciliationOutcome === "not_grabbed") return "Unknown · verified not grabbed";
  const labels = {
    in_progress: "In progress",
    grabbed: "Grabbed",
    revalidation_failed: "Revalidation stopped",
    timeout_unknown: "Unknown · needs reconciliation",
    upstream_failure: "Upstream failure",
  };
  return labels[auditEvent.status] ?? "Unknown status";
}

function formatAuditTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "at an unknown time" : date.toLocaleString();
}

function openReconciliation(auditEvent) {
  reconciliationContext = auditEvent;
  elements.grabReconcileTarget.textContent = auditEvent.targetLabel;
  elements.grabReconcileRelease.textContent = auditEvent.releaseTitle;
  elements.grabReconcileStep.hidden = false;
  elements.grabReconcileOutcome.value = "";
  elements.grabReconcileConfirmation.value = "";
  updateReconciliationConfirmation();
  elements.grabReconcileStep.scrollIntoView({ block: "start" });
  elements.grabReconcileOutcome.focus();
}

function clearReconciliation() {
  reconciliationContext = undefined;
  elements.grabReconcileStep.hidden = true;
  elements.grabReconcileOutcome.value = "";
  elements.grabReconcileConfirmation.value = "";
  elements.grabReconcilePhrase.textContent = "";
  elements.grabReconcileTarget.textContent = "";
  elements.grabReconcileRelease.textContent = "";
  elements.grabReconcileSubmit.disabled = true;
}

function updateReconciliationConfirmation() {
  const outcome = elements.grabReconcileOutcome.value;
  const confirmations = reconciliationContext?.reconciliationConfirmations;
  const phrase = outcome === "grabbed" ? confirmations?.grabbed : outcome === "not_grabbed" ? confirmations?.notGrabbed : "";
  elements.grabReconcilePhrase.textContent = phrase ?? "";
  elements.grabReconcileSubmit.disabled = !phrase || elements.grabReconcileConfirmation.value !== phrase;
}

async function submitReconciliation() {
  const outcome = elements.grabReconcileOutcome.value;
  const confirmation = elements.grabReconcilePhrase.textContent;
  if (reconciliationContext === undefined || historyAdministratorToken === undefined || !confirmation || elements.grabReconcileConfirmation.value !== confirmation) return;
  setGrabHistoryBusy(true);
  setGrabHistoryStatus("Recording the verified Arr outcome…", "loading");
  try {
    const response = await fetch(`/api/v1/grabs/${encodeURIComponent(reconciliationContext.eventId)}/reconcile`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${historyAdministratorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome, confirmation }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const result = await response.json().catch(() => undefined);
    if (response.status === 401) {
      historyAdministratorToken = undefined;
      clearReconciliation();
      elements.grabHistoryAuth.hidden = false;
      elements.grabHistoryResults.hidden = true;
      setGrabHistoryStatus("Administrator authorization was not accepted. Reconnect to the audit history.", "error");
      return;
    }
    if (result?.status !== "reconciled") {
      setGrabHistoryStatus(response.status === 409
        ? "This event changed or the exact confirmation did not match. Refresh the history before trying again."
        : "Pegarr could not record the reconciliation.", response.status >= 500 ? "error" : "warning");
      return;
    }
    clearReconciliation();
    await loadGrabHistory();
    setGrabHistoryStatus("The original Unknown result is preserved and the verified Arr outcome is now audited.", "success");
  } catch {
    setGrabHistoryStatus("Pegarr could not record the reconciliation. No audit outcome was changed.", "error");
  } finally {
    setGrabHistoryBusy(false);
  }
}

function setGrabHistoryBusy(value) {
  for (const control of [elements.grabHistoryClose, elements.grabHistoryLoad, elements.grabHistoryRefresh, elements.grabHistoryToken, elements.grabReconcileOutcome, elements.grabReconcileConfirmation, elements.grabReconcileCancel]) {
    control.disabled = value;
  }
  elements.grabReconcileSubmit.disabled = value || elements.grabReconcileConfirmation.value !== elements.grabReconcilePhrase.textContent || !elements.grabReconcilePhrase.textContent;
  elements.grabHistoryDialog.setAttribute("aria-busy", String(value));
}

function setGrabHistoryStatus(message, state) {
  elements.grabHistoryStatus.textContent = message;
  elements.grabHistoryStatus.dataset.state = state;
}

function policyLanguageChip(language) {
  const chip = document.createElement("span");
  chip.className = "policy-language-chip";
  const traits = [
    language.required ? "required" : "optional",
    language.forced ? "forced" : "regular",
    `HI ${language.hearingImpaired.replaceAll("_", " ")}`,
    language.applicability ? language.applicability.replaceAll("_", " ") : "applicability unspecified",
    language.cutoff === true ? "cutoff" : language.cutoff === false ? "not cutoff" : "cutoff unspecified",
  ];
  chip.textContent = `${language.code} · ${traits.join(" · ")}`;
  return chip;
}

function populatePolicyLanguageFilter(languages) {
  const previous = elements.releaseLanguageFilter.value;
  const options = [new Option("All policy languages", "all")];
  for (const language of languages) options.push(new Option(`${language.code}${language.required ? " · required" : " · optional"}`, language.code));
  elements.releaseLanguageFilter.replaceChildren(...options);
  elements.releaseLanguageFilter.value = options.some(({ value }) => value === previous) ? previous : "all";
}

function renderLeadingRelease(releases) {
  const leading = leadingRelease(releases);
  elements.releaseLeading.hidden = leading === undefined;
  if (leading === undefined) {
    elements.releaseLeadingTitle.textContent = "";
    elements.releaseLeadingDetail.textContent = "";
    return;
  }
  elements.releaseLeadingTitle.textContent = leading.title;
  elements.releaseLeadingDetail.textContent = [
    confidenceLabel(leading.confidence),
    requiredFitLabel(leading.requiredFit),
    `custom format ${leading.customFormatScore}`,
    ...releaseFacts(leading),
  ].join(" · ");
}

function requiredFitLabel(value) {
  const labels = {
    strong: "Required languages strong",
    possible: "Required languages possible",
    no_match_found: "Required languages no match",
    unknown: "Required languages unknown",
    no_required_languages: "No required languages",
  };
  return labels[value] ?? "Required languages unknown";
}

function releaseFacts(row) {
  return [
    row.sizeBytes === undefined ? "" : formatBytes(row.sizeBytes),
    row.ageHours === undefined ? "" : formatAge(row.ageHours),
    row.seeders === undefined ? "" : `${row.seeders.toLocaleString()} ${row.seeders === 1 ? "seeder" : "seeders"}`,
    row.leechers === undefined ? "" : `${row.leechers.toLocaleString()} ${row.leechers === 1 ? "leecher" : "leechers"}`,
  ].filter(Boolean);
}

function toggleShortlist(row, tableRow, button) {
  const removing = shortlistedReleaseIds.has(row.id);
  if (removing) shortlistedReleaseIds.delete(row.id);
  else if (shortlistedReleaseIds.size >= 3) {
    setFeasibilityNotice("The page-memory shortlist holds up to 3 releases. Remove one before adding another.", "warning");
    return;
  } else shortlistedReleaseIds.add(row.id);
  tableRow.classList.toggle("release-row--shortlisted", shortlistedReleaseIds.has(row.id));
  updateShortlistButton(button, row);
  renderShortlist(activeFeasibility?.releases ?? []);
  setFeasibilityNotice(
    `Release ${removing ? "removed from" : "added to"} the page-memory comparison. No provider request was made.`,
    "success",
  );
}

function updateShortlistButton(button, row) {
  const selected = shortlistedReleaseIds.has(row.id);
  button.setAttribute("aria-pressed", String(selected));
  button.setAttribute("aria-label", `${selected ? "Remove" : "Add"} ${row.title} ${selected ? "from" : "to"} shortlist`);
  button.textContent = selected ? "Remove" : "Shortlist";
}

function renderShortlist(releases) {
  const comparison = releaseComparison(releases, [...shortlistedReleaseIds]);
  const rows = comparison.candidates;
  elements.releaseShortlist.hidden = releases.length === 0;
  elements.releaseShortlistCount.textContent = `${rows.length} of 3 selected`;
  elements.releaseShortlistClear.hidden = rows.length === 0;
  if (rows.length === 0) {
    const guidance = document.createElement("p");
    guidance.className = "release-comparison-guidance";
    guidance.textContent = "Shortlist up to three releases to compare Arr decisions, subtitle evidence, and release metadata side by side.";
    elements.releaseShortlistItems.replaceChildren(guidance);
    return;
  }
  const guidance = document.createElement("p");
  guidance.className = "release-comparison-guidance";
  guidance.textContent = rows.length === 1
    ? "Choose at least one more release to reveal relative evidence markers."
    : "Stronger markers compare one field at a time. They are not an automatic release recommendation.";
  elements.releaseShortlistItems.replaceChildren(guidance, comparisonTable(comparison));
}

function comparisonTable(comparison) {
  const wrap = document.createElement("div");
  wrap.className = "release-comparison-wrap";
  const table = document.createElement("table");
  table.className = "release-comparison";
  const caption = document.createElement("caption");
  caption.textContent = "Side-by-side comparison of shortlisted releases";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  const attribute = document.createElement("th");
  attribute.scope = "col";
  attribute.textContent = "Evidence";
  headRow.append(attribute, ...comparison.candidates.map(comparisonHeading));
  head.append(headRow);
  const body = document.createElement("tbody");
  body.append(
    comparisonRow("Arr decision", comparison.candidates, (candidate) => arrDecisionComparison(candidate)),
    comparisonRow("Subtitle confidence", comparison.candidates, (candidate) => comparisonValue(confidenceLabel(candidate.confidence), candidate.strengths.subtitleConfidence)),
    comparisonRow("Required-language fit", comparison.candidates, (candidate) => comparisonValue(requiredFitLabel(candidate.requiredFit), candidate.strengths.requiredFit)),
    ...comparison.languages.map((language) => comparisonRow(
      `${language.code} · ${language.required ? "required" : "optional"}`,
      language.assessments,
      (assessment) => languageComparison(assessment),
    )),
    comparisonRow("Video metadata", comparison.candidates, (candidate) => comparisonValue([
      candidate.quality,
      candidate.protocol,
      candidate.releaseGroup ? `Group ${candidate.releaseGroup}` : "",
      candidate.edition ?? "",
    ].filter(Boolean).join(" · "))),
    comparisonRow("Custom format score", comparison.candidates, (candidate) => comparisonValue(candidate.customFormatScore.toLocaleString(), candidate.strengths.customFormatScore)),
    comparisonRow("Seeders", comparison.candidates, (candidate) => comparisonValue(candidate.seeders?.toLocaleString() ?? "Unknown", candidate.strengths.seeders)),
    comparisonRow("Release age", comparison.candidates, (candidate) => comparisonValue(candidate.ageHours === undefined ? "Unknown" : formatAge(candidate.ageHours), candidate.strengths.age)),
    comparisonRow("Size", comparison.candidates, (candidate) => comparisonValue(candidate.sizeBytes === undefined ? "Unknown" : formatBytes(candidate.sizeBytes))),
  );
  table.append(caption, head, body);
  wrap.append(table);
  return wrap;
}

function comparisonHeading(candidate) {
  const heading = document.createElement("th");
  heading.scope = "col";
  const title = document.createElement("strong");
  title.textContent = candidate.title;
  const actions = document.createElement("div");
  actions.className = "release-comparison-actions";
  const show = document.createElement("button");
  show.className = "comparison-action";
  show.type = "button";
  show.textContent = "Show release";
  show.setAttribute("aria-label", `Show ${candidate.title} in the release table`);
  show.addEventListener("click", () => showReleaseInTable(candidate.id));
  const remove = document.createElement("button");
  remove.className = "comparison-action comparison-action--remove";
  remove.type = "button";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", `Remove ${candidate.title} from comparison`);
  remove.addEventListener("click", () => removeFromShortlist(candidate.id));
  actions.append(show, remove);
  heading.append(title, actions);
  return heading;
}

function comparisonRow(label, values, renderValue) {
  const row = document.createElement("tr");
  const heading = document.createElement("th");
  heading.scope = "row";
  heading.textContent = label;
  row.append(heading, ...values.map(renderValue));
  return row;
}

function arrDecisionComparison(candidate) {
  const cell = comparisonValue(candidate.downloadAllowed ? "Accepted by Arr" : "Rejected by Arr");
  cell.classList.add(candidate.downloadAllowed ? "comparison-cell--accepted" : "comparison-cell--rejected");
  for (const message of candidate.rejectionReasons) {
    const reason = document.createElement("span");
    reason.className = "comparison-rejection";
    reason.textContent = message;
    cell.append(reason);
  }
  return cell;
}

function languageComparison(assessment) {
  const value = comparisonValue(
    `${confidenceLabel(assessment.confidence)} · ${assessment.providerCount} ${assessment.providerCount === 1 ? "provider" : "providers"}`,
    assessment.strongest,
  );
  if (assessment.evidence !== undefined) {
    const evidence = document.createElement("span");
    evidence.textContent = `${assessment.evidence.provider}: ${assessment.evidence.releaseName}`;
    value.append(evidence);
  }
  for (const message of assessment.warnings) {
    const warning = document.createElement("span");
    warning.className = "comparison-warning";
    warning.textContent = message;
    value.append(warning);
  }
  return value;
}

function comparisonValue(text, strongest = false) {
  const cell = document.createElement("td");
  const value = document.createElement("span");
  value.textContent = text;
  cell.append(value);
  if (strongest) {
    cell.classList.add("comparison-cell--stronger");
    const marker = document.createElement("span");
    marker.className = "comparison-strength";
    marker.textContent = "Stronger evidence";
    cell.append(marker);
  }
  return cell;
}

function removeFromShortlist(releaseId) {
  shortlistedReleaseIds.delete(releaseId);
  syncShortlistButtons();
  renderShortlist(activeFeasibility?.releases ?? []);
  setFeasibilityNotice("Release removed from the page-memory comparison.", "success");
}

function showReleaseInTable(releaseId) {
  clearReleaseFilters();
  renderReleaseSelection();
  const row = [...elements.releaseTableBody.children].find(({ dataset }) => dataset.releaseId === releaseId);
  row?.focus();
  row?.scrollIntoView({ block: "center" });
  setFeasibilityNotice("Release filters cleared and the selected comparison row is focused. No provider request was made.", "success");
}

function clearReleaseFilters() {
  elements.releaseSearchInput.value = "";
  elements.releaseDecisionFilter.value = "all";
  elements.releaseConfidenceFilter.value = "all";
  elements.releaseProtocolFilter.value = "all";
  elements.releaseRequiredFitFilter.value = "all";
  elements.releaseLanguageFilter.value = "all";
  elements.releaseLanguageConfidenceFilter.value = "all";
}

function pruneShortlist(releases) {
  const currentIds = new Set(releases.map(({ id }) => id));
  for (const id of shortlistedReleaseIds) if (!currentIds.has(id)) shortlistedReleaseIds.delete(id);
}

function clearShortlist() {
  shortlistedReleaseIds.clear();
  syncShortlistButtons();
  renderShortlist(activeFeasibility?.releases ?? []);
  setFeasibilityNotice("Page-memory comparison cleared. No provider request was made.", "success");
}

function syncShortlistButtons() {
  for (const row of document.querySelectorAll(".release-row--shortlisted")) row.classList.remove("release-row--shortlisted");
  for (const button of document.querySelectorAll(".shortlist-toggle")) {
    const row = activeFeasibility?.releases.find(({ id }) => id === button.closest("tr")?.dataset.releaseId);
    if (row !== undefined) {
      button.closest("tr")?.classList.toggle("release-row--shortlisted", shortlistedReleaseIds.has(row.id));
      updateShortlistButton(button, row);
    }
  }
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
  closeGrabDialog();
  selectedRow = undefined;
  activeFeasibility = undefined;
  elements.feasibilityPanel.hidden = true;
  elements.releaseTableBody.replaceChildren();
  elements.releaseControls.hidden = true;
  elements.releaseLeading.hidden = true;
  shortlistedReleaseIds.clear();
  elements.releaseShortlist.hidden = true;
  elements.releaseShortlistItems.replaceChildren();
  elements.feasibilitySummary.replaceChildren();
}

function resetReleaseControls() {
  elements.releaseSearchInput.value = "";
  elements.releaseDecisionFilter.value = "all";
  elements.releaseConfidenceFilter.value = "all";
  elements.releaseProtocolFilter.value = "all";
  elements.releaseRequiredFitFilter.value = "all";
  elements.releaseLanguageFilter.replaceChildren(new Option("All policy languages", "all"));
  elements.releaseLanguageConfidenceFilter.value = "all";
  elements.releaseSortOrder.value = "recommended";
  shortlistedReleaseIds.clear();
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
  elements.loginUsername.disabled = value;
  elements.loginPassword.disabled = value;
  elements.subtitleSettingsSave.disabled = value;
  elements.dashboard?.setAttribute("aria-busy", String(value));
  elements.feasibilityPanel?.setAttribute("aria-busy", String(value));
  for (const button of document.querySelectorAll(".inventory-select")) button.disabled = value;
  for (const button of document.querySelectorAll(".shortlist-toggle")) button.disabled = value;
  for (const button of document.querySelectorAll(".grab-button")) button.disabled = value || button.dataset.eligible !== "true";
  elements.releaseShortlistClear.disabled = value;
  elements.feasibilityRefresh.disabled = value;
}

function setStatus(message, state) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.state = state;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatBytes(value) {
  if (value < 1_000) return `${value.toLocaleString()} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let unit = -1;
  do {
    size /= 1_000;
    unit += 1;
  } while (size >= 1_000 && unit < units.length - 1);
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unit]}`;
}

function formatAge(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min old`;
  if (hours < 24) return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} h old`;
  const days = hours / 24;
  return `${days >= 10 ? Math.round(days) : days.toFixed(1)} d old`;
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Integration";
}
