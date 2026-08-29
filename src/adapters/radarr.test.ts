import assert from "node:assert/strict";
import test from "node:test";

import { syntheticRadarrMissingItemsResponse } from "../fixtures/radarr-missing-items.js";
import { syntheticRadarrMovieReleaseResponse } from "../fixtures/radarr-release-search.js";
import { syntheticRadarrSystemStatusResponse } from "../fixtures/radarr-system-status.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonRequest,
  type JsonTransport,
} from "./http.js";
import {
  mapRadarrReleaseResponse,
  mapRadarrMissingResponse,
  mapRadarrSystemStatus,
  mapRadarrCatalogResponse,
  RadarrAdapterError,
  RadarrGrabError,
  RadarrClient,
} from "./radarr.js";

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
  verificationBody: unknown = { id: 92, title: "Synthetic Add Movie", tmdbId: 54321, path: "/private/media/Movies/Synthetic Add Movie" };

  async requestJson(request: JsonRequest): Promise<JsonResponse> {
    this.requests.push(request);
    if (request.method === "GET" && request.path === "/api/v3/rootfolder") {
      return { status: 200, headers: {}, body: [{ id: 4, path: "/private/media/Movies", accessible: true, freeSpace: 42 }] };
    }
    if (request.method === "GET" && request.path === "/api/v3/qualityprofile") {
      return { status: 200, headers: {}, body: [{ id: 8, name: "Synthetic UHD", items: [{ private: true }] }] };
    }
    if (request.method === "GET" && request.path === "/api/v3/movie/lookup") {
      return { status: 200, headers: {}, body: [{ title: "Synthetic Add Movie", tmdbId: 54321, id: 0, titleSlug: "54321", images: [], privateField: "must-not-forward" }] };
    }
    if (request.method === "POST" && request.path === "/api/v3/movie") {
      return { status: 201, headers: {}, body: { id: 92, title: "Synthetic Add Movie", path: "/private/media/Movies/Synthetic Add Movie" } };
    }
    if (request.method === "GET" && request.path === "/api/v3/movie/92") {
      return { status: 200, headers: {}, body: this.verificationBody };
    }
    return { status: 404, headers: {}, body: {} };
  }
}

function client(transport: JsonTransport): RadarrClient {
  return new RadarrClient(
    {
      instanceId: "synthetic-radarr",
      apiKey: "synthetic-api-key",
      timeoutMs: 2_500,
      maxResponseBytes: 64_000,
    },
    transport,
  );
}

