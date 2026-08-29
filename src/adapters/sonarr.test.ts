import assert from "node:assert/strict";
import test from "node:test";

import { syntheticSonarrMissingItemsResponse } from "../fixtures/sonarr-missing-items.js";
import { syntheticSonarrEpisodeReleaseResponse } from "../fixtures/sonarr-release-search.js";
import { syntheticSonarrSeasonReleaseResponse } from "../fixtures/sonarr-season-release-search.js";
import { syntheticSonarrSystemStatusResponse } from "../fixtures/sonarr-system-status.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonRequest,
  type JsonTransport,
} from "./http.js";
import {
  mapSonarrReleaseResponse,
  mapSonarrMissingResponse,
  mapSonarrSystemStatus,
  mapSonarrCatalogResponse,
  SonarrAdapterError,
  SonarrGrabError,
  SonarrClient,
} from "./sonarr.js";

class FakeTransport implements JsonTransport {
  readonly requests: JsonRequest[] = [];
  response: JsonResponse = { status: 200, headers: {}, body: [] };
  failure: Error | undefined;

  async requestJson(request: JsonRequest): Promise<JsonResponse> {
    this.requests.push(request);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return this.response;
  }
}

class AddTransport implements JsonTransport {
  readonly requests: JsonRequest[] = [];

  async requestJson(request: JsonRequest): Promise<JsonResponse> {
    this.requests.push(request);
    if (request.method === "GET" && request.path === "/api/v3/rootfolder") {
      return { status: 200, headers: {}, body: [{ id: 3, path: "/private/media/TV", accessible: true, freeSpace: 42 }] };
    }
    if (request.method === "GET" && request.path === "/api/v3/qualityprofile") {
      return { status: 200, headers: {}, body: [{ id: 7, name: "Synthetic HD", items: [{ private: true }] }] };
    }
    if (request.method === "GET" && request.path === "/api/v3/series/lookup") {
      return { status: 200, headers: {}, body: [{ title: "Synthetic Add Series", tvdbId: 12345, id: 0, titleSlug: "synthetic-add-series", images: [], seasons: [], privateField: "must-not-forward" }] };
    }
    if (request.method === "POST" && request.path === "/api/v3/series") {
      return { status: 201, headers: {}, body: { id: 91, title: "Synthetic Add Series", path: "/private/media/TV/Synthetic Add Series" } };
    }
    return { status: 404, headers: {}, body: {} };
  }
}

function client(transport: JsonTransport): SonarrClient {
  return new SonarrClient(
    {
      instanceId: "synthetic-sonarr",
      apiKey: "synthetic-api-key",
      timeoutMs: 2_500,
      maxResponseBytes: 64_000,
    },
    transport,
  );
}

