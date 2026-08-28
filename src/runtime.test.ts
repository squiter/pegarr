import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveRoute } from "./app.js";
import { loadRuntimeConfiguration, SecretValue } from "./config.js";
import { syntheticSonarrSystemStatusResponse } from "./fixtures/sonarr-system-status.js";
import { syntheticRadarrSystemStatusResponse } from "./fixtures/radarr-system-status.js";
import { syntheticRadarrMissingItemsResponse } from "./fixtures/radarr-missing-items.js";
import { syntheticSonarrMissingItemsResponse } from "./fixtures/sonarr-missing-items.js";
import { syntheticSonarrEpisodeReleaseResponse } from "./fixtures/sonarr-release-search.js";
import {
  syntheticBazarrLanguageProfilesResponse,
  syntheticBazarrSeriesAssignmentResponse,
} from "./fixtures/bazarr-language-policy.js";
import { syntheticSubdlV2EpisodeSearchResponse } from "./fixtures/subdl-v2-subtitle-search.js";
import { syntheticOpenSubtitlesEpisodeSearchResponse } from "./fixtures/opensubtitles-subtitle-search.js";
import { createRuntimeServices } from "./runtime.js";

test("PEG-RUNTIME-001 configured Sonarr status returns only safe read-only evidence", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-runtime-"));
  context.after(async () => rm(directory, { recursive: true }));
  const secretPath = join(directory, "sonarr-api-key");
  const secret = "synthetic-api-key-value";
  await writeFile(secretPath, secret, { mode: 0o600 });
  const configuration = await loadRuntimeConfiguration({
    PEGARR_SONARR_URL: "https://sonarr.example.invalid/root",
    PEGARR_SONARR_ALLOWED_HOSTS: "sonarr.example.invalid",
    PEGARR_SONARR_API_KEY_FILE: secretPath,
    PEGARR_SONARR_INSTANCE_ID: "synthetic-sonarr",
  });

  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  const upstreamBody = JSON.stringify(syntheticSonarrSystemStatusResponse);
  const clock = [1_000, 1_025];
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input, init) => {
      capturedUrl = new URL(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    now: () => clock.shift() ?? 1_025,
  });
  const response = await resolveRoute(
    "GET",
    "/api/v1/integrations/sonarr/status",
    tmpdir(),
    services,
  );
  const serialized = JSON.stringify(response);

  assert.equal(capturedUrl?.pathname, "/root/api/v3/system/status");
  assert.equal(capturedUrl?.search, "");
  assert.equal(capturedHeaders?.get("x-api-key"), secret);
  assert.deepEqual(response, {
    statusCode: 200,
    body: {
      service: "pegarr",
      integration: "sonarr",
      mode: "read_only",
      configured: true,
      state: "available",
      appName: "Sonarr",
      version: "5.0.0.0",
      transportSecurity: "https",
      isDocker: true,
      responseBytes: new TextEncoder().encode(upstreamBody).byteLength,
      latencyMs: 25,
      observedAt: "1970-01-01T00:00:01.025Z",
    },
  });
  assert.doesNotMatch(
    serialized,
    /synthetic-api-key|private instance|startup|app-data|urlBase|database|example\.invalid/iu,
  );
});

test("PEG-RUNTIME-003 upstream failures remain distinct and redact private details", async () => {
  const configuration = {
    sonarr: {
      instanceId: "synthetic-sonarr",
      baseUrl: "https://sonarr.example.invalid",
      allowedHosts: ["sonarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-api-key-value"),
    },
  };
  const cases = [
    { response: new Response("private unauthorized response", { status: 401 }), state: "unauthorized" },
    { response: new Response("private outage response", { status: 503 }), state: "unavailable" },
    { response: new Response("not-json", { status: 200 }), state: "invalid_response" },
  ] as const;

  for (const testCase of cases) {
    const services = createRuntimeServices(configuration, {
      fetchImplementation: async () => testCase.response.clone(),
    });
    const status = await services.readSonarrStatus();

    assert.equal(status.configured, true);
    assert.equal(status.state, testCase.state);
    assert.doesNotMatch(JSON.stringify(status), /private|synthetic-api-key|example\.invalid/iu);
  }
});

