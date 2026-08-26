import assert from "node:assert/strict";
import test from "node:test";

import type { MediaIdentity } from "../domain.js";
import {
  syntheticSubdlV2EpisodeSearchResponse,
  syntheticSubdlV2MovieSearchResponse,
} from "../fixtures/subdl-v2-subtitle-search.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonTransport,
  type ReadonlyJsonRequest,
} from "./http.js";
import { SubdlAdapterError, SubdlClient } from "./subdl.js";

class FakeTransport implements JsonTransport {
  readonly requests: ReadonlyJsonRequest[] = [];
  response: JsonResponse = {
    status: 200,
    headers: {
      "X-RateLimit-Limit": "2000",
      "X-RateLimit-Remaining": "1999",
      "X-RateLimit-Reset": "1787788800",
    },
    body: syntheticSubdlV2EpisodeSearchResponse,
  };
  failure: Error | undefined;
  gate: Promise<void> | undefined;

  async requestJson(request: ReadonlyJsonRequest): Promise<JsonResponse> {
    this.requests.push(request);
    await this.gate;
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return this.response;
  }
}

const episode: MediaIdentity = {
  kind: "episode",
  title: "Synthetic Show — S03E05",
  season: 3,
  episode: 5,
  ids: { imdb: "tt9000005", tmdb: "900005" },
};

const movie: MediaIdentity = {
  kind: "movie",
  title: "Synthetic Movie",
  year: 2025,
  ids: { tmdb: "84" },
};

function client(
  transport: JsonTransport,
  options: { readonly now?: () => number; readonly cacheTtlMs?: number } = {},
): SubdlClient {
  return new SubdlClient(
    {
      apiKey: "synthetic-api-key",
      timeoutMs: 2_500,
      maxResponseBytes: 64_000,
      cacheTtlMs: options.cacheTtlMs ?? 60_000,
      ...(options.now === undefined ? {} : { now: options.now }),
    },
    transport,
  );
}