test("PEG-SONARR-001 episode search is bounded, read-only, and authenticates by header", async () => {
  const transport = new FakeTransport();
  await client(transport).searchEpisodeReleases(305);

  assert.deepEqual(transport.requests, [
    {
      method: "GET",
      path: "/api/v3/release",
      query: { episodeId: "305" },
      headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
      timeoutMs: 2_500,
      maxResponseBytes: 64_000,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(transport.requests[0]?.query), /api.?key/iu);
  await assert.rejects(client(transport).searchEpisodeReleases(0), /episodeId/u);
  assert.equal(transport.requests.length, 1);
  assert.throws(
    () =>
      new SonarrClient(
        { instanceId: "https://example.invalid/sonarr", apiKey: "synthetic-api-key" },
        transport,
      ),
    /safe label/u,
  );
});

test("PEG-SONARR-011 catalog lookup finds unadded series and discards private metadata", async () => {
  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: [{
    title: "Synthetic New Series",
    year: 2026,
    tvdbId: 12345,
    tmdbId: 98765,
    imdbId: "tt1234567",
    id: 0,
    overview: "private overview",
    path: "/private/series",
    images: [{ remoteUrl: "https://private.example.invalid/poster.jpg" }],
  }] };

  const items = await client(transport).lookupSeries("  Synthetic New Series  ");
  assert.deepEqual(transport.requests[0], {
    method: "GET",
    path: "/api/v3/series/lookup",
    query: { term: "Synthetic New Series" },
    headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
    timeoutMs: 2_500,
    maxResponseBytes: 64_000,
  });
  assert.deepEqual(items, [{
    application: "sonarr",
    instanceId: "synthetic-sonarr",
    kind: "series",
    title: "Synthetic New Series",
    year: 2026,
    ids: { tvdb: "12345", tmdb: "98765", imdb: "tt1234567" },
    alreadyAdded: false,
  }]);
  assert.doesNotMatch(JSON.stringify(items), /private|overview|path|image|remoteUrl/iu);
  await assert.rejects(client(transport).lookupSeries("x"), /2 through 200/u);
  assert.deepEqual(mapSonarrCatalogResponse([{ title: "Existing", tvdbId: 42, id: 9 }])[0]?.alreadyAdded, true);
});

test("PEG-SONARR-012 add options are sanitized and series add always disables automatic search", async () => {
  const transport = new AddTransport();
  const sonarr = client(transport);
  const options = await sonarr.readCatalogAddOptions();
  assert.deepEqual(options, {
    rootFolders: [{ id: 3, label: "TV", accessible: true }],
    qualityProfiles: [{ id: 7, name: "Synthetic HD" }],
  });
  assert.doesNotMatch(JSON.stringify(options), /private|\/media|freeSpace|items/iu);

  const receipt = await sonarr.addCatalogSeries({
    tvdbId: 12345,
    rootFolderId: 3,
    qualityProfileId: 7,
    monitored: true,
    monitor: "all",
  });
  assert.deepEqual(receipt, {
    status: "added",
    application: "sonarr",
    instanceId: "synthetic-sonarr",
    itemId: 91,
    title: "Synthetic Add Series",
    automaticSearch: false,
  });
  const post = transport.requests.find((request) => request.method === "POST");
  assert.equal(post?.method, "POST");
  if (post?.method !== "POST") return;
  assert.deepEqual(post.body.addOptions, {
    monitor: "all",
    searchForMissingEpisodes: false,
    searchForCutoffUnmetEpisodes: false,
  });
  assert.equal(post.body.rootFolderPath, "/private/media/TV");
  assert.equal(post.body.privateField, undefined);
  assert.doesNotMatch(JSON.stringify(receipt), /private|rootFolderPath|qualityProfile/u);
});

test("PEG-SONARR-002 releases preserve Arr decisions and safe evidence", () => {
  const releases = mapSonarrReleaseResponse(
    syntheticSonarrEpisodeReleaseResponse,
    "synthetic-sonarr",
  );

  assert.equal(releases.length, 4);
  assert.equal(releases[0]?.downloadAllowed, true);
  assert.equal(releases[0]?.customFormatScore, 100);
  assert.equal(releases[0]?.evidence.application, "sonarr");
  assert.equal(releases[0]?.evidence.quality, "WEB 1080p");
  assert.deepEqual(releases[0]?.evidence.customFormats, [
    { id: 7, name: "PT-BR or Multi subtitles" },
  ]);
  assert.equal(releases[2]?.downloadAllowed, false);
  assert.deepEqual(releases[2]?.rejectionReasons, [
    "Quality profile does not allow HDTV-720p",
  ]);
});

test("PEG-SONARR-003 successful empty and malformed responses remain distinct", async () => {
  const transport = new FakeTransport();
  assert.deepEqual(await client(transport).searchEpisodeReleases(305), []);

  transport.response = { status: 200, headers: {}, body: { releases: [] } };
  await assert.rejects(
    client(transport).searchEpisodeReleases(305),
    (error: unknown) => error instanceof SonarrAdapterError && error.code === "invalid_response",
  );
});

test("PEG-SONARR-004 authentication, quota, outage, and transport failures are classified", async () => {
  const cases: readonly {
    readonly response?: JsonResponse;
    readonly failure?: Error;
    readonly code: SonarrAdapterError["code"];
    readonly retryAfterSeconds?: number;
  }[] = [
    { response: { status: 401, headers: {}, body: {} }, code: "unauthorized" },
    {
      response: { status: 429, headers: { "Retry-After": "30" }, body: {} },
      code: "rate_limited",
      retryAfterSeconds: 30,
    },
    { response: { status: 503, headers: {}, body: {} }, code: "unavailable" },
    { failure: new Error("private topology and credential must not escape"), code: "unavailable" },
    {
      failure: new JsonTransportError("response_too_large", "private response detail"),
      code: "invalid_response",
    },
  ];

  for (const testCase of cases) {
    const transport = new FakeTransport();
    if (testCase.response !== undefined) {
      transport.response = testCase.response;
    }
    transport.failure = testCase.failure;

    await assert.rejects(client(transport).searchEpisodeReleases(305), (error: unknown) => {
      assert.ok(error instanceof SonarrAdapterError);
      assert.equal(error.code, testCase.code);
      assert.equal(error.retryAfterSeconds, testCase.retryAfterSeconds);
      assert.doesNotMatch(error.message, /private topology|must not escape/iu);
      return true;
    });
  }
});

test("PEG-SONARR-005 sensitive upstream fields never enter Pegarr release evidence", () => {
  const serialized = JSON.stringify(
    mapSonarrReleaseResponse(syntheticSonarrEpisodeReleaseResponse, "synthetic-sonarr"),
  );

  assert.doesNotMatch(serialized, /synthetic-guid|downloadUrl|magnetUrl|example\.invalid/iu);
  assert.match(serialized, /Synthetic Indexer/u);
});

test("PEG-SONARR-006 system status is bounded and discards private upstream metadata", async () => {
  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: syntheticSonarrSystemStatusResponse };

  assert.deepEqual(await client(transport).readSystemStatus(), {
    appName: "Sonarr",
    version: "5.0.0.0",
    isDocker: true,
  });
  assert.deepEqual(transport.requests, [
    {
      method: "GET",
      path: "/api/v3/system/status",
      query: {},
      headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
      timeoutMs: 2_500,
      maxResponseBytes: 64_000,
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(mapSonarrSystemStatus(syntheticSonarrSystemStatusResponse)),
    /instanceName|startupPath|appData|osName|branch|urlBase|database/iu,
  );

  transport.response = { status: 200, headers: {}, body: { appName: "Not Sonarr", version: "1" } };
  await assert.rejects(
    client(transport).readSystemStatus(),
    (error: unknown) => error instanceof SonarrAdapterError && error.code === "invalid_response",
  );
});

test("PEG-SONARR-007 missing episodes are paged, monitored, and mapped into safe item evidence", async () => {
  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: syntheticSonarrMissingItemsResponse };

  const result = await client(transport).listMissingEpisodes({ page: 1, pageSize: 2 });

  assert.deepEqual(transport.requests, [{
    method: "GET",
    path: "/api/v3/wanted/missing",
    query: {
      page: "1",
      pageSize: "2",
      sortKey: "airDateUtc",
      sortDirection: "descending",
      monitored: "true",
      includeSeries: "true",
    },
    headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
    timeoutMs: 2_500,
    maxResponseBytes: 64_000,
  }]);
  assert.equal(result.totalRecords, 2);
  assert.deepEqual(result.items[0], {
    application: "sonarr",
    instanceId: "synthetic-sonarr",
    kind: "episode",
    itemId: 305,
    parentId: 42,
    title: "Synthetic Episode Five",
    parentTitle: "Synthetic Show",
    year: 2022,
    season: 3,
    episode: 5,
    monitored: true,
    hasFile: false,
    availableAt: "2024-03-05T20:00:00.000Z",
    ids: { imdb: "tt9000005", tmdb: "900005", tvdb: "9000305" },
  });
  await assert.rejects(client(transport).listMissingEpisodes({ pageSize: 101 }), /pageSize/u);
  assert.equal(transport.requests.length, 1);
});

test("PEG-SONARR-008 missing-item mapping rejects malformed envelopes and drops private metadata", async () => {
  const serialized = JSON.stringify(mapSonarrMissingResponse(
    syntheticSonarrMissingItemsResponse,
    "synthetic-sonarr",
  ));
  assert.doesNotMatch(serialized, /private|overview|path|images|poster/iu);

  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: { records: [] } };
  await assert.rejects(
    client(transport).listMissingEpisodes(),
    (error: unknown) => error instanceof SonarrAdapterError && error.code === "invalid_response",
  );
});