test("PEG-RUNTIME-004 concurrent and repeated status reads use one bounded probe window", async () => {
  const configuration = {
    sonarr: {
      instanceId: "synthetic-sonarr",
      baseUrl: "https://sonarr.example.invalid",
      allowedHosts: ["sonarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-api-key-value"),
    },
  };
  let currentTime = 1_000;
  let requestCount = 0;
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async () => {
      requestCount += 1;
      await Promise.resolve();
      return new Response(JSON.stringify(syntheticSonarrSystemStatusResponse), { status: 200 });
    },
    now: () => currentTime,
    sonarrStatusTtlMs: 30_000,
  });

  const [first, concurrent] = await Promise.all([
    services.readSonarrStatus(),
    services.readSonarrStatus(),
  ]);
  const cached = await services.readSonarrStatus();
  assert.equal(requestCount, 1);
  assert.deepEqual(concurrent, first);
  assert.deepEqual(cached, first);

  currentTime += 30_001;
  const refreshed = await services.readSonarrStatus();
  assert.equal(requestCount, 2);
  assert.equal(refreshed.state, "available");
});

test("PEG-RUNTIME-005 configured Radarr status returns measured browser-safe evidence", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-radarr-runtime-"));
  context.after(async () => rm(directory, { recursive: true }));
  const secretPath = join(directory, "radarr-api-key");
  const secret = "synthetic-radarr-key-value";
  await writeFile(secretPath, secret, { mode: 0o600 });
  const configuration = await loadRuntimeConfiguration({
    PEGARR_RADARR_URL: "https://radarr.example.invalid/root",
    PEGARR_RADARR_ALLOWED_HOSTS: "radarr.example.invalid",
    PEGARR_RADARR_API_KEY_FILE: secretPath,
    PEGARR_RADARR_INSTANCE_ID: "synthetic-radarr",
  });

  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  const upstreamBody = JSON.stringify(syntheticRadarrSystemStatusResponse);
  const clock = [2_000, 2_041];
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input, init) => {
      capturedUrl = new URL(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    now: () => clock.shift() ?? 2_041,
  });
  const response = await resolveRoute(
    "GET",
    "/api/v1/integrations/radarr/status",
    tmpdir(),
    services,
  );
  const serialized = JSON.stringify(response);

  assert.equal(capturedUrl?.pathname, "/root/api/v3/system/status");
  assert.equal(capturedUrl?.search, "");
  assert.equal(capturedHeaders?.get("x-api-key"), secret);
  assert.deepEqual(response, {
    statusCode: 200,
    body: {
      service: "pegarr",
      integration: "radarr",
      mode: "read_only",
      configured: true,
      state: "available",
      appName: "Radarr",
      version: "6.0.0.0",
      transportSecurity: "https",
      isDocker: true,
      responseBytes: new TextEncoder().encode(upstreamBody).byteLength,
      latencyMs: 41,
      observedAt: "1970-01-01T00:00:02.041Z",
    },
  });
  assert.doesNotMatch(
    serialized,
    /synthetic-radarr-key|private movie|startup|app-data|urlBase|database|example\.invalid/iu,
  );
});

test("PEG-RUNTIME-006 Radarr failures and refreshes stay classified and bounded", async () => {
  const configuration = {
    radarr: {
      instanceId: "synthetic-radarr",
      baseUrl: "https://radarr.example.invalid",
      allowedHosts: ["radarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-radarr-key-value"),
    },
  };
  let currentTime = 2_000;
  let requestCount = 0;
  let response = new Response("private outage response", { status: 503 });
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async () => {
      requestCount += 1;
      await Promise.resolve();
      return response.clone();
    },
    now: () => currentTime,
    radarrStatusTtlMs: 30_000,
  });

  const [failed, concurrent] = await Promise.all([
    services.readRadarrStatus(),
    services.readRadarrStatus(),
  ]);
  assert.equal(requestCount, 1);
  assert.equal(failed.state, "unavailable");
  assert.deepEqual(concurrent, failed);
  assert.doesNotMatch(JSON.stringify(failed), /private|synthetic-radarr-key|example\.invalid/iu);

  response = new Response(JSON.stringify(syntheticRadarrSystemStatusResponse), { status: 200 });
  currentTime += 30_001;
  const refreshed = await services.readRadarrStatus();
  assert.equal(requestCount, 2);
  assert.equal(refreshed.state, "available");
});

