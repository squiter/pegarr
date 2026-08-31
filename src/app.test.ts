import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import type { FeasibilityReport } from "./domain.js";
import { AccessControl } from "./access-control.js";
import { SecretValue } from "./config.js";
import { healthResponse, readinessResponse, requestLogEntry, resolveRoute } from "./app.js";
import type { RuntimeServices } from "./runtime.js";
import { SessionStore } from "./session-store.js";

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

test("PEG-SESSION-002 login, restore, CSRF mutation, and logout use a bounded HttpOnly server session", async () => {
  const username = "pegarr-user";
  const password = "synthetic-password-value-00000000001";
  let sequence = 0;
  const sessionStore = new SessionStore({
    now: () => 1_000,
    randomToken: () => `session_${String(++sequence).padStart(40, "0")}`,
  });
  const control = new AccessControl(undefined, { username, password: new SecretValue(password) });
  let updates = 0;
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  Object.assign(services, {
    updateSubtitleSettings: async () => {
      updates += 1;
      return {
        kind: "subtitle-settings", mode: "settings", status: "configured", revision: 1,
        policy: { source: "explicit_default", profileId: "pegarr-default", profileName: "Pegarr default", languages: [{ code: "pt-BR", required: true, forced: false, hearingImpaired: "either" }] },
        providers: [],
      } as const;
    },
  });
  const baseAccess = { control, sessionStore, secureSessionCookie: true };

  const rejected = await resolveRoute("POST", "/api/v1/session/login", tmpdir(), services, baseAccess, { username, password: "wrong-password-value-000000000000" });
  assert.equal(rejected.statusCode, 401);
  const login = await resolveRoute("POST", "/api/v1/session/login", tmpdir(), services, baseAccess, { username, password });
  assert.equal(login.statusCode, 200);
  const setCookie = login.headers?.["set-cookie"] ?? "";
  assert.match(setCookie, /^pegarr_session=[A-Za-z0-9_-]{32,128}; Path=\/; HttpOnly; SameSite=Strict; Secure; Expires=/u);
  const sessionToken = /^pegarr_session=([^;]+)/u.exec(setCookie)?.[1];
  assert.ok(sessionToken);
  const loginBody = login.body as { csrfToken: string; expiresAt: string };
  assert.equal(sessionStore.authorizeMutation(sessionToken, loginBody.csrfToken), true);
  assert.doesNotMatch(JSON.stringify(login.body), /synthetic-password/u);
  assert.equal(JSON.stringify(login.body).includes(sessionToken), false);

  const authenticatedAccess = { ...baseAccess, sessionToken, sessionAuthenticated: true, sessionMutationAuthorized: false };
  assert.equal((await resolveRoute("GET", "/api/v1/library/missing", tmpdir(), services, authenticatedAccess)).statusCode, 200);
  assert.equal((await resolveRoute("PUT", "/api/v1/settings/subtitles", tmpdir(), services, authenticatedAccess, {
    languages: [{ code: "pt-BR", required: true, forced: false, hearingImpaired: "either" }],
  })).statusCode, 403);
  assert.equal(updates, 0);

  const restored = await resolveRoute("GET", "/api/v1/session", tmpdir(), services, authenticatedAccess);
  assert.equal(restored.statusCode, 200);
  const restoredCsrf = (restored.body as { csrfToken: string }).csrfToken;
  assert.equal(sessionStore.authorizeMutation(sessionToken, loginBody.csrfToken), false);
  assert.equal(sessionStore.authorizeMutation(sessionToken, restoredCsrf), true);
  const mutationAccess = { ...authenticatedAccess, sessionMutationAuthorized: true };
  assert.equal((await resolveRoute("PUT", "/api/v1/settings/subtitles", tmpdir(), services, mutationAccess, {
    languages: [{ code: "pt-BR", required: true, forced: false, hearingImpaired: "either" }],
  })).statusCode, 200);
  assert.equal(updates, 1);

  const logout = await resolveRoute("POST", "/api/v1/session/logout", tmpdir(), services, mutationAccess);
  assert.equal(logout.statusCode, 200);
  assert.match(logout.headers?.["set-cookie"] ?? "", /HttpOnly; SameSite=Strict; Secure; Max-Age=0/u);
  assert.equal(sessionStore.authenticate(sessionToken), false);
});

