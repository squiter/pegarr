import assert from "node:assert/strict";
import test from "node:test";

import { syntheticRadarrMovieReleaseResponse } from "../fixtures/radarr-release-search.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonTransport,
  type ReadonlyJsonRequest,
} from "./http.js";
import {
  mapRadarrReleaseResponse,
  RadarrAdapterError,
  RadarrClient,
} from "./radarr.js";

class FakeTransport implements JsonTransport {
  readonly requests: ReadonlyJsonRequest[] = [];
  response: JsonResponse = { status: 200, headers: {}, body: [] };
  failure: Error | undefined;

  async requestJson(request: ReadonlyJsonRequest): Promise<JsonResponse> {
    this.requests.push(request);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return this.response;
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