test("PEG-SUBDL-001 exact searches are bounded GETs with header-only authentication", async () => {
  const transport = new FakeTransport();
  const subdl = client(transport);

  await subdl.search({
    item: episode,
    language: { policyCode: "en", providerCode: "EN" },
  });
  transport.response = { status: 200, headers: {}, body: syntheticSubdlV2MovieSearchResponse };
  await subdl.search({
    item: movie,
    language: { policyCode: "fr", providerCode: "FR" },
  });

  assert.deepEqual(transport.requests, [
    {
      method: "GET",
      path: "/api/v2/subtitles/search",
      query: {
        imdb_id: "tt9000005",
        type: "tv",
        languages: "EN",
        subs_per_page: "30",
        season: "3",
        episode: "5",
      },
      headers: { accept: "application/json", authorization: "Bearer synthetic-api-key" },
      timeoutMs: 2_500,
      maxResponseBytes: 64_000,
    },
    {
      method: "GET",
      path: "/api/v2/subtitles/search",
      query: { tmdb_id: "84", type: "movie", languages: "FR", subs_per_page: "30" },
      headers: { accept: "application/json", authorization: "Bearer synthetic-api-key" },
      timeoutMs: 2_500,
      maxResponseBytes: 64_000,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(transport.requests.map(({ query }) => query)), /api.?key/iu);
  assert.throws(
    () => new SubdlClient({ apiKey: "unsafe\nheader" }, transport),
    /bounded header value/u,
  );
});

test("PEG-SUBDL-002 release evidence is local-matchable and download handles are discarded", async () => {
  const result = await client(new FakeTransport()).search({
    item: episode,
    language: { policyCode: "en", providerCode: "EN" },
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.quota, {
    limit: 2_000,
    remaining: 1_999,
    resetAtEpochSeconds: 1_787_788_800,
  });
  assert.equal(result.subtitles.length, 3);
  assert.deepEqual(
    result.subtitles.map(
      ({ language, providerLanguage, releaseName, hearingImpaired, season, episode }) => ({
        language,
        providerLanguage,
        releaseName,
        hearingImpaired,
        season,
        episode,
      }),
    ),
    [
      {
        language: "en",
        providerLanguage: "EN",
        releaseName: "Synthetic.Show.S03E05.1080p.WEB-DL.H264-GROUP",
        hearingImpaired: false,
        season: 3,
        episode: 5,
      },
      {
        language: "en",
        providerLanguage: "English",
        releaseName: "Synthetic.Show.S03E05.720p.WEB-DL.H264-OTHER",
        hearingImpaired: true,
        season: 3,
        episode: 5,
      },
      {
        language: "en",
        providerLanguage: "English",
        releaseName: "Synthetic.Show.S03E05.1080p.BluRay.x265-ARCHIVE",
        hearingImpaired: true,
        season: 3,
        episode: 5,
      },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /synthetic-subtitle|private|\.zip|uploader|comment|poster|subdl\.com/iu,
  );
});

test("PEG-SUBDL-003 successful empty and malformed searches remain distinct", async () => {
  const transport = new FakeTransport();
  transport.response = { status: 200, headers: {}, body: syntheticSubdlV2MovieSearchResponse };
  assert.deepEqual(
    await client(transport).search({
      item: movie,
      language: { policyCode: "fr", providerCode: "FR" },
    }),
    { provider: "subdl", status: "success", subtitles: [] },
  );

  transport.response = { status: 200, headers: {}, body: { status: false, error: "private" } };
  await assert.rejects(
    client(transport).search({
      item: movie,
      language: { policyCode: "fr", providerCode: "FR" },
    }),
    (error: unknown) => error instanceof SubdlAdapterError && error.code === "invalid_response",
  );
});

test("PEG-SUBDL-004 quota, timeout, outage, auth, and malformed data stay classified", async () => {
  const cases: readonly {
    readonly response?: JsonResponse;
    readonly failure?: Error;
    readonly status?: string;
    readonly errorCode?: SubdlAdapterError["code"];
  }[] = [
    {
      response: { status: 429, headers: { "Retry-After": "45" }, body: {} },
      status: "rate_limited",
    },
    { failure: new JsonTransportError("timeout", "private timeout"), status: "timeout" },
    { failure: new Error("private network"), status: "unavailable" },
    { response: { status: 503, headers: {}, body: {} }, status: "unavailable" },
    { response: { status: 401, headers: {}, body: {} }, errorCode: "unauthorized" },
    {
      failure: new JsonTransportError("response_too_large", "private body"),
      errorCode: "invalid_response",
    },
  ];

  for (const testCase of cases) {
    const transport = new FakeTransport();
    if (testCase.response !== undefined) {
      transport.response = testCase.response;
    }
    transport.failure = testCase.failure;

    if (testCase.errorCode !== undefined) {
      await assert.rejects(
        client(transport).search({
          item: episode,
          language: { policyCode: "en", providerCode: "EN" },
        }),
        (error: unknown) => {
          assert.ok(error instanceof SubdlAdapterError);
          assert.equal(error.code, testCase.errorCode);
          assert.doesNotMatch(error.message, /private timeout|private network|private body/iu);
          return true;
        },
      );
    } else {
      const result = await client(transport).search({
        item: episode,
        language: { policyCode: "en", providerCode: "EN" },
      });
      assert.equal(result.status, testCase.status);
      assert.deepEqual(result.subtitles, []);
      assert.doesNotMatch(result.detail ?? "", /private timeout|private network|private body/iu);
    }
  }
});

test("PEG-SUBDL-005 one stable item-language window uses one request until expiry", async () => {
  let now = 1_000;
  let releaseGate: (() => void) | undefined;
  const transport = new FakeTransport();
  transport.gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const subdl = client(transport, { now: () => now, cacheTtlMs: 60_000 });
  const window = {
    item: episode,
    language: { policyCode: "en", providerCode: "EN" },
  } as const;

  const first = subdl.search(window);
  const concurrent = subdl.search(window);
  assert.equal(transport.requests.length, 1);
  releaseGate?.();
  assert.strictEqual(await first, await concurrent);
  assert.strictEqual(await subdl.search(window), await first);
  assert.equal(transport.requests.length, 1);

  now += 60_001;
  transport.gate = undefined;
  await subdl.search(window);
  assert.equal(transport.requests.length, 2);

  await subdl.search({
    item: episode,
    language: { policyCode: "es", providerCode: "ES" },
  });
  assert.equal(transport.requests.length, 3);
});