test("PEG-INVENTORY-004 concurrent and repeated runtime inventory reads use one bounded window", async () => {
  const configuration = {
    sonarr: {
      instanceId: "synthetic-sonarr",
      baseUrl: "https://sonarr.example.invalid",
      allowedHosts: ["sonarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-sonarr-key-value"),
    },
    radarr: {
      instanceId: "synthetic-radarr",
      baseUrl: "https://radarr.example.invalid",
      allowedHosts: ["radarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-radarr-key-value"),
    },
  };
  let currentTime = 10_000;
  let requestCount = 0;
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input) => {
      requestCount += 1;
      await Promise.resolve();
      return new Response(JSON.stringify(
        new URL(input).hostname.startsWith("sonarr")
          ? syntheticSonarrMissingItemsResponse
          : syntheticRadarrMissingItemsResponse,
      ), { status: 200, headers: { "content-type": "application/json" } });
    },
    now: () => currentTime,
    missingInventoryTtlMs: 30_000,
    missingInventoryPageSize: 2,
  });

  const [first, concurrent] = await Promise.all([
    services.readMissingInventory(),
    services.readMissingInventory(),
  ]);
  const cached = await services.readMissingInventory();
  assert.equal(requestCount, 2);
  assert.deepEqual(concurrent, first);
  assert.deepEqual(cached, first);
  assert.equal(first.status, "ready");
  assert.doesNotMatch(JSON.stringify(first), /private|overview|path|images|synthetic-(?:sonarr|radarr)-key/iu);

  currentTime += 30_001;
  const refreshed = await services.readMissingInventory();
  assert.equal(requestCount, 4);
  assert.equal(refreshed.status, "ready");
});

test("PEG-ITEM-004 runtime selection composes inventory, Arr, Bazarr, and one scoped provider window", async () => {
  const configuration = {
    sonarr: {
      instanceId: "synthetic-sonarr",
      baseUrl: "https://sonarr.example.invalid",
      allowedHosts: ["sonarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-sonarr-key-value"),
    },
    radarr: {
      instanceId: "synthetic-radarr",
      baseUrl: "https://radarr.example.invalid",
      allowedHosts: ["radarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-radarr-key-value"),
    },
    bazarr: {
      instanceId: "synthetic-bazarr",
      baseUrl: "https://bazarr.example.invalid",
      allowedHosts: ["bazarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-bazarr-key-value"),
    },
    subdl: {
      instanceId: "synthetic-subdl",
      baseUrl: "https://subdl.example.invalid",
      allowedHosts: ["subdl.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-subdl-key-value"),
    },
    subdlLanguageMappings: [{ policyCode: "en", providerCode: "EN" }],
  };
  const requests: string[] = [];
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input) => {
      const url = new URL(input);
      requests.push(`${url.hostname}${url.pathname}`);
      let body: unknown;
      if (url.pathname === "/api/v3/wanted/missing") {
        body = url.hostname.startsWith("sonarr") ? syntheticSonarrMissingItemsResponse : syntheticRadarrMissingItemsResponse;
      } else if (url.hostname.startsWith("sonarr") && url.pathname === "/api/v3/release") {
        body = syntheticSonarrEpisodeReleaseResponse;
      } else if (url.pathname === "/api/system/languages/profiles") {
        body = syntheticBazarrLanguageProfilesResponse;
      } else if (url.pathname === "/api/series") {
        body = syntheticBazarrSeriesAssignmentResponse;
      } else if (url.pathname === "/api/v2/subtitles/search") {
        body = syntheticSubdlV2EpisodeSearchResponse;
      } else {
        return new Response("{}", { status: 404 });
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
    now: () => 1_000,
    missingInventoryPageSize: 2,
  });

  const selection = { application: "sonarr" as const, kind: "episode" as const, itemId: 305 };
  const first = await services.readItemFeasibility(selection);
  const cached = await services.readItemFeasibility(selection);
  const refreshed = await services.readItemFeasibility(selection, { refresh: true });
  services.close();

  assert.equal(first.status, "ready");
  assert.equal(cached.status, "ready");
  assert.equal(refreshed.status, "ready");
  if (first.status === "ready" && cached.status === "ready" && refreshed.status === "ready") {
    assert.equal(first.analysis.source, "computed");
    assert.equal(cached.analysis.source, "memory_cache");
    assert.equal(refreshed.analysis.source, "computed");
    assert.equal(first.report.providerStatus[0]?.cache?.status, "miss");
    assert.equal(refreshed.report.providerStatus[0]?.cache?.status, "hit");
    assert.equal(refreshed.metrics.providerRequests, 0);
  }
  assert.equal(requests.filter((entry) => entry.endsWith("/api/v3/wanted/missing")).length, 2);
  assert.equal(requests.filter((entry) => entry.endsWith("/api/v3/release")).length, 2);
  assert.equal(requests.filter((entry) => entry.includes("bazarr.example.invalid")).length, 4);
  assert.equal(requests.filter((entry) => entry.endsWith("/api/v2/subtitles/search")).length, 1);
  assert.equal(requests.length, 9);
  assert.doesNotMatch(JSON.stringify(first), /synthetic-(?:sonarr|radarr|bazarr|subdl)-key|example\.invalid/iu);
});

