import assert from "node:assert/strict";
import test from "node:test";

import { syntheticSonarrEpisodeReleaseResponse } from "../fixtures/sonarr-release-search.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonTransport,
  type ReadonlyJsonRequest,
} from "./http.js";
import {
  mapSonarrReleaseResponse,
  SonarrAdapterError,
  SonarrClient,
} from "./sonarr.js";

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
