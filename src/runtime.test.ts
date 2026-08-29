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
import { syntheticRadarrMovieReleaseResponse } from "./fixtures/radarr-release-search.js";
import { syntheticSonarrMissingItemsResponse } from "./fixtures/sonarr-missing-items.js";
import { syntheticSonarrEpisodeReleaseResponse } from "./fixtures/sonarr-release-search.js";
import { syntheticSonarrSeasonReleaseResponse } from "./fixtures/sonarr-season-release-search.js";
import {
  syntheticBazarrLanguageProfilesResponse,
  syntheticBazarrSeriesAssignmentResponse,
} from "./fixtures/bazarr-language-policy.js";
import { syntheticSubdlV2EpisodeSearchResponse, syntheticSubdlV2MovieSearchResponse, syntheticSubdlV2SeasonSearchResponse } from "./fixtures/subdl-v2-subtitle-search.js";
import { syntheticOpenSubtitlesEpisodeSearchResponse } from "./fixtures/opensubtitles-subtitle-search.js";
import { createRuntimeServices } from "./runtime.js";
import { SubtitleSettingsStore } from "./subtitle-settings.js";

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

test("PEG-ONBOARD-001 onboarding status derives only safe discovery prerequisites and capabilities", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-onboarding-"));
  context.after(async () => rm(directory, { recursive: true }));
  const services = createRuntimeServices({
    sonarr: {
      instanceId: "synthetic-sonarr",
      baseUrl: "https://sonarr.example.invalid",
      allowedHosts: ["sonarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-sonarr-key-value"),
    },
    catalogAdd: { enabled: true },
  }, { dataDirectory: directory });
  context.after(() => services.close());

  assert.deepEqual(await services.readOnboardingStatus?.(), {
    kind: "onboarding-status",
    mode: "read_only",
    status: "setup_required",
    requirements: {
      arrCatalog: { status: "ready", sonarrInstances: 1, radarrInstances: 0 },
      subtitlePolicy: { status: "missing", languageCount: 0 },
      subtitleProvider: { status: "missing", providers: [] },
    },
    capabilities: {
      catalogSearch: true,
      subtitlePreview: false,
      catalogAdd: true,
      controlledGrab: false,
    },
  });

  await services.updateSubtitleSettings({
    languages: [{ code: "pt-BR", required: true, forced: false, hearingImpaired: "either" }],
  });
  await services.updateProviderSettings("subdl", {
    apiKey: "synthetic-provider-key-value",
    languageMappings: [{ policyCode: "pt-BR", providerCode: "PT-BR" }],
  });
  const ready = await services.readOnboardingStatus?.();
  assert.equal(ready?.status, "ready");
  assert.deepEqual(ready?.requirements.subtitleProvider, { status: "ready", providers: ["subdl"] });
  assert.equal(ready?.capabilities.subtitlePreview, true);
  assert.doesNotMatch(JSON.stringify(ready), /synthetic-provider-key|synthetic-sonarr-key|example\.invalid/iu);
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

test("PEG-CATALOG-001 catalog search fans out and preserves partial availability", async () => {
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
  const requests: string[] = [];
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input) => {
      const url = new URL(input);
      requests.push(`${url.hostname}${url.pathname}${url.search}`);
      if (url.hostname === "sonarr.example.invalid" && url.pathname === "/api/v3/series/lookup") {
        return new Response(JSON.stringify([{ title: "Synthetic Discovery", year: 2026, tvdbId: 42, id: 0 }]), { status: 200 });
      }
      return new Response("private radarr outage", { status: 503 });
    },
  });

  const result = await services.searchCatalog("Synthetic Discovery");
  assert.equal(result.status, "partial");
  assert.deepEqual(result.items, [{
    application: "sonarr",
    instanceId: "synthetic-sonarr",
    kind: "series",
    title: "Synthetic Discovery",
    year: 2026,
    ids: { tvdb: "42" },
    alreadyAdded: false,
  }]);
  assert.deepEqual(result.sources, [
    { application: "sonarr", instanceId: "synthetic-sonarr", status: "available" },
    { application: "radarr", instanceId: "synthetic-radarr", status: "unavailable" },
  ]);
  assert.deepEqual(requests.toSorted(), [
    "radarr.example.invalid/api/v3/movie/lookup?term=Synthetic+Discovery",
    "sonarr.example.invalid/api/v3/series/lookup?term=Synthetic+Discovery",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private|example\.invalid|key-value/iu);
});