test("PEG-RADARR-001 movie search is bounded, read-only, and authenticates by header", async () => {
  const transport = new FakeTransport();
  await client(transport).searchMovieReleases(42);

  assert.deepEqual(transport.requests, [
    {
      method: "GET",
      path: "/api/v3/release",
      query: { movieId: "42" },
      headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
      timeoutMs: 2_500,
      maxResponseBytes: 64_000,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(transport.requests[0]?.query), /api.?key/iu);
  await assert.rejects(client(transport).searchMovieReleases(0), /movieId/u);
  assert.equal(transport.requests.length, 1);
  assert.throws(
    () =>
      new RadarrClient(
        { instanceId: "https://example.invalid/radarr", apiKey: "synthetic-api-key" },
        transport,
      ),
    /safe label/u,
  );
});

test("PEG-RADARR-010 catalog lookup finds unadded movies and discards private metadata", async () => {
  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: [{
    title: "Synthetic New Movie",
    year: 2025,
    tmdbId: 54321,
    imdbId: "tt7654321",
    id: 0,
    overview: "private overview",
    folderName: "private-folder",
    images: [{ remoteUrl: "https://private.example.invalid/poster.jpg" }],
  }] };

  const items = await client(transport).lookupMovies("  Synthetic New Movie  ");
  assert.deepEqual(transport.requests[0], {
    method: "GET",
    path: "/api/v3/movie/lookup",
    query: { term: "Synthetic New Movie" },
    headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
    timeoutMs: 2_500,
    maxResponseBytes: 64_000,
  });
  assert.deepEqual(items, [{
    application: "radarr",
    instanceId: "synthetic-radarr",
    kind: "movie",
    title: "Synthetic New Movie",
    year: 2025,
    ids: { tmdb: "54321", imdb: "tt7654321" },
    alreadyAdded: false,
  }]);
  assert.doesNotMatch(JSON.stringify(items), /private|overview|folder|image|remoteUrl/iu);
  await assert.rejects(client(transport).lookupMovies("x"), /2 through 200/u);
  assert.equal(mapRadarrCatalogResponse([{ title: "Existing", tmdbId: 42, id: 9 }])[0]?.alreadyAdded, true);
});

test("PEG-RADARR-011 add options are sanitized and movie add always disables automatic search", async () => {
  const transport = new AddTransport();
  const radarr = client(transport);
  const options = await radarr.readCatalogAddOptions();
  assert.deepEqual(options, {
    rootFolders: [{ id: 4, label: "Movies", accessible: true }],
    qualityProfiles: [{ id: 8, name: "Synthetic UHD" }],
  });
  assert.doesNotMatch(JSON.stringify(options), /private|\/media|freeSpace|items/iu);

  const receipt = await radarr.addCatalogMovie({
    tmdbId: 54321,
    rootFolderId: 4,
    qualityProfileId: 8,
    monitored: true,
    minimumAvailability: "released",
  });
  assert.deepEqual(receipt, {
    status: "added",
    application: "radarr",
    instanceId: "synthetic-radarr",
    itemId: 92,
    title: "Synthetic Add Movie",
    automaticSearch: false,
  });
  const post = transport.requests.find((request) => request.method === "POST");
  assert.equal(post?.method, "POST");
  if (post?.method !== "POST") return;
  assert.deepEqual(post.body.addOptions, {
    monitor: "movieOnly",
    searchForMovie: false,
    addMethod: "manual",
  });
  assert.equal(post.body.rootFolderPath, "/private/media/Movies");
  assert.equal(post.body.privateField, undefined);
  assert.doesNotMatch(JSON.stringify(receipt), /private|rootFolderPath|qualityProfile/u);
});

test("PEG-RADARR-012 added movie identity is re-read before Pegarr continues", async () => {
  const transport = new AddTransport();
  const receipt = await client(transport).addCatalogMovie({
    tmdbId: 54321, rootFolderId: 4, qualityProfileId: 8, monitored: true, minimumAvailability: "released",
  });
  assert.equal(receipt.itemId, 92);
  const verification = transport.requests.at(-1);
  assert.deepEqual(verification, {
    method: "GET", path: "/api/v3/movie/92", query: {},
    headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
    timeoutMs: 2_500, maxResponseBytes: 64_000,
  });
  const mismatched = new AddTransport();
  mismatched.verificationBody = { id: 92, title: "Wrong Movie", tmdbId: 99999 };
  await assert.rejects(
    client(mismatched).addCatalogMovie({ tmdbId: 54321, rootFolderId: 4, qualityProfileId: 8, monitored: true, minimumAvailability: "released" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "verification_unknown",
  );
});

test("PEG-RADARR-002 movie releases preserve Arr decisions, editions, and safe evidence", () => {
  const releases = mapRadarrReleaseResponse(
    syntheticRadarrMovieReleaseResponse,
    "synthetic-radarr",
  );

  assert.equal(releases.length, 2);
  assert.equal(releases[0]?.downloadAllowed, true);
  assert.equal(releases[0]?.customFormatScore, 100);
  assert.equal(releases[0]?.evidence.application, "radarr");
  assert.equal(releases[0]?.evidence.quality, "Bluray-1080p");
  assert.equal(releases[0]?.traits?.edition, "Director's Cut");
  assert.deepEqual(releases[1]?.rejectionReasons, [
    "Quality profile does not allow WEB-720p",
  ]);
});

test("PEG-RADARR-003 successful empty and malformed responses remain distinct", async () => {
  const transport = new FakeTransport();
  assert.deepEqual(await client(transport).searchMovieReleases(42), []);

  transport.response = { status: 200, headers: {}, body: { releases: [] } };
  await assert.rejects(
    client(transport).searchMovieReleases(42),
    (error: unknown) => error instanceof RadarrAdapterError && error.code === "invalid_response",
  );
});

test("PEG-RADARR-004 authentication, quota, outage, and transport failures are classified", async () => {
  const cases: readonly {
    readonly response?: JsonResponse;
    readonly failure?: Error;
    readonly code: RadarrAdapterError["code"];
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

    await assert.rejects(client(transport).searchMovieReleases(42), (error: unknown) => {
      assert.ok(error instanceof RadarrAdapterError);
      assert.equal(error.code, testCase.code);
      assert.equal(error.retryAfterSeconds, testCase.retryAfterSeconds);
      assert.doesNotMatch(error.message, /private topology|must not escape/iu);
      return true;
    });
  }
});

test("PEG-RADARR-005 selection secrets never enter Pegarr movie-release evidence", () => {
  const serialized = JSON.stringify(
    mapRadarrReleaseResponse(syntheticRadarrMovieReleaseResponse, "synthetic-radarr"),
  );

  assert.doesNotMatch(
    serialized,
    /synthetic-radarr-guid|downloadUrl|magnetUrl|infoHash|example\.invalid/iu,
  );
  assert.match(serialized, /Synthetic Movie Indexer/u);
});

test("PEG-RADARR-006 system status is bounded and discards private upstream metadata", async () => {
  const transport = new FakeTransport();
  transport.response = {
    status: 200,
    headers: {},
    body: syntheticRadarrSystemStatusResponse,
    responseBytes: 512,
  };

  assert.deepEqual(await client(transport).readSystemStatus(), {
    appName: "Radarr",
    version: "6.0.0.0",
    isDocker: true,
    responseBytes: 512,
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
    JSON.stringify(mapRadarrSystemStatus(syntheticRadarrSystemStatusResponse)),
    /instanceName|startupPath|appData|osName|branch|urlBase|database/iu,
  );

  transport.response = { status: 200, headers: {}, body: { appName: "Not Radarr", version: "1" } };
  await assert.rejects(
    client(transport).readSystemStatus(),
    (error: unknown) => error instanceof RadarrAdapterError && error.code === "invalid_response",
  );
});

test("PEG-RADARR-007 missing movies are paged, monitored, and mapped into safe item evidence", async () => {
  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: syntheticRadarrMissingItemsResponse };

  const result = await client(transport).listMissingMovies({ page: 1, pageSize: 2 });

  assert.deepEqual(transport.requests, [{
    method: "GET",
    path: "/api/v3/wanted/missing",
    query: {
      page: "1",
      pageSize: "2",
      sortKey: "releaseDate",
      sortDirection: "descending",
      monitored: "true",
    },
    headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
    timeoutMs: 2_500,
    maxResponseBytes: 64_000,
  }]);
  assert.equal(result.totalRecords, 2);
  assert.deepEqual(result.items[0], {
    application: "radarr",
    instanceId: "synthetic-radarr",
    kind: "movie",
    itemId: 84,
    title: "Synthetic Movie",
    year: 2024,
    monitored: true,
    hasFile: false,
    availableAt: "2024-05-12T00:00:00.000Z",
    ids: { imdb: "tt9000084", tmdb: "900084" },
  });
  await assert.rejects(client(transport).listMissingMovies({ page: 0 }), /page/u);
  assert.equal(transport.requests.length, 1);
});

test("PEG-RADARR-008 missing-item mapping rejects malformed envelopes and drops private metadata", async () => {
  const serialized = JSON.stringify(mapRadarrMissingResponse(
    syntheticRadarrMissingItemsResponse,
    "synthetic-radarr",
  ));
  assert.doesNotMatch(serialized, /private|overview|path|images|fanart/iu);

  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: { records: [] } };
  await assert.rejects(
    client(transport).listMissingMovies(),
    (error: unknown) => error instanceof RadarrAdapterError && error.code === "invalid_response",
  );
});

test("PEG-RADARR-009 controlled Grab revalidates and classifies unknown timeout outcomes", async () => {
  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: syntheticRadarrMovieReleaseResponse };
  const releaseId = mapRadarrReleaseResponse(syntheticRadarrMovieReleaseResponse, "synthetic-radarr")[0]!.id;
  const revalidated = await client(transport).revalidateMovieRelease(84, releaseId);
  assert.equal(revalidated?.candidate.id, releaseId);
  assert.deepEqual(revalidated?.handle, { guid: "synthetic-radarr-guid-1", indexerId: 21 });

  transport.response = { status: 200, headers: {}, body: {} };
  await client(transport).grabRelease(revalidated!.handle);
  assert.deepEqual(transport.requests.at(-1), {
    method: "POST",
    path: "/api/v3/release",
    query: {},
    headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
    body: { guid: "synthetic-radarr-guid-1", indexerId: 21 },
    timeoutMs: 2_500,
    maxResponseBytes: 64_000,
  });
  transport.failure = new JsonTransportError("timeout", "private timeout detail");
  await assert.rejects(
    client(transport).grabRelease(revalidated!.handle),
    (error: unknown) => error instanceof RadarrGrabError && error.code === "timeout" && !/private/u.test(error.message),
  );
});