test("PEG-RUNTIME-012 runtime planner calls OpenSubtitles only after insufficient preferred evidence", async () => {
  const configuration = {
    sonarr: {
      instanceId: "synthetic-sonarr",
      baseUrl: "https://sonarr.example.invalid",
      allowedHosts: ["sonarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-sonarr-key-value"),
    },
    bazarr: {
      instanceId: "synthetic-bazarr",
      baseUrl: "https://bazarr.example.invalid",
      allowedHosts: ["bazarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-bazarr-key-value"),
    },
    subdl: {
      instanceId: "synthetic-subdl",
      baseUrl: "https://subdl.example.invalid",
      allowedHosts: ["subdl.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-subdl-key-value"),
    },
    opensubtitles: {
      instanceId: "synthetic-opensubtitles",
      baseUrl: "https://opensubtitles.example.invalid/api/v1",
      allowedHosts: ["opensubtitles.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-opensubtitles-key-value"),
    },
    subdlLanguageMappings: [{ policyCode: "en", providerCode: "EN" }],
    opensubtitlesLanguageMappings: [{ policyCode: "en", providerCode: "en" }],
  };
  const providerRequests: { readonly host: string; readonly headers: Headers }[] = [];
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input, init) => {
      const url = new URL(input);
      let body: unknown;
      if (url.pathname === "/api/v3/wanted/missing") {
        body = syntheticSonarrMissingItemsResponse;
      } else if (url.pathname === "/api/v3/release") {
        body = syntheticSonarrEpisodeReleaseResponse;
      } else if (url.pathname === "/api/system/languages/profiles") {
        body = syntheticBazarrLanguageProfilesResponse;
      } else if (url.pathname === "/api/series") {
        body = syntheticBazarrSeriesAssignmentResponse;
      } else if (url.pathname === "/api/v2/subtitles/search") {
        providerRequests.push({ host: url.hostname, headers: new Headers(init?.headers) });
        body = { status: true, results: [], subtitles: [] };
      } else if (url.pathname === "/api/v1/subtitles") {
        providerRequests.push({ host: url.hostname, headers: new Headers(init?.headers) });
        body = syntheticOpenSubtitlesEpisodeSearchResponse;
      } else {
        return new Response("{}", { status: 404 });
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    now: () => 1_000,
    missingInventoryPageSize: 2,
  });

  const result = await services.readItemFeasibility({
    application: "sonarr",
    kind: "episode",
    itemId: 305,
  });
  services.close();

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(providerRequests.map(({ host }) => host), [
    "subdl.example.invalid",
    "opensubtitles.example.invalid",
  ]);
  assert.equal(providerRequests[0]?.headers.get("authorization"), "Bearer synthetic-subdl-key-value");
  assert.equal(providerRequests[1]?.headers.get("api-key"), "synthetic-opensubtitles-key-value");
  assert.equal(providerRequests[1]?.headers.get("user-agent"), "Pegarr v0.1.0");
  assert.deepEqual(result.report.providerStatus.map(({ provider, status }) => ({ provider, status })), [
    { provider: "subdl", status: "success" },
    { provider: "subdl", status: "unsupported" },
    { provider: "subdl", status: "unsupported" },
    { provider: "opensubtitles", status: "success" },
    { provider: "opensubtitles", status: "unsupported" },
    { provider: "opensubtitles", status: "unsupported" },
  ]);
  assert.equal(result.metrics.providerRequests, 2);
  assert.doesNotMatch(
    JSON.stringify(result),
    /synthetic-(?:sonarr|bazarr|subdl|opensubtitles)-key|example\.invalid/iu,
  );
});

