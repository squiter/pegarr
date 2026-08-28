import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import type { FeasibilityReport } from "./domain.js";
import { AccessControl } from "./access-control.js";
import { SecretValue } from "./config.js";
import { healthResponse, readinessResponse, resolveRoute } from "./app.js";
import type { RuntimeServices } from "./runtime.js";

test("PEG-OPS-001 liveness is healthy", () => {
  assert.deepEqual(healthResponse(), {
    statusCode: 200,
    body: { service: "pegarr", status: "ok" },
  });
});

test("PEG-OPS-002 readiness requires an accessible data directory", async () => {
  assert.equal((await readinessResponse(tmpdir())).statusCode, 200);
  assert.equal(
    (await readinessResponse(`${tmpdir()}/pegarr-directory-that-does-not-exist`)).statusCode,
    503,
  );
});

test("PEG-API-001 health routes reject mutations", async () => {
  const result = await resolveRoute("POST", "/health", tmpdir());

  assert.equal(result.statusCode, 405);
  assert.deepEqual(result.headers, { allow: "GET" });
});

test("PEG-API-002 fixture-backed feasibility route is read-only and explainable", async () => {
  const result = await resolveRoute("GET", "/api/v1/feasibility/demo", tmpdir());
  const report = result.body as FeasibilityReport;

  assert.equal(result.statusCode, 200);
  assert.equal(report.mode, "read_only");
  assert.equal(report.fixture, "synthetic-sonarr-episode-v1");
  assert.equal(report.releases[0]?.video.evidence.application, "sonarr");
  assert.equal(report.releases[0]?.subtitle.languages[0]?.evidence?.reasons[0], "Exact normalized release name");
  assert.doesNotMatch(JSON.stringify(report), /synthetic-guid|downloadUrl|magnetUrl/iu);
  assert.equal((await resolveRoute("POST", "/api/v1/feasibility/demo", tmpdir())).statusCode, 405);
});

test("PEG-API-003 unknown routes return a generic response", async () => {
  const result = await resolveRoute("GET", "/does-not-exist?token=secret", tmpdir());

  assert.deepEqual(result, {
    statusCode: 404,
    body: { service: "pegarr", status: "not_found" },
  });
});

test("PEG-RUNTIME-002 Sonarr status is read-only and disabled without configuration", async () => {
  const result = await resolveRoute(
    "GET",
    "/api/v1/integrations/sonarr/status",
    tmpdir(),
  );
  assert.deepEqual(result, {
    statusCode: 200,
    body: {
      service: "pegarr",
      integration: "sonarr",
      mode: "read_only",
      configured: false,
      state: "disabled",
    },
  });
  assert.equal(
    (await resolveRoute("POST", "/api/v1/integrations/sonarr/status", tmpdir())).statusCode,
    405,
  );
});

test("PEG-RUNTIME-007 Radarr status is read-only and disabled without configuration", async () => {
  const result = await resolveRoute(
    "GET",
    "/api/v1/integrations/radarr/status",
    tmpdir(),
  );
  assert.deepEqual(result, {
    statusCode: 200,
    body: {
      service: "pegarr",
      integration: "radarr",
      mode: "read_only",
      configured: false,
      state: "disabled",
    },
  });
  assert.equal(
    (await resolveRoute("POST", "/api/v1/integrations/radarr/status", tmpdir())).statusCode,
    405,
  );
});

test("PEG-ACCESS-002 protected inventory stays hidden or unauthorized without upstream work", async () => {
  let inventoryReads = 0;
  const services = fakeServices(async () => {
    inventoryReads += 1;
    return { kind: "missing-item-inventory", mode: "read_only", status: "disabled" };
  });
  const unconfigured = await resolveRoute(
    "GET",
    "/api/v1/library/missing?token=unsafe",
    tmpdir(),
    services,
    { control: new AccessControl(undefined) },
  );
  assert.deepEqual(unconfigured, {
    statusCode: 404,
    body: { service: "pegarr", status: "not_found" },
  });
  assert.equal(
    (await resolveRoute(
      "POST",
      "/api/v1/library/missing",
      tmpdir(),
      services,
      { control: new AccessControl(undefined) },
    )).statusCode,
    404,
  );

  const access = new AccessControl(new SecretValue("synthetic-access-token-value-0000000001"));
  const unauthorized = await resolveRoute(
    "GET",
    "/api/v1/library/missing",
    tmpdir(),
    services,
    { control: access, authorization: "Bearer wrong-token-value-000000000000000" },
  );
  assert.equal(unauthorized.statusCode, 401);
  assert.deepEqual(unauthorized.headers, {
    "www-authenticate": 'Bearer realm="pegarr", charset="UTF-8"',
  });
  assert.equal(inventoryReads, 0);
  assert.doesNotMatch(JSON.stringify([unconfigured, unauthorized]), /unsafe|wrong-token/iu);
});