test("PEG-ONBOARD-002 onboarding authenticates before work and projects the current access boundary", async () => {
  const token = "synthetic-access-token-value-0000000001";
  const username = "pegarr-user";
  const password = "synthetic-password-value-00000000001";
  const control = new AccessControl(new SecretValue(token), { username, password: new SecretValue(password) });
  let reads = 0;
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  Object.assign(services, {
    readOnboardingStatus: async () => {
      reads += 1;
      return {
        kind: "onboarding-status",
        mode: "read_only",
        status: "ready",
        requirements: {
          arrCatalog: { status: "ready", sonarrInstances: 1, radarrInstances: 1 },
          subtitlePolicy: { status: "ready", languageCount: 1 },
          subtitleProvider: { status: "ready", providers: ["subdl"] },
        },
        capabilities: { catalogSearch: true, subtitlePreview: true, catalogAdd: true, controlledGrab: true },
      } as const;
    },
  });

  assert.equal((await resolveRoute("GET", "/api/v1/onboarding", tmpdir(), services, { control })).statusCode, 401);
  assert.equal(reads, 0);
  assert.equal((await resolveRoute("POST", "/api/v1/onboarding", tmpdir(), services, {
    control,
    authorization: `Bearer ${token}`,
  })).statusCode, 405);
  assert.equal(reads, 0);

  const legacy = await resolveRoute("GET", "/api/v1/onboarding", tmpdir(), services, {
    control,
    authorization: `Bearer ${token}`,
  });
  assert.equal(legacy.statusCode, 200);
  assert.deepEqual((legacy.body as { access: unknown }).access, {
    role: "legacy_read_only",
    settingsMutation: false,
    catalogAddMutation: false,
    controlledGrab: "administrator_token_required",
  });

  const session = await resolveRoute("GET", "/api/v1/onboarding", tmpdir(), services, {
    control,
    sessionAuthenticated: true,
  });
  assert.equal(session.statusCode, 200);
  assert.deepEqual((session.body as { access: unknown }).access, {
    role: "operator_session",
    settingsMutation: true,
    catalogAddMutation: true,
    controlledGrab: "administrator_token_required",
  });
  assert.equal(reads, 2);
  assert.doesNotMatch(JSON.stringify([legacy, session]), /synthetic-access|synthetic-password/u);
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

test("PEG-SETTINGS-003 subtitle settings are readable by API clients but writable only through login", async () => {
  const username = "pegarr-user";
  const password = "synthetic-password-value-00000000001";
  const token = "synthetic-access-token-value-0000000001";
  const control = new AccessControl(new SecretValue(token), { username, password: new SecretValue(password) });
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const bearer = `Bearer ${token}`;
  let updates = 0;
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  services.updateSubtitleSettings = async (input) => {
    updates += 1;
    return {
      kind: "subtitle-settings",
      mode: "settings",
      status: "configured",
      revision: 1,
      policy: { source: "explicit_default", profileId: "pegarr-default", profileName: "Pegarr default", languages: input.languages },
      providers: [{ provider: "subdl", configured: true, origin: "deployment", languageMappings: [{ policyCode: "pt-BR", providerCode: "PT-BR" }] }],
    };
  };
  const body = { languages: [{ code: "pt-BR", required: true, forced: false, hearingImpaired: "either" as const }] };

  assert.equal((await resolveRoute("GET", "/api/v1/settings/subtitles", tmpdir(), services, { control, authorization: bearer })).statusCode, 200);
  const forbidden = await resolveRoute("PUT", "/api/v1/settings/subtitles", tmpdir(), services, { control, authorization: bearer }, body);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(updates, 0);
  const updated = await resolveRoute("PUT", "/api/v1/settings/subtitles", tmpdir(), services, { control, authorization: basic }, body);
  assert.equal(updated.statusCode, 200);
  assert.equal(updates, 1);
  assert.equal((await resolveRoute("PUT", "/api/v1/settings/subtitles", tmpdir(), services, { control, authorization: basic }, { languages: "unsafe" })).statusCode, 400);
});

test("PEG-PROVIDERSETTINGS-003 provider writes require login and never return credentials", async () => {
  const username = "pegarr-user";
  const password = "synthetic-password-value-00000000001";
  const token = "synthetic-access-token-value-0000000001";
  const apiKey = "synthetic-provider-api-key-value";
  const control = new AccessControl(new SecretValue(token), { username, password: new SecretValue(password) });
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const bearer = `Bearer ${token}`;
  let updates = 0;
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  services.updateProviderSettings = async (provider, input) => {
    updates += 1;
    assert.equal(provider, "subdl");
    assert.equal(input.apiKey, apiKey);
    return {
      kind: "subtitle-settings",
      mode: "settings",
      status: "configured",
      revision: 1,
      policy: { source: "explicit_default", profileId: "pegarr-default", profileName: "Pegarr default", languages: [] },
      providers: [{ provider: "subdl", configured: true, origin: "ui", languageMappings: input.languageMappings }],
    };
  };
  const body = { apiKey, languageMappings: [{ policyCode: "pt-BR", providerCode: "PT-BR" }] };
  const path = "/api/v1/settings/providers/subdl";

  assert.equal((await resolveRoute("PUT", path, tmpdir(), services, { control, authorization: bearer }, body)).statusCode, 403);
  assert.equal(updates, 0);
  const response = await resolveRoute("PUT", path, tmpdir(), services, { control, authorization: basic }, body);
  assert.equal(response.statusCode, 200);
  assert.equal(updates, 1);
  assert.doesNotMatch(JSON.stringify(response), /synthetic-provider-api-key-value/u);
  assert.equal((await resolveRoute("GET", path, tmpdir(), services, { control, authorization: basic })).statusCode, 405);
  assert.equal((await resolveRoute("PUT", path, tmpdir(), services, { control, authorization: basic }, { apiKey })).statusCode, 400);
});

test("PEG-CATALOG-004 catalog coverage authenticates before provider work and rejects mutations", async () => {
  const token = "synthetic-access-token-value-0000000001";
  const control = new AccessControl(new SecretValue(token));
  let previews = 0;
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  services.previewCatalogCoverage = async () => {
    previews += 1;
    return { kind: "catalog-subtitle-coverage", mode: "read_only", status: "policy_unresolved" };
  };
  const path = "/api/v1/catalog/sonarr/main/tvdb/42/coverage";
  assert.equal((await resolveRoute("GET", path, tmpdir(), services, { control, authorization: "Bearer wrong-token-value-000000000000000" })).statusCode, 401);
  assert.equal(previews, 0);
  assert.equal((await resolveRoute("GET", path, tmpdir(), services, { control, authorization: `Bearer ${token}` })).statusCode, 200);
  assert.equal(previews, 1);
  assert.equal((await resolveRoute("POST", path, tmpdir(), services, { control, authorization: `Bearer ${token}` })).statusCode, 405);
});

test("PEG-CATALOG-006 catalog add-option reads authenticate before upstream work", async () => {
  const username = "pegarr-user";
  const password = "synthetic-password-value-00000000001";
  const control = new AccessControl(undefined, { username, password: new SecretValue(password) });
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  let reads = 0;
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  Object.assign(services, { catalogAdd: {
    readOptions: async () => {
      reads += 1;
      return {
        kind: "catalog-add-options",
        mode: "catalog_add",
        title: "Synthetic Add",
        confirmation: "ADD Synthetic Add TO SONARR",
        rootFolders: [{ id: 1, label: "TV", accessible: true }],
        qualityProfiles: [{ id: 2, name: "HD" }],
        defaults: { monitored: true, monitor: "all" },
      };
    },
    add: async () => { throw new Error("not expected"); },
  } });
  const path = "/api/v1/catalog/sonarr/main/tvdb/42/add-options";
  assert.equal((await resolveRoute("GET", path, tmpdir(), services, { control, authorization: "Basic invalid" })).statusCode, 401);
  assert.equal(reads, 0);
  const response = await resolveRoute("GET", path, tmpdir(), services, { control, authorization: basic });
  assert.equal(response.statusCode, 200);
  assert.equal(reads, 1);
  assert.doesNotMatch(JSON.stringify(response), /\/private|api.?key/iu);
  assert.equal((await resolveRoute("POST", path, tmpdir(), services, { control, authorization: basic })).statusCode, 405);
});

test("PEG-CATALOG-007 catalog add requires feature flag, login, and exact bounded input", async () => {
  const username = "pegarr-user";
  const password = "synthetic-password-value-00000000001";
  const token = "synthetic-access-token-value-0000000001";
  const control = new AccessControl(new SecretValue(token), { username, password: new SecretValue(password) });
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const bearer = `Bearer ${token}`;
  const path = "/api/v1/catalog/radarr/main/tmdb/42/add";
  const body = { rootFolderId: 1, qualityProfileId: 2, monitored: true, minimumAvailability: "released", confirmation: "ADD Synthetic Add TO RADARR" };
  const disabled = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  assert.equal((await resolveRoute("POST", path, tmpdir(), disabled, { control, authorization: basic }, body)).statusCode, 404);

  let adds = 0;
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  Object.assign(services, { catalogAdd: {
    readOptions: async () => { throw new Error("not expected"); },
    add: async (_selection: import("./runtime.js").CatalogAddSelection, input: import("./runtime.js").CatalogAddInput) => {
      adds += 1;
      assert.equal(input.confirmation, body.confirmation);
      return {
        kind: "catalog-add",
        mode: "catalog_add",
        status: "added",
        receipt: { status: "added", application: "radarr", instanceId: "main", itemId: 93, title: "Synthetic Add", automaticSearch: false },
        next: { action: "exact_movie_release_analysis", continuationId: "abcdefghijklmnopqrstuvwxABCDEFGH", expiresAt: "2026-08-29T05:00:00.000Z" },
      };
    },
  } });
  assert.equal((await resolveRoute("POST", path, tmpdir(), services, { control, authorization: bearer }, body)).statusCode, 403);
  assert.equal(adds, 0);
  assert.equal((await resolveRoute("POST", path, tmpdir(), services, { control, authorization: basic }, { ...body, automaticSearch: true })).statusCode, 400);
  assert.equal(adds, 0);
  const response = await resolveRoute("POST", path, tmpdir(), services, { control, authorization: basic }, body);
  assert.equal(response.statusCode, 200);
  assert.equal(adds, 1);
  assert.match(JSON.stringify(response.body), /exact_movie_release_analysis/u);
  assert.doesNotMatch(JSON.stringify(response.body), /rootFolder|qualityProfile|confirmation/u);
});

test("PEG-CONTINUE-003 continuation analysis authenticates before Arr or provider work", async () => {
  const username = "pegarr-user";
  const password = "synthetic-password-value-00000000001";
  const control = new AccessControl(new SecretValue("synthetic-access-token-value-0000000001"), { username, password: new SecretValue(password) });
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const continuationId = "a".repeat(32);
  const path = `/api/v1/catalog/continuations/${continuationId}/analysis`;
  let analyses = 0;
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  Object.assign(services, {
    catalogContinuation: {
      analyze: async (value: string) => {
        analyses += 1;
        assert.equal(value, continuationId);
        return { kind: "catalog-continuation", mode: "read_only", status: "scope_required" } as const;
      },
    },
  });
  assert.equal((await resolveRoute("GET", path, tmpdir(), services, { control, authorization: "Basic invalid" })).statusCode, 401);
  assert.equal(analyses, 0);
  assert.equal((await resolveRoute("POST", path, tmpdir(), services, { control, authorization: basic })).statusCode, 405);
  assert.equal(analyses, 0);
  const response = await resolveRoute("GET", path, tmpdir(), services, { control, authorization: basic });
  assert.equal(response.statusCode, 409);
  assert.equal(analyses, 1);
});

test("PEG-CONTINUE-006 Sonarr scope routes authenticate before upstream work", async () => {
  const username = "pegarr-user";
  const password = "synthetic-password-value-00000000001";
  const control = new AccessControl(undefined, { username, password: new SecretValue(password) });
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const continuationId = "s".repeat(32);
  let scopeReads = 0;
  let analyses = 0;
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  Object.assign(services, {
    catalogContinuation: {
      scopes: async () => {
        scopeReads += 1;
        return { kind: "catalog-continuation-scopes", mode: "read_only", status: "ready", title: "Synthetic Series", seasons: [], episodes: [] } as const;
      },
      analyze: async (_value: string, scope: import("./runtime.js").CatalogContinuationScope | undefined) => {
        analyses += 1;
        assert.deepEqual(scope, { kind: "season", seasonNumber: 1 });
        return { kind: "catalog-continuation", mode: "read_only", status: "scope_not_found" } as const;
      },
    },
  });
  const scopesPath = `/api/v1/catalog/continuations/${continuationId}/scopes`;
  const analysisPath = `/api/v1/catalog/continuations/${continuationId}/analysis/season/1`;
  assert.equal((await resolveRoute("GET", scopesPath, tmpdir(), services, { control, authorization: "Basic invalid" })).statusCode, 401);
  assert.equal(scopeReads, 0);
  assert.equal((await resolveRoute("GET", scopesPath, tmpdir(), services, { control, authorization: basic })).statusCode, 200);
  assert.equal(scopeReads, 1);
  assert.equal((await resolveRoute("GET", analysisPath, tmpdir(), services, { control, authorization: basic })).statusCode, 404);
  assert.equal(analyses, 1);
});

test("PEG-CONTINUE-009 continuation Grab routes require independent administrator authorization before work", async () => {
  const libraryToken = "synthetic-access-token-value-0000000001";
  const adminToken = "synthetic-admin-token-value-00000000005";
  const continuationId = "g".repeat(32);
  let expectedScope: { readonly kind: "episode"; readonly episodeId: number } | { readonly kind: "season"; readonly seasonNumber: number } = { kind: "episode", episodeId: 305 };
  let preparations = 0;
  let executions = 0;
  const services = fakeServices(async () => ({ kind: "missing-item-inventory", mode: "read_only", status: "disabled" }));
  Object.assign(services, {
    catalogContinuation: {
      scopes: async () => { throw new Error("not expected"); },
      analyze: async () => { throw new Error("not expected"); },
      prepareGrab: async (receivedId: string, releaseId: string, receivedScope: unknown) => {
        preparations += 1;
        assert.equal(receivedId, continuationId);
        assert.equal(releaseId, "sonarr-0123456789abcdef01234567");
        assert.deepEqual(receivedScope, expectedScope);
        return {
          status: "confirmation_required",
          mode: "controlled_grab",
          challengeId: "continuation_challenge_0001",
          application: "sonarr",
          instanceId: "synthetic-sonarr",
          kind: "episode",
          itemId: 305,
          targetLabel: "Synthetic Show S03E05 · Synthetic Episode",
          releaseId,
          releaseTitle: "Synthetic.Show.S03E05.1080p.WEB-DL-GROUP",
          confirmation: "GRAB Synthetic.Show.S03E05.1080p.WEB-DL-GROUP FOR Synthetic Show S03E05 · Synthetic Episode",
          expiresAt: "2030-01-01T00:00:00.000Z",
        } as const;
      },
      executeGrab: async (_receivedId: string, _challengeId: string, _confirmation: string, _idempotencyKey: string, receivedScope: unknown) => {
        executions += 1;
        assert.deepEqual(receivedScope, expectedScope);
        return { status: "challenge_expired", mode: "controlled_grab", detailCode: "challenge_missing_or_expired" } as const;
      },
    },
    controlledGrab: {
      prepare: async () => { throw new Error("not expected"); },
      execute: async () => { throw new Error("not expected"); },
      history: () => [],
      reconcile: () => { throw new Error("not expected"); },
    },
  });
  const control = new AccessControl(new SecretValue(libraryToken));
  const adminControl = new AccessControl(new SecretValue(adminToken));
  const access = { control, adminControl, authorization: `Bearer ${adminToken}` };
  const basePath = `/api/v1/catalog/continuations/${continuationId}/analysis/episode/305/grab`;
  const prepareBody = { releaseId: "sonarr-0123456789abcdef01234567" };

  assert.equal((await resolveRoute("POST", `${basePath}/prepare`, tmpdir(), services, {
    ...access,
    authorization: `Bearer ${libraryToken}`,
  }, prepareBody)).statusCode, 401);
  assert.equal(preparations, 0);
  assert.equal((await resolveRoute("GET", `${basePath}/prepare`, tmpdir(), services, access)).statusCode, 405);
  assert.equal(preparations, 0);
  const prepared = await resolveRoute("POST", `${basePath}/prepare`, tmpdir(), services, access, prepareBody);
  assert.equal(prepared.statusCode, 200);
  assert.equal(preparations, 1);
  assert.doesNotMatch(JSON.stringify(prepared), /guid|indexerId|api.?key|synthetic-admin-token/iu);

  assert.equal((await resolveRoute("POST", `${basePath}/execute`, tmpdir(), services, access, {
    challengeId: "continuation_challenge_0001",
  })).statusCode, 400);
  assert.equal(executions, 0);
  assert.equal((await resolveRoute("POST", `${basePath}/execute`, tmpdir(), services, access, {
    challengeId: "continuation_challenge_0001",
    confirmation: "GRAB exact confirmation",
    idempotencyKey: "continuation_idempotency_0001",
  })).statusCode, 410);
  assert.equal(executions, 1);
  expectedScope = { kind: "season", seasonNumber: 3 };
  const seasonPrepared = await resolveRoute(
    "POST",
    `/api/v1/catalog/continuations/${continuationId}/analysis/season/3/grab/prepare`,
    tmpdir(),
    services,
    access,
    prepareBody,
  );
  assert.equal(seasonPrepared.statusCode, 200);
  assert.equal(preparations, 2);
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

test("PEG-DASH-041 PEG-SESSION-003 discovery login uses a restorable server session without browser storage", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, styles.body].join("\n");

  assert.match(String(page.body), /Discover before you add|login-username|login-password|catalog-query|Search for something new/u);
  assert.match(String(client.body), /establishSession|restoreSession|signOut|\/api\/v1\/session\/login|\/api\/v1\/catalog\/search|renderCatalogItem/u);
  assert.match(String(client.body), /sessionCsrfToken|x-pegarr-csrf|credentials: "same-origin"|libraryHeaders/u);
  assert.match(String(page.body), /private, expiring server session|session-logout/u);
  assert.match(String(styles.body), /catalog-panel|catalog-results|catalog-result/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
});

test("PEG-DASH-042 subtitle policy settings and pre-add coverage remain secret-safe assets", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, styles.body].join("\n");
  assert.match(String(page.body), /What subtitles do you want|subtitle-languages|provider-configuration|Preview subtitles/u);
  assert.match(String(client.body), /loadSubtitleSettings|saveSubtitleSettings|previewCatalogCoverage|catalog-subtitle-coverage|Credential saved \(not verified\)/u);
  assert.match(String(styles.body), /settings-panel|provider-configuration-card|catalog-coverage|coverage-chip--unknown/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
});

test("PEG-DASH-043 provider onboarding clears credentials and keeps them page-memory-only", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, styles.body].join("\n");
  assert.match(String(page.body), /connect SubDL or OpenSubtitles|private server-side files/u);
  assert.match(String(client.body), /saveProviderSettings|parseProviderMappings|new-password|keyInput\.value = ""|\/api\/v1\/settings\/providers\//u);
  assert.match(String(styles.body), /provider-settings-form/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
});

test("PEG-DASH-044 catalog add is an explicit login-only mutation and never offers automatic search", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, styles.body].join("\n");
  assert.match(String(page.body), /explicitly add with automatic search disabled|never downloads a release/u);
  assert.match(String(client.body), /catalogAddEnabled|sessionCsrfToken !== undefined|loadCatalogAddOptions|renderCatalogAddForm|submitCatalogAdd/u);
  assert.match(String(client.body), /Automatic search stays off|no release will be downloaded|timeout.*Unknown/iu);
  assert.match(String(client.body), /\/add-options|\/add`|exact release analysis/u);
  assert.match(String(styles.body), /catalog-add-panel|catalog-add-form|catalog-add-warning/u);
  assert.doesNotMatch(assets, /searchForMovie|searchForMissingEpisodes|automaticSearch\s*:/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
});

test("PEG-DASH-045 successful movie add continues automatically into exact read-only analysis", async () => {
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const assets = [client.body, model.body].join("\n");
  assert.match(String(client.body), /loadCatalogContinuationAnalysis|catalog\/continuations\/\$\{encodeURIComponent\(continuationId\)\}\/analysis/u);
  assert.match(String(client.body), /Loading exact Radarr releases|Exact release analysis is ready below/u);
  assert.match(String(client.body), /Fresh Arr and Pegarr-policy analysis/u);
  assert.match(String(model.body), /explicit_default_unconfigured|Configure at least one Pegarr subtitle language/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
});

test("PEG-DASH-046 successful series add loads explicit season and episode scope choices", async () => {
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [client.body, model.body, styles.body].join("\n");
  assert.match(String(client.body), /loadCatalogSeriesScopes|\/scopes`|Analyze a season or episode|Analyze exact releases/u);
  assert.match(String(client.body), /analysis\$\{scopePath\}|seasonGroup|episodeGroup/u);
  assert.match(String(model.body), /item\.kind === "season"|Specials|Season \$\{item\.season\}/u);
  assert.match(String(styles.body), /catalog-scope-panel/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
});

test("PEG-DASH-047 continuation release rows reuse the explicit controlled Grab dialog without browser-owned targets", async () => {
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const assets = [client.body, model.body].join("\n");
  assert.match(String(client.body), /grabEndpoint: `\/api\/v1\/catalog\/continuations\/\$\{encodeURIComponent\(continuationId\)\}\/analysis\$\{scopePath\}\/grab`/u);
  assert.match(String(client.body), /typeof row\.grabEndpoint === "string"|`\$\{row\.grabEndpoint\}\/prepare`|`\$\{row\.grabEndpoint\}\/execute`/u);
  assert.match(String(client.body), /independent administrator token|confirmation must match|crypto\.randomUUID/u);
  assert.match(String(model.body), /controlledGrab: capabilities\.controlledGrab === true/u);
  assert.doesNotMatch(assets, /\bguid\b|indexerId|localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
});

test("PEG-DASH-048 first-run guidance distinguishes prerequisites, operator actions, and administrator Grab", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, styles.body].join("\n");
  assert.match(String(page.body), /First-run guide|Your Pegarr path|Pegarr setup steps/u);
  assert.match(String(client.body), /loadOnboarding|renderOnboarding|\/api\/v1\/onboarding|Missing setup never becomes a false No match found/u);
  assert.match(String(client.body), /Legacy token: search and preview only|Operator session: settings changes|separate administrator token/u);
  assert.match(String(styles.body), /onboarding-panel|onboarding-steps|onboarding-step--ready/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
});

test("PEG-DASH-051 setup stays in a collapsible menu and opens automatically only when first-run work remains", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const html = String(page.body);
  const assets = [page.body, client.body, styles.body].join("\n");

  assert.match(html, /setup-menu-toggle[^>]+aria-controls="setup-panel"[^>]+aria-expanded="false"|aria-controls="setup-panel"[^>]+setup-menu-toggle/u);
  assert.match(html, /Setup &amp; settings|setup-panel-close|Close setup and settings/u);
  assert.ok(html.indexOf('id="catalog"') < html.indexOf('id="dashboard"'));
  assert.match(String(client.body), /setupPanelDismissed|if \(!ready && !setupPanelDismissed\) openSetupPanel\(true\)/u);
  assert.match(String(client.body), /openSetupPanel|closeSetupPanel|aria-expanded|event\.key === "Escape"/u);
  assert.match(String(styles.body), /setup-panel|setup-backdrop|setup-menu-state\[data-state="ready"\]/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
});

test("PEG-DASH-049 subtitle settings expose explicit per-language matching preferences", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());
  const assets = [page.body, client.body, model.body, styles.body].join("\n");
  assert.match(String(page.body), /Language preferences|required, forced-only|hearing-impaired subtitles/u);
  assert.match(String(client.body), /renderSubtitleLanguagePreferences|Forced subtitles only|Hearing-impaired subtitles|subtitleLanguageRequirements/u);
  assert.match(String(model.body), /export function subtitleLanguageRequirements|hearingImpairedValues|Subtitle languages must be unique/u);
  assert.match(String(styles.body), /subtitle-language-preferences|subtitle-language-check|subtitle-hearing-preference/u);
  assert.doesNotMatch(assets, /localStor(?:age)|sessionStor(?:age)|indexedDB|document\.cookie|innerHTML/iu);
});

