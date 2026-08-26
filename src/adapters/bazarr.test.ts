import assert from "node:assert/strict";
import test from "node:test";

import {
  syntheticBazarrLanguageProfilesResponse,
  syntheticBazarrMovieAssignmentResponse,
  syntheticBazarrSeriesAssignmentResponse,
} from "../fixtures/bazarr-language-policy.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonTransport,
  type ReadonlyJsonRequest,
} from "./http.js";
import {
  BazarrAdapterError,
  BazarrClient,
  mapBazarrLanguageProfiles,
  resolveBazarrPolicy,
} from "./bazarr.js";

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

function client(transport: JsonTransport): BazarrClient {
  return new BazarrClient(
    {
      instanceId: "synthetic-bazarr",
      apiKey: "synthetic-api-key",
      timeoutMs: 2_500,
      maxResponseBytes: 400_000,
    },
    transport,
  );
}

test("PEG-BAZARR-001 policy reads are bounded GETs authenticated only by header", async () => {
  const transport = new FakeTransport();
  transport.response = {
    status: 200,
    headers: {},
    body: syntheticBazarrLanguageProfilesResponse,
  };

  await client(transport).listLanguageProfiles();

  assert.deepEqual(transport.requests, [
    {
      method: "GET",
      path: "/api/system/languages/profiles",
      query: {},
      headers: { accept: "application/json", "x-api-key": "synthetic-api-key" },
      timeoutMs: 2_500,
      maxResponseBytes: 400_000,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(transport.requests[0]?.query), /api.?key/iu);
  assert.throws(
    () =>
      new BazarrClient(
        { instanceId: "https://private.invalid/bazarr", apiKey: "synthetic-api-key" },
        transport,
      ),
    /safe label/u,
  );
});

test("PEG-BAZARR-002 profiles preserve source semantics without assuming a language", () => {
  const profiles = mapBazarrLanguageProfiles(syntheticBazarrLanguageProfilesResponse);
  const resolution = resolveBazarrPolicy(
    { status: "assigned", mediaKind: "series", mediaId: 42, profileId: 7 },
    profiles,
  );

  assert.equal(resolution.status, "resolved");
  if (resolution.status !== "resolved") {
    return;
  }
  assert.deepEqual(resolution.profile, {
    profileId: 7,
    name: "Multilingual primary",
    cutoffItemId: 2,
    items: [
      {
        id: 1,
        language: "en",
        hearingImpaired: false,
        forced: false,
        audioCondition: "always",
      },
      {
        id: 2,
        language: "pt-BR",
        hearingImpaired: true,
        forced: false,
        audioCondition: "audio_does_not_match",
      },
      {
        id: 3,
        language: "es",
        hearingImpaired: false,
        forced: true,
        audioCondition: "audio_matches",
      },
    ],
    mustContain: ["WEB", "BluRay"],
    mustNotContain: ["CAM"],
    originalFormat: true,
    tag: "primary_media",
  });
  assert.deepEqual(
    resolution.policy.languages.map(({ code, hearingImpaired, forced, applicability, cutoff }) => ({
      code,
      hearingImpaired,
      forced,
      applicability,
      cutoff,
    })),
    [
      {
        code: "en",
        hearingImpaired: "either",
        forced: false,
        applicability: "always",
        cutoff: false,
      },
      {
        code: "pt-BR",
        hearingImpaired: "required",
        forced: false,
        applicability: "audio_does_not_match",
        cutoff: true,
      },
      {
        code: "es",
        hearingImpaired: "either",
        forced: true,
        applicability: "audio_matches",
        cutoff: false,
      },
    ],
  );
});

test("PEG-BAZARR-003 targeted assignments retain only media and profile IDs", async () => {
  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: syntheticBazarrSeriesAssignmentResponse };
  const bazarr = client(transport);

  const series = await bazarr.readSeriesAssignment(42);
  transport.response = { status: 200, headers: {}, body: syntheticBazarrMovieAssignmentResponse };
  const movie = await bazarr.readMovieAssignment(84);

  assert.deepEqual(series, { status: "assigned", mediaKind: "series", mediaId: 42, profileId: 7 });
  assert.deepEqual(movie, { status: "unassigned", mediaKind: "movie", mediaId: 84 });
  assert.deepEqual(
    transport.requests.map(({ method, path, query, maxResponseBytes }) => ({
      method,
      path,
      query,
      maxResponseBytes,
    })),
    [
      {
        method: "GET",
        path: "/api/series",
        query: { "seriesid[]": "42" },
        maxResponseBytes: 256 * 1024,
      },
      {
        method: "GET",
        path: "/api/movies",
        query: { "radarrid[]": "84" },
        maxResponseBytes: 256 * 1024,
      },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify([series, movie]),
    /private|path|poster|fanart|overview|subtitle|audio_language/iu,
  );
});

test("PEG-BAZARR-004 absent assignments and missing profiles remain unresolved", async () => {
  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: { data: [], total: 0 } };

  const notFound = await client(transport).readSeriesAssignment(42);
  assert.deepEqual(notFound, { status: "not_found", mediaKind: "series", mediaId: 42 });
  assert.equal(resolveBazarrPolicy(notFound, []).status, "media_not_found");
  assert.equal(
    resolveBazarrPolicy(
      { status: "unassigned", mediaKind: "movie", mediaId: 84 },
      [],
    ).status,
    "unassigned",
  );
  assert.equal(
    resolveBazarrPolicy(
      { status: "assigned", mediaKind: "series", mediaId: 42, profileId: 999 },
      mapBazarrLanguageProfiles(syntheticBazarrLanguageProfilesResponse),
    ).status,
    "profile_missing",
  );
  await assert.rejects(client(transport).readSeriesAssignment(0), /sonarrSeriesId/u);
});

test("PEG-BAZARR-005 failures are classified, malformed data rejected, and details redacted", async () => {
  const cases: readonly {
    readonly response?: JsonResponse;
    readonly failure?: Error;
    readonly code: BazarrAdapterError["code"];
    readonly retryAfterSeconds?: number;
  }[] = [
    { response: { status: 401, headers: {}, body: {} }, code: "unauthorized" },
    {
      response: { status: 429, headers: { "Retry-After": "20" }, body: {} },
      code: "rate_limited",
      retryAfterSeconds: 20,
    },
    { response: { status: 503, headers: {}, body: {} }, code: "unavailable" },
    { failure: new Error("private topology and credential must not escape"), code: "unavailable" },
    {
      failure: new JsonTransportError("invalid_json", "private response detail"),
      code: "invalid_response",
    },
    { response: { status: 200, headers: {}, body: { profiles: [] } }, code: "invalid_response" },
  ];

  for (const testCase of cases) {
    const transport = new FakeTransport();
    if (testCase.response !== undefined) {
      transport.response = testCase.response;
    }
    transport.failure = testCase.failure;

    await assert.rejects(client(transport).listLanguageProfiles(), (error: unknown) => {
      assert.ok(error instanceof BazarrAdapterError);
      assert.equal(error.code, testCase.code);
      assert.equal(error.retryAfterSeconds, testCase.retryAfterSeconds);
      assert.doesNotMatch(error.message, /private topology|must not escape|response detail/iu);
      return true;
    });
  }
});