test("PEG-ACCESS-003 authorized inventory is read-only and rejects mutation methods", async () => {
  const token = "synthetic-access-token-value-0000000001";
  let inventoryReads = 0;
  const services = fakeServices(async () => {
    inventoryReads += 1;
    return { kind: "missing-item-inventory", mode: "read_only", status: "disabled" };
  });
  const access = { control: new AccessControl(new SecretValue(token)), authorization: `Bearer ${token}` };
  const response = await resolveRoute(
    "GET",
    "/api/v1/library/missing",
    tmpdir(),
    services,
    access,
  );
  const mutation = await resolveRoute(
    "POST",
    "/api/v1/library/missing",
    tmpdir(),
    services,
    access,
  );

  assert.deepEqual(response, {
    statusCode: 200,
    body: { kind: "missing-item-inventory", mode: "read_only", status: "disabled" },
  });
  assert.equal(mutation.statusCode, 405);
  assert.equal(inventoryReads, 1);
});

test("PEG-ACCESS-004 item feasibility is hidden, authenticated before work, and read-only", async () => {
  const token = "synthetic-access-token-value-0000000001";
  let feasibilityReads = 0;
  const refreshValues: boolean[] = [];
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  services.readItemFeasibility = async (selection, options) => {
    feasibilityReads += 1;
    refreshValues.push(options?.refresh === true);
    return { kind: "item-feasibility", mode: "read_only", status: "not_found", selection };
  };
  const path = "/api/v1/library/items/sonarr/episode/305/feasibility";

  assert.equal((await resolveRoute("GET", path, tmpdir(), services, { control: new AccessControl(undefined) })).statusCode, 404);
  assert.equal((await resolveRoute("GET", `${path}?refresh=1`, tmpdir(), services, { control: new AccessControl(new SecretValue(token)), authorization: "Bearer wrong-token-value-000000000000000" })).statusCode, 401);
  assert.equal(feasibilityReads, 0);

  const access = { control: new AccessControl(new SecretValue(token)), authorization: `Bearer ${token}` };
  assert.equal((await resolveRoute("GET", path, tmpdir(), services, access)).statusCode, 404);
  assert.equal((await resolveRoute("GET", `${path}?refresh=1`, tmpdir(), services, access)).statusCode, 404);
  assert.equal((await resolveRoute("POST", path, tmpdir(), services, access)).statusCode, 405);
  assert.equal(feasibilityReads, 2);
  assert.deepEqual(refreshValues, [false, true]);
  assert.equal((await resolveRoute("GET", "/api/v1/library/items/sonarr/movie/305/feasibility", tmpdir(), services, access)).statusCode, 404);
});

test("PEG-DASH-003 dashboard routes are accessible, responsive, and secret-safe", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());

  assert.equal(page.statusCode, 200);
  assert.equal(page.headers?.["content-type"], "text/html; charset=utf-8");
  assert.match(page.headers?.["content-security-policy"] ?? "", /default-src 'self'/u);
  assert.match(String(page.body), /<main id="main"|role="status"|aria-live="polite"/u);
  assert.match(String(page.body), /release-table|feasibility-panel|visible-label|No Grab actions/u);
  assert.match(String(page.body), /release-decision-filter|release-confidence-filter|release-sort-order/u);
  assert.match(String(page.body), /type="password"|autocomplete="off"/u);
  assert.match(String(styles.body), /@media \(max-width: 760px\)|prefers-reduced-motion/u);
  assert.match(String(client.body), /authorization: `Bearer \$\{accessToken\}`|credentials: "omit"/u);
  assert.match(String(client.body), /textContent|replaceChildren/u);
  assert.match(String(client.body), /\/api\/v1\/library\/items\/\$\{row\.application\}|feasibilityCache/u);
  assert.match(String(client.body), /refresh=1/u);
  assert.match(String(client.body), /Stale cached analysis|stale_cache/u);
  assert.match(String(client.body), /selectReleases|make no new provider requests/u);
  assert.match(String(styles.body), /analysis-summary--stale/u);
  assert.match(String(styles.body), /release-controls/u);
  assert.match(String(model.body), /export function selectRows/u);
  assert.match(String(model.body), /export function selectReleases/u);
  assert.equal(client.headers?.["cache-control"], "no-cache");
  assert.doesNotMatch(
    [page.body, client.body, model.body, styles.body].join("\n"),
    /localStor(?:age)|sessionStor(?:age)|document\.cookie|innerHTML|PEGARR_ACCESS_TOKEN/iu,
  );
  assert.equal((await resolveRoute("POST", "/", tmpdir())).statusCode, 405);
});