test("PEG-RUNTIME-009 scoped analysis selects the exact Arr client", async () => {
  const configuration = {
    sonarrInstances: [
      { instanceId: "sonarr-main", baseUrl: "https://sonarr-main.example.invalid", allowedHosts: ["sonarr-main.example.invalid"], allowInsecureHttp: false, apiKey: new SecretValue("synthetic-sonarr-main-key") },
      { instanceId: "sonarr-anime", baseUrl: "https://sonarr-anime.example.invalid", allowedHosts: ["sonarr-anime.example.invalid"], allowInsecureHttp: false, apiKey: new SecretValue("synthetic-sonarr-anime-key") },
    ],
    bazarr: {
      instanceId: "synthetic-bazarr",
      baseUrl: "https://bazarr.example.invalid",
      allowedHosts: ["bazarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-bazarr-key-value"),
    },
    subdl: {
      instanceId: "synthetic-subdl",
      baseUrl: "https://subdl.example.invalid",
      allowedHosts: ["subdl.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-subdl-key-value"),
    },
    subdlLanguageMappings: [{ policyCode: "en", providerCode: "EN" }],
  };
  const releaseHosts: string[] = [];
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input) => {
      const url = new URL(input);
      let body: unknown;
      if (url.pathname === "/api/v3/wanted/missing") {
        body = syntheticSonarrMissingItemsResponse;
      } else if (url.pathname === "/api/v3/release") {
        releaseHosts.push(url.hostname);
        body = syntheticSonarrEpisodeReleaseResponse;
      } else if (url.pathname === "/api/system/languages/profiles") {
        body = syntheticBazarrLanguageProfilesResponse;
      } else if (url.pathname === "/api/series") {
        body = syntheticBazarrSeriesAssignmentResponse;
      } else if (url.pathname === "/api/v2/subtitles/search") {
        body = syntheticSubdlV2EpisodeSearchResponse;
      } else {
        return new Response("{}", { status: 404 });
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
    now: () => 1_000,
    missingInventoryPageSize: 2,
  });

  const result = await services.readItemFeasibility({
    application: "sonarr",
    instanceId: "sonarr-anime",
    kind: "episode",
    itemId: 305,
  });
  services.close();

  assert.equal(result.status, "ready");
  assert.equal(result.selection.instanceId, "sonarr-anime");
  assert.deepEqual(releaseHosts, ["sonarr-anime.example.invalid"]);
  assert.doesNotMatch(JSON.stringify(result), /example\.invalid|synthetic-sonarr-(?:main|anime)-key/iu);
});

test("PEG-RUNTIME-011 per-instance status probes every configured Arr once per cache window", async () => {
  const configuration = {
    sonarrInstances: [
      { instanceId: "sonarr-main", baseUrl: "https://sonarr-main.example.invalid", allowedHosts: ["sonarr-main.example.invalid"], allowInsecureHttp: false, apiKey: new SecretValue("synthetic-sonarr-main-key") },
      { instanceId: "sonarr-anime", baseUrl: "https://sonarr-anime.example.invalid", allowedHosts: ["sonarr-anime.example.invalid"], allowInsecureHttp: false, apiKey: new SecretValue("synthetic-sonarr-anime-key") },
    ],
    radarrInstances: [
      { instanceId: "radarr-4k", baseUrl: "https://radarr-4k.example.invalid", allowedHosts: ["radarr-4k.example.invalid"], allowInsecureHttp: false, apiKey: new SecretValue("synthetic-radarr-4k-key") },
    ],
  };
  const requests: string[] = [];
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input) => {
      const url = new URL(input);
      requests.push(url.hostname);
      const body = url.hostname.startsWith("radarr") ? syntheticRadarrSystemStatusResponse : syntheticSonarrSystemStatusResponse;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
    now: () => 1_000,
  });

  const first = await services.readArrInstanceStatuses?.();
  const cached = await services.readArrInstanceStatuses?.();
  services.close();

  assert.deepEqual(first?.map(({ integration, instanceId, state }) => ({ integration, instanceId, state })), [
    { integration: "sonarr", instanceId: "sonarr-main", state: "available" },
    { integration: "sonarr", instanceId: "sonarr-anime", state: "available" },
    { integration: "radarr", instanceId: "radarr-4k", state: "available" },
  ]);
  assert.deepEqual(cached, first);
  assert.equal(requests.length, 3);
  assert.doesNotMatch(JSON.stringify(first), /example\.invalid|synthetic-(?:sonarr|radarr).*-key/iu);
});