test("PEG-DASH-050 server-issued season analysis can enter the exact controlled Grab dialog", async () => {
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const assets = [client.body, model.body].join("\n");
  assert.match(String(client.body), /analysis\$\{scopePath\}|row\.grabEndpoint|server-issued season scope/u);
  assert.match(String(client.body), /independent administrator token|confirmation must match|credentials: "omit"/u);
  assert.match(String(model.body), /controlledGrab: capabilities\.controlledGrab === true|item\.kind === "season"/u);
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
    readSubtitleSettings: async () => ({
      kind: "subtitle-settings",
      mode: "settings",
      status: "unconfigured",
      revision: 0,
      policy: { source: "explicit_default", profileId: "pegarr-default", profileName: "Pegarr default", languages: [] },
      providers: [],
    }),
    updateSubtitleSettings: async () => ({
      kind: "subtitle-settings",
      mode: "settings",
      status: "unconfigured",
      revision: 0,
      policy: { source: "explicit_default", profileId: "pegarr-default", profileName: "Pegarr default", languages: [] },
      providers: [],
    }),
    updateProviderSettings: async () => ({
      kind: "subtitle-settings",
      mode: "settings",
      status: "unconfigured",
      revision: 0,
      policy: { source: "explicit_default", profileId: "pegarr-default", profileName: "Pegarr default", languages: [] },
      providers: [],
    }),
    previewCatalogCoverage: async () => ({
      kind: "catalog-subtitle-coverage",
      mode: "read_only",
      status: "policy_unresolved",
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