test("PEG-DASH-010 analyzed-item cards and controls remain page-memory-only assets", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, model.body, styles.body].join("\n");

  assert.match(String(page.body), /analysis-filter|best-confidence-filter|confidence-desc|analyzed-desc/u);
  assert.match(String(client.body), /analysisByItem|rememberAnalysis|renderItemAnalysis/u);
  assert.match(String(model.body), /itemAnalysisSummary|rowsWithAnalysis|needs_attention/u);
  assert.match(String(styles.body), /item-analysis-badge|item-analysis-detail/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie/iu);
  assert.doesNotMatch(assets, /\/grab|Grab selected release/iu);
});

test("PEG-DASH-013 required-language and provider-health controls remain local dashboard assets", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, model.body, styles.body].join("\n");

  assert.match(String(page.body), /required-coverage-filter|provider-evidence-filter/u);
  assert.match(String(client.body), /requiredCoverageLabel|providerEvidenceLabel|requiredLanguages|providerFailures/u);
  assert.match(String(model.body), /summarizeRequiredCoverage|summarizeProviderEvidence|matchesProviderEvidence/u);
  assert.match(String(styles.body), /coverage-strong|provider-partial|provider-unavailable/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie/iu);
  assert.doesNotMatch(assets, /\/grab|Grab selected release/iu);
});

test("PEG-DASH-019 richer release controls and shortlist remain page-memory-only assets", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, model.body, styles.body].join("\n");

  assert.match(String(page.body), /release-search-input|release-protocol-filter|seeders-desc|size-asc|age-asc/u);
  assert.match(String(page.body), /release-shortlist|release-shortlist-count|Clear shortlist/u);
  assert.match(String(client.body), /shortlistedReleaseIds|toggleShortlist|releaseFacts|formatBytes|formatAge/u);
  assert.match(String(model.body), /releaseSearchText|compareOptionalReleaseNumber|shortlistedReleases/u);
  assert.match(String(styles.body), /release-row--shortlisted|shortlist-toggle|release-shortlist-items/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie/iu);
  assert.doesNotMatch(assets, /\/grab|Grab selected release/iu);
});

test("PEG-DASH-025 policy semantics, language fit, and leading candidate remain page-memory-only assets", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, model.body, styles.body].join("\n");

  assert.match(String(page.body), /release-required-fit-filter|release-language-filter|release-language-confidence-filter/u);
  assert.match(String(page.body), /Decision support only|Leading Arr-accepted candidate|does not Grab/u);
  assert.match(String(client.body), /policyLanguageChip|populatePolicyLanguageFilter|renderLeadingRelease|requiredFitLabel/u);
  assert.match(String(model.body), /policySource|requiredLanguageFit|matchesLanguageAssessment|leadingRelease/u);
  assert.match(String(styles.body), /policy-language-chip|required-fit-badge|release-leading/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie/iu);
  assert.doesNotMatch(assets, /\/grab|Grab selected release/iu);
});

test("PEG-DASH-031 missing-item triage filters and clear control remain page-memory-only assets", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, model.body, styles.body].join("\n");

  assert.match(String(page.body), /application-filter|profile-filter|policy-language-filter|analysis-age-filter/u);
  assert.match(String(page.body), /active-filter-count|clear-inventory-filters|Clear filters/u);
  assert.match(String(client.body), /populateInventoryAnalysisFilters|replaceScopedOptions|clearInventoryFilters|activeInventoryFilterCount/u);
  assert.match(String(model.body), /matchesProfile|matchesPolicyLanguage|matchesAnalysisAge|analysisRecencyWindowMs/u);
  assert.match(String(styles.body), /inventory-filter-state/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie/iu);
  assert.doesNotMatch(assets, /\/grab|Grab selected release/iu);
});

test("PEG-DASH-036 release comparison and navigation remain page-memory-only assets", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, model.body, styles.body].join("\n");

  assert.match(String(page.body), /Compare shortlisted releases|release-shortlist-items|Clear shortlist/u);
  assert.match(String(client.body), /comparisonTable|comparisonHeading|languageComparison|removeFromShortlist|showReleaseInTable/u);
  assert.match(String(model.body), /releaseComparison|bestLanguageRanks|strongConfidenceRank/u);
  assert.match(String(styles.body), /release-comparison|comparison-cell--stronger|comparison-strength/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie/iu);
  assert.doesNotMatch(assets, /\/grab|Grab selected release/iu);
});

function fakeServices(
  readMissingInventory: RuntimeServices["readMissingInventory"],
): RuntimeServices {
  return {
    readSonarrStatus: async () => ({
      integration: "sonarr",
      mode: "read_only",
      configured: false,
      state: "disabled",
    }),
    readRadarrStatus: async () => ({
      integration: "radarr",
      mode: "read_only",
      configured: false,
      state: "disabled",
    }),
    readMissingInventory,
    readItemFeasibility: async (selection) => ({
      kind: "item-feasibility",
      mode: "read_only",
      status: "not_found",
      selection,
    }),
    close: () => undefined,
  };
}