test("PEG-CATALOG-003 pre-add series coverage uses stored policy and honest provider evidence", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-catalog-coverage-"));
  context.after(async () => rm(directory, { recursive: true }));
  await new SubtitleSettingsStore(directory).update({ languages: [
    { code: "pt-BR", required: true, forced: false, hearingImpaired: "either" },
  ] });
  const configuration = {
    sonarr: {
      instanceId: "synthetic-sonarr",
      baseUrl: "https://sonarr.example.invalid",
      allowedHosts: ["sonarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-sonarr-key-value"),
    },
    subdl: {
      instanceId: "subdl",
      baseUrl: "https://subdl.example.invalid",
      allowedHosts: ["subdl.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-subdl-key-value"),
    },
    subdlLanguageMappings: [{ policyCode: "pt-BR", providerCode: "PT-BR" }],
  };
  const requests: URL[] = [];
  const services = createRuntimeServices(configuration, {
    dataDirectory: directory,
    fetchImplementation: async (input) => {
      const url = new URL(input);
      requests.push(url);
      if (url.pathname === "/api/v3/series/lookup") {
        return new Response(JSON.stringify([{ title: "Synthetic Discovery", year: 2026, tvdbId: 42, tmdbId: 84, imdbId: "tt1234567", id: 0 }]), { status: 200 });
      }
      if (url.pathname === "/api/v2/subtitles/search") {
        return new Response(JSON.stringify(syntheticSubdlV2EpisodeSearchResponse), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  });

  const result = await services.previewCatalogCoverage({ application: "sonarr", instanceId: "synthetic-sonarr", providerId: "tvdb", value: "42" });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.item.title, "Synthetic Discovery");
  assert.equal(result.languages[0]?.state, "available");
  assert.ok((result.languages[0]?.subtitleCount ?? 0) > 0);
  assert.equal(result.providers[0]?.status, "success");
  assert.equal(requests[0]?.searchParams.get("term"), "tvdb:42");
  assert.equal(requests[1]?.searchParams.get("type"), "tv");
  assert.equal(requests[1]?.searchParams.has("season"), false);
  assert.doesNotMatch(JSON.stringify(result), /release_name|download|api.?key|example\.invalid/iu);
});

test("PEG-CATALOG-005 a UI-configured provider is usable immediately for pre-add coverage", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-ui-provider-coverage-"));
  context.after(async () => rm(directory, { recursive: true }));
  await new SubtitleSettingsStore(directory).update({ languages: [
    { code: "pt-BR", required: true, forced: false, hearingImpaired: "either" },
  ] });
  const configuration = {
    sonarr: {
      instanceId: "synthetic-sonarr",
      baseUrl: "https://sonarr.example.invalid",
      allowedHosts: ["sonarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-sonarr-key-value"),
    },
  };
  const providerKey = "synthetic-ui-subdl-key-value";
  let providerAuthorization: string | null = null;
  const services = createRuntimeServices(configuration, {
    dataDirectory: directory,
    fetchImplementation: async (input, init) => {
      const url = new URL(input);
      if (url.hostname === "sonarr.example.invalid" && url.pathname === "/api/v3/series/lookup") {
        return new Response(JSON.stringify([{ title: "Synthetic Discovery", year: 2026, tvdbId: 42, tmdbId: 84, imdbId: "tt1234567", id: 0 }]), { status: 200 });
      }
      if (url.hostname === "api.subdl.com" && url.pathname === "/api/v2/subtitles/search") {
        providerAuthorization = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify(syntheticSubdlV2EpisodeSearchResponse), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  });

  assert.equal((await services.previewCatalogCoverage({ application: "sonarr", instanceId: "synthetic-sonarr", providerId: "tvdb", value: "42" })).status, "provider_unconfigured");
  const settings = await services.updateProviderSettings("subdl", {
    apiKey: providerKey,
    languageMappings: [{ policyCode: "pt-BR", providerCode: "PT-BR" }],
  });
  assert.equal(settings.providers[0]?.origin, "ui");
  assert.doesNotMatch(JSON.stringify(settings), /synthetic-ui-subdl-key-value/u);

  const result = await services.previewCatalogCoverage({ application: "sonarr", instanceId: "synthetic-sonarr", providerId: "tvdb", value: "42" });
  assert.equal(result.status, "ready");
  assert.equal(providerAuthorization, `Bearer ${providerKey}`);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-ui-subdl-key-value|api\.subdl\.com/iu);
  services.close();
});

test("PEG-CATALOG-008 PEG-CONTINUE-001 catalog add returns a bounded server-owned continuation", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-catalog-add-"));
  context.after(async () => rm(directory, { recursive: true }));
  const configuration = {
    radarr: {
      instanceId: "synthetic-radarr",
      baseUrl: "https://radarr.example.invalid",
      allowedHosts: ["radarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-radarr-key-value"),
    },
    catalogAdd: { enabled: true as const },
  };
  const requests: Array<{ method: string; url: URL; body?: unknown }> = [];
  let currentTime = 1_000;
  const services = createRuntimeServices(configuration, {
    dataDirectory: directory,
    now: () => currentTime,
    fetchImplementation: async (input, init) => {
      const url = new URL(input);
      const method = init?.method ?? "GET";
      requests.push({
        method,
        url,
        ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as unknown } : {}),
      });
      if (url.pathname === "/api/v3/movie/lookup") {
        return new Response(JSON.stringify([{
          title: "Synthetic Add Movie",
          year: 2026,
          tmdbId: 42,
          id: 0,
          images: [{ coverType: "poster", remoteUrl: "https://private.example.invalid/poster.jpg" }],
        }]), { status: 200 });
      }
      if (url.pathname === "/api/v3/rootfolder") {
        return new Response(JSON.stringify([{ id: 4, path: "/private/media/Movies", accessible: true, freeSpace: 123 }]), { status: 200 });
      }
      if (url.pathname === "/api/v3/qualityprofile") {
        return new Response(JSON.stringify([{ id: 8, name: "Synthetic UHD", items: ["private"] }]), { status: 200 });
      }
      if (url.pathname === "/api/v3/movie" && method === "POST") {
        return new Response(JSON.stringify({ id: 93 }), { status: 201 });
      }
      if (url.pathname === "/api/v3/movie/93") {
        return new Response(JSON.stringify({ id: 93, title: "Synthetic Add Movie", tmdbId: 42 }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  });

  const selection = { application: "radarr" as const, instanceId: "synthetic-radarr", providerId: "tmdb" as const, value: "42" };
  assert.ok(services.catalogAdd);
  const options = await services.catalogAdd.readOptions(selection);
  assert.deepEqual(options, {
    kind: "catalog-add-options",
    mode: "catalog_add",
    title: "Synthetic Add Movie",
    confirmation: "ADD Synthetic Add Movie TO RADARR",
    rootFolders: [{ id: 4, label: "Movies", accessible: true }],
    qualityProfiles: [{ id: 8, name: "Synthetic UHD" }],
    defaults: { monitored: true, minimumAvailability: "released" },
  });
  assert.doesNotMatch(JSON.stringify(options), /private|rootFolderPath|freeSpace|items|api.?key/iu);

  const input = { rootFolderId: 4, qualityProfileId: 8, monitored: true, minimumAvailability: "released" as const };
  const postsBeforeConfirmation = requests.filter(({ method }) => method === "POST").length;
  await assert.rejects(
    services.catalogAdd.add(selection, { ...input, confirmation: "wrong" }),
    /confirmation does not match/u,
  );
  assert.equal(requests.filter(({ method }) => method === "POST").length, postsBeforeConfirmation);

  const result = await services.catalogAdd.add(selection, { ...input, confirmation: options.confirmation });
  assert.equal(result.status, "added");
  assert.deepEqual(result.receipt, {
      status: "added",
      application: "radarr",
      instanceId: "synthetic-radarr",
      itemId: 93,
      title: "Synthetic Add Movie",
      automaticSearch: false,
  });
  assert.equal(result.next.action, "exact_movie_release_analysis");
  assert.match(result.next.continuationId, /^[A-Za-z0-9_-]{32}$/u);
  assert.equal(result.next.expiresAt, "1970-01-01T00:10:01.000Z");
  assert.deepEqual({
    kind: "catalog-add",
    mode: "catalog_add",
    status: "added",
  }, { kind: result.kind, mode: result.mode, status: result.status });
  const post = requests.find(({ method }) => method === "POST");
  assert.deepEqual((post?.body as { addOptions?: unknown } | undefined)?.addOptions, {
    monitor: "movieOnly",
    searchForMovie: false,
    addMethod: "manual",
  });
  assert.doesNotMatch(JSON.stringify(result), /private|rootFolder|qualityProfile|confirmation|api.?key/iu);
  assert.equal((await services.catalogContinuation?.analyze(result.next.continuationId))?.status, "policy_unresolved");
  currentTime += 600_001;
  assert.equal((await services.catalogContinuation?.analyze(result.next.continuationId))?.status, "not_found");
  services.close();
});

test("PEG-CONTINUE-002 PEG-CONTINUE-007 Radarr continuation analysis can prepare and execute only an explicit controlled Grab", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-radarr-continuation-"));
  context.after(async () => rm(directory, { recursive: true }));
  await new SubtitleSettingsStore(directory).update({ languages: [
    { code: "pt-BR", required: true, forced: false, hearingImpaired: "either" },
  ] });
  const configuration = {
    radarr: {
      instanceId: "synthetic-radarr",
      baseUrl: "https://radarr.example.invalid",
      allowedHosts: ["radarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-radarr-key-value"),
    },
    subdl: {
      instanceId: "subdl",
      baseUrl: "https://subdl.example.invalid",
      allowedHosts: ["subdl.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-subdl-key-value"),
    },
    subdlLanguageMappings: [{ policyCode: "pt-BR", providerCode: "PT-BR" }],
    catalogAdd: { enabled: true as const },
    controlledGrab: {
      enabled: true as const,
      adminToken: new SecretValue("synthetic-admin-token-value-00000000004"),
      auditFile: join(directory, "grab-audit.sqlite"),
    },
  };
  const requests: string[] = [];
  let releasePosts = 0;
  const services = createRuntimeServices(configuration, {
    dataDirectory: directory,
    now: () => 10_000,
    fetchImplementation: async (input, init) => {
      const url = new URL(input);
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url.hostname}${url.pathname}${url.search}`);
      if (url.hostname === "radarr.example.invalid" && url.pathname === "/api/v3/movie/lookup") {
        return new Response(JSON.stringify([{ title: "Synthetic Movie", year: 2025, tmdbId: 84, imdbId: "tt7654321", id: 0 }]), { status: 200 });
      }
      if (url.pathname === "/api/v3/rootfolder") return new Response(JSON.stringify([{ id: 4, path: "/private/media/Movies", accessible: true }]), { status: 200 });
      if (url.pathname === "/api/v3/qualityprofile") return new Response(JSON.stringify([{ id: 8, name: "Synthetic UHD" }]), { status: 200 });
      if (url.hostname === "radarr.example.invalid" && url.pathname === "/api/v3/movie" && method === "POST") return new Response(JSON.stringify({ id: 93 }), { status: 201 });
      if (url.hostname === "radarr.example.invalid" && url.pathname === "/api/v3/movie/93") return new Response(JSON.stringify({ id: 93, title: "Synthetic Movie", tmdbId: 84 }), { status: 200 });
      if (url.hostname === "radarr.example.invalid" && url.pathname === "/api/v3/release") {
        if (method === "POST") {
          releasePosts += 1;
          return new Response(null, { status: 200 });
        }
        return new Response(JSON.stringify(syntheticRadarrMovieReleaseResponse), { status: 200 });
      }
      if (url.hostname === "subdl.example.invalid" && url.pathname === "/api/v2/subtitles/search") return new Response(JSON.stringify(syntheticSubdlV2MovieSearchResponse), { status: 200 });
      return new Response("not found", { status: 404 });
    },
  });
  assert.ok(services.catalogAdd);
  assert.ok(services.catalogContinuation);
  const selection = { application: "radarr" as const, instanceId: "synthetic-radarr", providerId: "tmdb" as const, value: "84" };
  const options = await services.catalogAdd.readOptions(selection);
  const added = await services.catalogAdd.add(selection, {
    rootFolderId: 4,
    qualityProfileId: 8,
    monitored: true,
    minimumAvailability: "released",
    confirmation: options.confirmation,
  });
  const result = await services.catalogContinuation.analyze(added.next.continuationId);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.selection.itemId, 93);
  assert.equal(result.report.item.title, "Synthetic Movie");
  assert.equal(result.report.policy.source, "explicit_default");
  assert.ok(result.report.releases.length > 0);
  assert.deepEqual(result.capabilities, { controlledGrab: true });
  const releaseId = result.report.releases.find(({ video }) => video.downloadAllowed)?.releaseId;
  assert.ok(releaseId);
  const prepared = await services.catalogContinuation.prepareGrab(added.next.continuationId, releaseId);
  assert.equal(prepared.status, "confirmation_required");
  if (prepared.status !== "confirmation_required") return;
  assert.equal(prepared.confirmation, `GRAB ${prepared.releaseTitle} FOR Synthetic Movie (2025)`);
  const grabbed = await services.catalogContinuation.executeGrab(
    added.next.continuationId,
    prepared.challengeId,
    prepared.confirmation,
    "continuation_movie_runtime_0001",
  );
  assert.equal(grabbed.status, "grabbed");
  assert.equal(releasePosts, 1);
  await services.catalogContinuation.analyze(added.next.continuationId);
  assert.equal(requests.filter((entry) => entry.startsWith("GET ") && entry.includes("/api/v3/release")).length, 3);
  assert.equal(requests.filter((entry) => entry.includes("/api/v2/subtitles/search")).length, 1);
  assert.doesNotMatch(JSON.stringify(result), /private|api.?key|example\.invalid|download.*handle/iu);
  services.close();
});

test("PEG-CONTINUE-004 PEG-CONTINUE-005 PEG-CONTINUE-008 Sonarr continuation accepts only issued scopes and exact episodes can use controlled Grab", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-sonarr-continuation-"));
  context.after(async () => rm(directory, { recursive: true }));
  await new SubtitleSettingsStore(directory).update({ languages: [
    { code: "pt-BR", required: true, forced: false, hearingImpaired: "either" },
  ] });
  const configuration = {
    sonarr: {
      instanceId: "synthetic-sonarr",
      baseUrl: "https://sonarr.example.invalid",
      allowedHosts: ["sonarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-sonarr-key-value"),
    },
    subdl: {
      instanceId: "subdl",
      baseUrl: "https://subdl.example.invalid",
      allowedHosts: ["subdl.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-subdl-key-value"),
    },
    subdlLanguageMappings: [{ policyCode: "pt-BR", providerCode: "PT-BR" }],
    catalogAdd: { enabled: true as const },
    controlledGrab: {
      enabled: true as const,
      adminToken: new SecretValue("synthetic-admin-token-value-00000000003"),
      auditFile: join(directory, "grab-audit.sqlite"),
    },
  };
  const requests: URL[] = [];
  let releasePosts = 0;
  const services = createRuntimeServices(configuration, {
    dataDirectory: directory,
    now: () => 20_000,
    fetchImplementation: async (input, init) => {
      const url = new URL(input);
      requests.push(url);
      const method = init?.method ?? "GET";
      if (url.hostname === "sonarr.example.invalid" && url.pathname === "/api/v3/series/lookup") {
        return new Response(JSON.stringify([{ title: "Synthetic Show", year: 2024, tvdbId: 42, tmdbId: 900005, imdbId: "tt9000005", id: 0, seasons: [] }]), { status: 200 });
      }
      if (url.pathname === "/api/v3/rootfolder") return new Response(JSON.stringify([{ id: 3, path: "/private/media/TV", accessible: true }]), { status: 200 });
      if (url.pathname === "/api/v3/qualityprofile") return new Response(JSON.stringify([{ id: 7, name: "Synthetic HD" }]), { status: 200 });
      if (url.hostname === "sonarr.example.invalid" && url.pathname === "/api/v3/series" && method === "POST") return new Response(JSON.stringify({ id: 91 }), { status: 201 });
      if (url.hostname === "sonarr.example.invalid" && url.pathname === "/api/v3/series/91") return new Response(JSON.stringify({ id: 91, title: "Synthetic Show", tvdbId: 42 }), { status: 200 });
      if (url.hostname === "sonarr.example.invalid" && url.pathname === "/api/v3/episode") {
        return new Response(JSON.stringify([
          { id: 305, seasonNumber: 3, episodeNumber: 5, title: "Synthetic Episode" },
          { id: 306, seasonNumber: 3, episodeNumber: 6, title: "Another Episode" },
        ]), { status: 200 });
      }
      if (url.hostname === "sonarr.example.invalid" && url.pathname === "/api/v3/release") {
        if (method === "POST") {
          releasePosts += 1;
          return new Response(null, { status: 200 });
        }
        return new Response(JSON.stringify(url.searchParams.has("seasonNumber") ? syntheticSonarrSeasonReleaseResponse : syntheticSonarrEpisodeReleaseResponse), { status: 200 });
      }
      if (url.hostname === "subdl.example.invalid" && url.pathname === "/api/v2/subtitles/search") {
        return new Response(JSON.stringify(url.searchParams.has("episode") ? syntheticSubdlV2EpisodeSearchResponse : syntheticSubdlV2SeasonSearchResponse), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  assert.ok(services.catalogAdd);
  assert.ok(services.catalogContinuation);
  const selection = { application: "sonarr" as const, instanceId: "synthetic-sonarr", providerId: "tvdb" as const, value: "42" };
  const options = await services.catalogAdd.readOptions(selection);
  const added = await services.catalogAdd.add(selection, {
    rootFolderId: 3,
    qualityProfileId: 7,
    monitored: true,
    monitor: "all",
    confirmation: options.confirmation,
  });
  const scopes = await services.catalogContinuation.scopes(added.next.continuationId);
  assert.equal(scopes.status, "ready");
  if (scopes.status !== "ready") return;
  assert.deepEqual(scopes.seasons, [{ seasonNumber: 3, label: "Season 3", episodeCount: 2 }]);
  assert.deepEqual(scopes.episodes.map(({ episodeId }) => episodeId), [305, 306]);
  const releasesBeforeInvalidScope = requests.filter(({ pathname }) => pathname === "/api/v3/release").length;
  assert.equal((await services.catalogContinuation.analyze(added.next.continuationId, { kind: "episode", episodeId: 999 })).status, "scope_not_found");
  assert.equal(requests.filter(({ pathname }) => pathname === "/api/v3/release").length, releasesBeforeInvalidScope);

  const season = await services.catalogContinuation.analyze(added.next.continuationId, { kind: "season", seasonNumber: 3 });
  assert.equal(season.status, "ready");
  if (season.status !== "ready") return;
  assert.equal(season.report.item.kind, "season");
  assert.equal(season.report.item.season, 3);
  assert.equal(season.report.policy.source, "explicit_default");
  assert.deepEqual(season.capabilities, { controlledGrab: false });
  const episode = await services.catalogContinuation.analyze(added.next.continuationId, { kind: "episode", episodeId: 305 });
  assert.equal(episode.status, "ready");
  if (episode.status !== "ready") return;
  assert.equal(episode.report.item.kind, "episode");
  assert.equal(episode.report.item.episode, 5);
  assert.deepEqual(episode.capabilities, { controlledGrab: true });
  const releaseId = episode.report.releases.find(({ video }) => video.downloadAllowed)?.releaseId;
  assert.ok(releaseId);
  const seasonPrepare = await services.catalogContinuation.prepareGrab(
    added.next.continuationId,
    releaseId,
    { kind: "season", seasonNumber: 3 },
  );
  assert.equal(seasonPrepare.status, "item_unavailable");
  assert.equal("detailCode" in seasonPrepare ? seasonPrepare.detailCode : undefined, "scope_not_grabbable");
  const prepared = await services.catalogContinuation.prepareGrab(
    added.next.continuationId,
    releaseId,
    { kind: "episode", episodeId: 305 },
  );
  assert.equal(prepared.status, "confirmation_required");
  if (prepared.status !== "confirmation_required") return;
  assert.equal(prepared.confirmation, `GRAB ${prepared.releaseTitle} FOR Synthetic Show S03E05 · Synthetic Episode`);
  const grabbed = await services.catalogContinuation.executeGrab(
    added.next.continuationId,
    prepared.challengeId,
    prepared.confirmation,
    "continuation_runtime_0001",
    { kind: "episode", episodeId: 305 },
  );
  assert.equal(grabbed.status, "grabbed");
  assert.equal(releasePosts, 1);
  assert.equal(requests.filter(({ pathname }) => pathname === "/api/v3/episode").length, 1);
  assert.equal(requests.filter(({ pathname }) => pathname === "/api/v3/release").length, 5);
  assert.doesNotMatch(JSON.stringify({ scopes, season, episode }), /private|api.?key|example\.invalid|download.*handle/iu);
  services.close();
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