test("PEG-RUNTIME-010 controlled Grab mutates only the confirmed Arr instance", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-multi-grab-runtime-"));
  context.after(async () => rm(directory, { recursive: true }));
  const configuration = {
    sonarrInstances: [
      { instanceId: "sonarr-main", baseUrl: "https://sonarr-main.example.invalid", allowedHosts: ["sonarr-main.example.invalid"], allowInsecureHttp: false, apiKey: new SecretValue("synthetic-sonarr-main-key") },
      { instanceId: "sonarr-anime", baseUrl: "https://sonarr-anime.example.invalid", allowedHosts: ["sonarr-anime.example.invalid"], allowInsecureHttp: false, apiKey: new SecretValue("synthetic-sonarr-anime-key") },
    ],
    bazarr: { instanceId: "bazarr", baseUrl: "https://bazarr.example.invalid", allowedHosts: ["bazarr.example.invalid"], allowInsecureHttp: false, apiKey: new SecretValue("synthetic-bazarr-key") },
    subdl: { instanceId: "subdl", baseUrl: "https://subdl.example.invalid", allowedHosts: ["subdl.example.invalid"], allowInsecureHttp: false, apiKey: new SecretValue("synthetic-subdl-key") },
    subdlLanguageMappings: [{ policyCode: "en", providerCode: "EN" }],
    accessToken: new SecretValue("synthetic-access-token-value-0000000001"),
    controlledGrab: {
      enabled: true as const,
      adminToken: new SecretValue("synthetic-admin-token-value-00000000001"),
      auditFile: join(directory, "grab-audit.sqlite"),
    },
  };
  const postHosts: string[] = [];
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input, init) => {
      const url = new URL(input);
      if (init?.method === "POST") {
        postHosts.push(url.hostname);
        return new Response(null, { status: 200 });
      }
      let body: unknown;
      if (url.pathname === "/api/v3/wanted/missing") body = syntheticSonarrMissingItemsResponse;
      else if (url.pathname === "/api/v3/release") body = syntheticSonarrEpisodeReleaseResponse;
      else if (url.pathname === "/api/system/languages/profiles") body = syntheticBazarrLanguageProfilesResponse;
      else if (url.pathname === "/api/series") body = syntheticBazarrSeriesAssignmentResponse;
      else if (url.pathname === "/api/v2/subtitles/search") body = syntheticSubdlV2EpisodeSearchResponse;
      else return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
    now: () => 1_000,
    missingInventoryPageSize: 2,
  });
  const selection = { application: "sonarr", instanceId: "sonarr-anime", kind: "episode", itemId: 305 } as const;
  const analysis = await services.readItemFeasibility(selection);
  assert.equal(analysis.status, "ready");
  if (analysis.status !== "ready") return;
  const releaseId = analysis.report.releases.find(({ video }) => video.downloadAllowed)?.releaseId;
  assert.ok(releaseId);
  const prepared = await services.controlledGrab?.prepare(selection, releaseId);
  assert.equal(prepared?.status, "confirmation_required");
  if (prepared?.status !== "confirmation_required") return;
  const result = await services.controlledGrab?.execute(selection, prepared.challengeId, prepared.confirmation, "idempotency_runtime_0001");
  services.close();

  assert.equal(result?.status, "grabbed");
  assert.equal(result?.status === "grabbed" ? result.event.instanceId : undefined, "sonarr-anime");
  assert.deepEqual(postHosts, ["sonarr-anime.example.invalid"]);
});