test("PEG-SONARR-009 season search preserves full-season and episode coverage evidence", async () => {
  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: syntheticSonarrSeasonReleaseResponse };

  const releases = await client(transport).searchSeasonReleases(42, 3);

  assert.deepEqual(transport.requests, [{
    method: "GET",
    path: "/api/v3/release",
    query: { seriesId: "42", seasonNumber: "3" },
    headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
    timeoutMs: 2_500,
    maxResponseBytes: 64_000,
  }]);
  assert.equal(releases.length, 2);
  assert.deepEqual(releases[0]?.evidence.episodeNumbers, [1, 2, 3, 4, 5, 6]);
  assert.equal(releases[0]?.evidence.fullSeason, true);
  assert.equal(releases[0]?.evidence.seasonNumber, 3);
  assert.equal(releases[1]?.evidence.fullSeason, false);
  assert.deepEqual(releases[1]?.rejectionReasons, [
    "Season search prefers a full-season release",
  ]);
  await assert.rejects(client(transport).searchSeasonReleases(0, 3), /seriesId/u);
  await assert.rejects(client(transport).searchSeasonReleases(42, -1), /seasonNumber/u);
  assert.equal(transport.requests.length, 1);
});

test("PEG-SONARR-010 controlled Grab revalidates and POSTs only the server-side Arr handle", async () => {
  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: syntheticSonarrEpisodeReleaseResponse };
  const releaseId = mapSonarrReleaseResponse(syntheticSonarrEpisodeReleaseResponse, "synthetic-sonarr")[0]!.id;
  const revalidated = await client(transport).revalidateEpisodeRelease(305, releaseId);
  assert.equal(revalidated?.candidate.id, releaseId);
  assert.deepEqual(revalidated?.handle, { guid: "synthetic-guid-1", indexerId: 11 });
  assert.doesNotMatch(JSON.stringify(revalidated?.candidate), /synthetic-guid/iu);

  transport.response = { status: 200, headers: {}, body: {} };
  assert.deepEqual(await client(transport).grabRelease(revalidated!.handle), {
    status: "accepted",
    responseStatus: 200,
  });
  assert.deepEqual(transport.requests.at(-1), {
    method: "POST",
    path: "/api/v3/release",
    query: {},
    headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
    body: { guid: "synthetic-guid-1", indexerId: 11 },
    timeoutMs: 2_500,
    maxResponseBytes: 64_000,
  });

  transport.failure = new JsonTransportError("timeout", "private timeout detail");
  await assert.rejects(
    client(transport).grabRelease(revalidated!.handle),
    (error: unknown) => error instanceof SonarrGrabError && error.code === "timeout" && !/private/u.test(error.message),
  );
});
