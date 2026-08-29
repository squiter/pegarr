import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import type { FeasibilityReport } from "./domain.js";
import { AccessControl } from "./access-control.js";
import { SecretValue } from "./config.js";
import { healthResponse, readinessResponse, requestLogEntry, resolveRoute } from "./app.js";
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

test("PEG-OPS-003 structured request logs are bounded and redact URLs, IDs, and credentials", () => {
  const entry = requestLogEntry(
    "get",
    "/api/v1/library/items/sonarr/episode/305/feasibility?refresh=1&token=synthetic-private-token",
    200,
    1_000,
    1_017.6,
  );

  assert.deepEqual(entry, {
    event: "http_request",
    service: "pegarr",
    method: "GET",
    route: "item_feasibility",
    statusCode: 200,
    durationMs: 18,
  });
  assert.doesNotMatch(JSON.stringify(entry), /305|refresh|token|synthetic-private|authorization|sonarr\/episode/iu);
  const reconciliation = requestLogEntry("POST", "/api/v1/grabs/event_private_001/reconcile?token=synthetic-private-token", 200, 2_000, 2_004);
  assert.equal(reconciliation.route, "grab_reconcile");
  assert.doesNotMatch(JSON.stringify(reconciliation), /event_private|token|synthetic-private/iu);
  assert.deepEqual(requestLogEntry("TRACE", "http://[", 999, Number.NaN, Infinity), {
    event: "http_request",
    service: "pegarr",
    method: "OTHER",
    route: "not_found",
    statusCode: 500,
    durationMs: 0,
  });
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

test("PEG-CATALOG-002 catalog search authenticates before bounded read-only work", async () => {
  const username = "pegarr-user";
  const password = "synthetic-password-value-00000000001";
  const control = new AccessControl(undefined, { username, password: new SecretValue(password) });
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  let searches = 0;
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  services.searchCatalog = async (query, application) => {
    searches += 1;
    return {
      kind: "catalog-search",
      mode: "read_only",
      status: "available",
      query,
      items: [{ application: application ?? "sonarr", instanceId: "main", kind: application === "radarr" ? "movie" : "series", title: "Synthetic Discovery", ids: { tmdb: "42" }, alreadyAdded: false }],
      sources: [{ application: application ?? "sonarr", instanceId: "main", status: "available" }],
    };
  };

  const path = "/api/v1/catalog/search?q=Synthetic%20Discovery&application=sonarr";
  assert.equal((await resolveRoute("GET", path, tmpdir(), services, { control: new AccessControl(undefined) })).statusCode, 404);
  const unauthorized = await resolveRoute("GET", path, tmpdir(), services, { control, authorization: "Basic invalid" });
  assert.equal(unauthorized.statusCode, 401);
  assert.deepEqual(unauthorized.headers, { "www-authenticate": 'Basic realm="pegarr", charset="UTF-8"' });
  assert.equal(searches, 0);

  const response = await resolveRoute("GET", path, tmpdir(), services, { control, authorization });
  assert.equal(response.statusCode, 200);
  assert.match(JSON.stringify(response.body), /Synthetic Discovery/u);
  assert.equal(searches, 1);
  assert.equal((await resolveRoute("GET", "/api/v1/catalog/search?q=x", tmpdir(), services, { control, authorization })).statusCode, 400);
  assert.equal((await resolveRoute("GET", "/api/v1/catalog/search?q=valid&application=unsafe", tmpdir(), services, { control, authorization })).statusCode, 400);
  assert.equal((await resolveRoute("POST", path, tmpdir(), services, { control, authorization })).statusCode, 405);
});

test("PEG-INSTANCE-004 instance status is authenticated, bounded, and read-only", async () => {
  const token = "synthetic-access-token-value-0000000001";
  let reads = 0;
  const base = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  const services: RuntimeServices = {
    ...base,
    readArrInstanceStatuses: async () => {
      reads += 1;
      return [
        { integration: "sonarr", instanceId: "sonarr-main", mode: "read_only", configured: true, state: "available", appName: "Sonarr", version: "4.0.0.0", transportSecurity: "https", latencyMs: 12, observedAt: "2030-01-01T00:00:00.000Z" },
        { integration: "radarr", instanceId: "radarr-4k", mode: "read_only", configured: true, state: "rate_limited", retryAfterSeconds: 60, transportSecurity: "https", latencyMs: 8, observedAt: "2030-01-01T00:00:00.000Z" },
      ];
    },
  };
  const path = "/api/v1/library/instances";

  assert.equal((await resolveRoute("GET", path, tmpdir(), services, { control: new AccessControl(undefined) })).statusCode, 404);
  assert.equal((await resolveRoute("GET", path, tmpdir(), services, { control: new AccessControl(new SecretValue(token)), authorization: "Bearer wrong-token-value-000000000000000" })).statusCode, 401);
  assert.equal(reads, 0);
  const response = await resolveRoute("GET", path, tmpdir(), services, {
    control: new AccessControl(new SecretValue(token)),
    authorization: `Bearer ${token}`,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(reads, 1);
  assert.deepEqual((response.body as { instances: Array<{ instanceId: string }> }).instances.map(({ instanceId }) => instanceId), ["sonarr-main", "radarr-4k"]);
  assert.equal((await resolveRoute("POST", path, tmpdir(), services, { control: new AccessControl(new SecretValue(token)), authorization: `Bearer ${token}` })).statusCode, 405);
  assert.doesNotMatch(JSON.stringify(response), /api.?key|hostname|baseUrl|authorization|token/iu);
  assert.equal(requestLogEntry("GET", path, 200, 0, 1).route, "arr_instances");
});

test("PEG-INSTANCE-001 scoped item and Grab routes preserve exact instance identity", async () => {
  const token = "synthetic-access-token-value-0000000001";
  const adminToken = "synthetic-admin-token-value-00000000002";
  const selections: unknown[] = [];
  const baseServices = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  const services: RuntimeServices = {
    ...baseServices,
    readItemFeasibility: async (selection) => {
      selections.push(selection);
      return { kind: "item-feasibility", mode: "read_only", status: "not_found", selection };
    },
    controlledGrab: {
      prepare: async (selection, releaseId) => {
        selections.push(selection);
        return {
          status: "confirmation_required",
          mode: "controlled_grab",
          challengeId: "challenge_instance_001",
          application: "sonarr",
          instanceId: "sonarr-anime",
          kind: "episode",
          itemId: 305,
          targetLabel: "Synthetic Anime S03E05",
          releaseId,
          releaseTitle: "Synthetic.Anime.S03E05.1080p.WEB-DL-GROUP",
          confirmation: "GRAB Synthetic.Anime.S03E05.1080p.WEB-DL-GROUP FOR Synthetic Anime S03E05",
          expiresAt: "2030-01-01T00:00:00.000Z",
        };
      },
      execute: async () => { throw new Error("not expected"); },
      history: () => [],
      reconcile: () => { throw new Error("not expected"); },
    },
  };
  const libraryAccess = { control: new AccessControl(new SecretValue(token)), authorization: `Bearer ${token}` };
  const adminAccess = {
    control: new AccessControl(new SecretValue(token)),
    adminControl: new AccessControl(new SecretValue(adminToken)),
    authorization: `Bearer ${adminToken}`,
  };
  const pathBase = "/api/v1/library/items/sonarr/sonarr-anime/episode/305";

  assert.equal((await resolveRoute("GET", `${pathBase}/feasibility`, tmpdir(), services, libraryAccess)).statusCode, 404);
  assert.equal((await resolveRoute("POST", `${pathBase}/grab/prepare`, tmpdir(), services, adminAccess, {
    releaseId: "sonarr-0123456789abcdef01234567",
  })).statusCode, 200);
  assert.deepEqual(selections, [
    { application: "sonarr", instanceId: "sonarr-anime", kind: "episode", itemId: 305 },
    { application: "sonarr", instanceId: "sonarr-anime", kind: "episode", itemId: 305 },
  ]);
  assert.equal((await resolveRoute("GET", "/api/v1/library/items/sonarr/bad%2Fid/episode/305/feasibility", tmpdir(), services, libraryAccess)).statusCode, 404);
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
  assert.match(String(page.body), /release-table|feasibility-panel|visible-label|controlled Grab/u);
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

test("PEG-DASH-041 discovery and username/password login are page-memory-only assets", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, styles.body].join("\n");

  assert.match(String(page.body), /Discover before you add|login-username|login-password|catalog-query|Search for something new/u);
  assert.match(String(client.body), /libraryAuthorization|Basic|searchCatalog|\/api\/v1\/catalog\/search|renderCatalogItem/u);
  assert.match(String(styles.body), /catalog-panel|catalog-results|catalog-result/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
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
});

test("PEG-DASH-025 policy semantics, language fit, and leading candidate remain page-memory-only assets", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, model.body, styles.body].join("\n");

  assert.match(String(page.body), /release-required-fit-filter|release-language-filter|release-language-confidence-filter/u);
  assert.match(String(page.body), /Decision support only|Leading Arr-accepted candidate|never Grabs automatically/u);
  assert.match(String(client.body), /policyLanguageChip|populatePolicyLanguageFilter|renderLeadingRelease|requiredFitLabel/u);
  assert.match(String(model.body), /policySource|requiredLanguageFit|matchesLanguageAssessment|leadingRelease/u);
  assert.match(String(styles.body), /policy-language-chip|required-fit-badge|release-leading/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie/iu);
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
});

test("PEG-GRABAPI-001 controlled Grab routes require the independent administrator token", async () => {
  const libraryToken = "synthetic-access-token-value-0000000001";
  const adminToken = "synthetic-admin-token-value-00000000002";
  let preparations = 0;
  const base = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  const services: RuntimeServices = {
    ...base,
    controlledGrab: {
      prepare: async (selection, releaseId) => {
        preparations += 1;
        assert.deepEqual(selection, { application: "sonarr", kind: "episode", itemId: 305 });
        assert.equal(releaseId, "sonarr-0123456789abcdef01234567");
        return {
          status: "confirmation_required",
          mode: "controlled_grab",
          challengeId: "challenge_00000001",
          application: "sonarr",
          instanceId: "sonarr",
          kind: "episode",
          itemId: 305,
          targetLabel: "Synthetic Show S03E05",
          releaseId,
          releaseTitle: "Synthetic.Show.S03E05.1080p.WEB-DL-GROUP",
          confirmation: "GRAB Synthetic.Show.S03E05.1080p.WEB-DL-GROUP FOR Synthetic Show S03E05",
          expiresAt: "2030-01-01T00:00:00.000Z",
        };
      },
      execute: async () => { throw new Error("not expected"); },
      history: () => [],
      reconcile: () => { throw new Error("not expected"); },
    },
  };
  const path = "/api/v1/library/items/sonarr/episode/305/grab/prepare";
  const accessControl = new AccessControl(new SecretValue(libraryToken));
  const adminControl = new AccessControl(new SecretValue(adminToken));
  const body = { releaseId: "sonarr-0123456789abcdef01234567" };

  assert.equal((await resolveRoute("POST", path, tmpdir(), services, {
    control: accessControl,
    adminControl,
    authorization: `Bearer ${libraryToken}`,
  }, body)).statusCode, 401);
  assert.equal(preparations, 0);
  const authorized = await resolveRoute("POST", path, tmpdir(), services, {
    control: accessControl,
    adminControl,
    authorization: `Bearer ${adminToken}`,
  }, body);
  assert.equal(authorized.statusCode, 200);
  assert.equal((authorized.body as { status: string }).status, "confirmation_required");
  assert.equal(preparations, 1);
  assert.doesNotMatch(JSON.stringify(authorized), /guid|indexerId|api.?key|synthetic-admin-token/iu);
});

test("PEG-GRABAPI-002 execution and audit history expose bounded public outcomes", async () => {
  const token = "synthetic-admin-token-value-00000000002";
  let executions = 0;
  const event = {
    eventId: "event_00000001",
    application: "sonarr",
    instanceId: "sonarr",
    kind: "episode",
    itemId: 305,
    targetLabel: "Synthetic Show S03E05",
    releaseId: "sonarr-0123456789abcdef01234567",
    releaseTitle: "Synthetic.Show.S03E05.1080p.WEB-DL-GROUP",
    status: "grabbed",
    detailCode: "arr_accepted_grab",
    requestedAt: "2030-01-01T00:00:00.000Z",
    completedAt: "2030-01-01T00:00:01.000Z",
  } as const;
  const base = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  const services: RuntimeServices = {
    ...base,
    controlledGrab: {
      prepare: async () => { throw new Error("not expected"); },
      execute: async (selection, challengeId, confirmation, idempotencyKey) => {
        executions += 1;
        assert.deepEqual(selection, { application: "sonarr", kind: "episode", itemId: 305 });
        assert.equal(challengeId, "challenge_00000001");
        assert.equal(confirmation, "GRAB exact confirmation");
        assert.equal(idempotencyKey, "idempotency_00000001");
        return { status: "grabbed", mode: "controlled_grab", event, replayed: false, requiresReconciliation: false };
      },
      history: (limit) => {
        assert.equal(limit, 10);
        return [event];
      },
      reconcile: () => { throw new Error("not expected"); },
    },
  };
  const access = {
    control: new AccessControl(new SecretValue("synthetic-access-token-value-0000000001")),
    adminControl: new AccessControl(new SecretValue(token)),
    authorization: `Bearer ${token}`,
  };
  const executePath = "/api/v1/library/items/sonarr/episode/305/grab/execute";
  const invalid = await resolveRoute("POST", executePath, tmpdir(), services, access, { challengeId: "challenge_00000001" });
  assert.equal(invalid.statusCode, 400);
  assert.equal(executions, 0);
  const executed = await resolveRoute("POST", executePath, tmpdir(), services, access, {
    challengeId: "challenge_00000001",
    confirmation: "GRAB exact confirmation",
    idempotencyKey: "idempotency_00000001",
  });
  assert.equal(executed.statusCode, 200);
  assert.equal(executions, 1);
  const history = await resolveRoute("GET", "/api/v1/grabs/history?limit=10", tmpdir(), services, access);
  assert.equal(history.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(history), /idempotency|guid|indexerId|authorization|synthetic-admin/iu);
  assert.equal((await resolveRoute("GET", executePath, tmpdir(), services, access)).statusCode, 405);
});

test("PEG-GRABAPI-003 timeout reconciliation is administrator-only, exact, and bounded", async () => {
  const adminToken = "synthetic-admin-token-value-00000000002";
  const eventId = "event_00000010";
  const confirmation = "RECONCILE Synthetic.Release FOR Synthetic Show S03E05 AS NOT GRABBED";
  let reconciliations = 0;
  const base = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  const services: RuntimeServices = {
    ...base,
    controlledGrab: {
      prepare: async () => { throw new Error("not expected"); },
      execute: async () => { throw new Error("not expected"); },
      history: () => [],
      reconcile: (receivedEventId, outcome, receivedConfirmation) => {
        reconciliations += 1;
        assert.equal(receivedEventId, eventId);
        assert.equal(outcome, "not_grabbed");
        assert.equal(receivedConfirmation, confirmation);
        return {
          status: "reconciled",
          mode: "controlled_grab",
          event: {
            eventId,
            application: "sonarr",
            instanceId: "sonarr",
            kind: "episode",
            itemId: 305,
            targetLabel: "Synthetic Show S03E05",
            releaseId: "sonarr-0123456789abcdef01234567",
            releaseTitle: "Synthetic.Release",
            status: "timeout_unknown",
            detailCode: "reconciliation_required",
            requestedAt: "2030-01-01T00:00:00.000Z",
            completedAt: "2030-01-01T00:00:01.000Z",
            reconciliationOutcome: "not_grabbed",
            reconciledAt: "2030-01-01T00:01:00.000Z",
          },
        };
      },
    },
  };
  const path = `/api/v1/grabs/${eventId}/reconcile`;
  const access = {
    control: new AccessControl(new SecretValue("synthetic-access-token-value-0000000001")),
    adminControl: new AccessControl(new SecretValue(adminToken)),
    authorization: `Bearer ${adminToken}`,
  };

  assert.equal((await resolveRoute("POST", path, tmpdir(), services, {
    ...access,
    authorization: "Bearer synthetic-access-token-value-0000000001",
  }, { outcome: "not_grabbed", confirmation })).statusCode, 401);
  assert.equal(reconciliations, 0);
  assert.equal((await resolveRoute("POST", path, tmpdir(), services, access, {
    outcome: "unknown",
    confirmation,
  })).statusCode, 400);
  assert.equal(reconciliations, 0);
  const reconciled = await resolveRoute("POST", path, tmpdir(), services, access, {
    outcome: "not_grabbed",
    confirmation,
  });
  assert.equal(reconciled.statusCode, 200);
  assert.equal(reconciliations, 1);
  assert.doesNotMatch(JSON.stringify(reconciled), /idempotency|guid|indexerId|authorization|synthetic-admin/iu);
  assert.equal((await resolveRoute("GET", path, tmpdir(), services, access)).statusCode, 405);
});

test("PEG-DASH-037 controlled Grab UI is opt-in, exact-confirmation, and page-memory-only", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, model.body, styles.body].join("\n");

  assert.match(String(page.body), /Administrator action|Revalidate release|Exact confirmation|Confirm Grab/u);
  assert.match(String(client.body), /prepareControlledGrab|executeControlledGrab|crypto\.randomUUID|credentials: "omit"/u);
  assert.match(String(client.body), /timeout_unknown|Check Arr activity|administratorToken = undefined/u);
  assert.match(String(model.body), /controlledGrab: capabilities\.controlledGrab === true/u);
  assert.match(String(styles.body), /grab-dialog|grab-confirmation-phrase|danger-button/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
});

test("PEG-DASH-039 audit history preserves Unknown and exact operator reconciliation in page memory", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, styles.body].join("\n");

  assert.match(String(page.body), /Controlled Grab history|Unknown outcomes must be checked|Verified outcome|Record attestation/u);
  assert.match(String(client.body), /loadGrabHistory|renderGrabHistory|submitReconciliation|reconciliationConfirmations/u);
  assert.match(String(client.body), /historyAdministratorToken = undefined|credentials: "omit"|encodeURIComponent/u);
  assert.match(String(styles.body), /grab-history-event|grab-history-status-chip|grab-reconcile-step/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
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
    searchCatalog: async (query) => ({
      kind: "catalog-search",
      mode: "read_only",
      status: "disabled",
      query,
      items: [],
      sources: [],
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
