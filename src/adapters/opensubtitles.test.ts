import assert from "node:assert/strict";
import test from "node:test";

import type { MediaIdentity } from "../domain.js";
import {
  syntheticOpenSubtitlesEmptySearchResponse,
  syntheticOpenSubtitlesEpisodeSearchResponse,
} from "../fixtures/opensubtitles-subtitle-search.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonTransport,
  type ReadonlyJsonRequest,
} from "./http.js";
import { OpenSubtitlesAdapterError, OpenSubtitlesClient } from "./opensubtitles.js";

class FakeTransport implements JsonTransport {
  readonly requests: ReadonlyJsonRequest[] = [];
  response: JsonResponse = {
    status: 200,
    headers: {
      "X-RateLimit-Limit-Second": "5",
      "X-RateLimit-Remaining-Second": "4",
    },
    body: syntheticOpenSubtitlesEpisodeSearchResponse,
  };
  failure: Error | undefined;
  gate: Promise<void> | undefined;

  async requestJson(request: ReadonlyJsonRequest): Promise<JsonResponse> {
    this.requests.push(request);
    await this.gate;
    if (this.failure !== undefined) throw this.failure;
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
  ids: { tmdb: "84" },
};

function client(
  transport: JsonTransport,
  options: { readonly now?: () => number; readonly cacheTtlMs?: number } = {},
): OpenSubtitlesClient {
  return new OpenSubtitlesClient(
    {
      apiKey: "synthetic-opensubtitles-api-key",
      userAgent: "Pegarr Tests v0.1.0",
      timeoutMs: 2_500,
      maxResponseBytes: 64_000,
      cacheTtlMs: options.cacheTtlMs ?? 60_000,
      ...(options.now === undefined ? {} : { now: options.now }),
    },
    transport,
  );
}

test("PEG-OPENSUBTITLES-001 exact searches use sorted bounded GETs and header-only API keys", async () => {
  const transport = new FakeTransport();
  const opensubtitles = client(transport);
  await opensubtitles.search({
    item: episode,
    language: { policyCode: "en", providerCode: "EN" },
  });
  transport.response = { status: 200, headers: {}, body: syntheticOpenSubtitlesEmptySearchResponse };
  await opensubtitles.search({
    item: movie,
    language: { policyCode: "pt-BR", providerCode: "pt-br" },
  });

  assert.deepEqual(transport.requests, [
    {
      method: "GET",
      path: "/subtitles",
      query: {
        episode_number: "5",
        languages: "en",
        parent_imdb_id: "9000005",
        season_number: "3",
        type: "episode",
      },
      headers: {
        accept: "application/json",
        "api-key": "synthetic-opensubtitles-api-key",
        "user-agent": "Pegarr Tests v0.1.0",
      },
      timeoutMs: 2_500,
      maxResponseBytes: 64_000,
    },
    {
      method: "GET",
      path: "/subtitles",
      query: { languages: "pt-br", tmdb_id: "84", type: "movie" },
      headers: {
        accept: "application/json",
        "api-key": "synthetic-opensubtitles-api-key",
        "user-agent": "Pegarr Tests v0.1.0",
      },
      timeoutMs: 2_500,
      maxResponseBytes: 64_000,
    },
  ]);
  assert.deepEqual(Object.keys(transport.requests[0]?.query ?? {}), [
    "episode_number", "languages", "parent_imdb_id", "season_number", "type",
  ]);
  assert.doesNotMatch(JSON.stringify(transport.requests.map(({ query }) => query)), /api.?key/iu);
  assert.throws(
    () => new OpenSubtitlesClient({ apiKey: "unsafe\nheader", userAgent: "Pegarr Tests v0.1.0" }, transport),
    /bounded header value/u,
  );
});

test("PEG-OPENSUBTITLES-002 safe release evidence preserves preference flags and discards handles", async () => {
  const result = await client(new FakeTransport()).search({
    item: episode,
    language: { policyCode: "en", providerCode: "en" },
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.quota, { limit: 5, remaining: 4, windowSeconds: 1 });
  assert.deepEqual(result.subtitles[0]?.traits, { frameRate: 23.976 });
  assert.equal(result.subtitles[1]?.traits, undefined);
  assert.deepEqual(
    result.subtitles.map(({ provider, language, providerLanguage, releaseName, hearingImpaired, forced }) => ({
      provider, language, providerLanguage, releaseName, hearingImpaired, forced,
    })),
    [
      {
        provider: "opensubtitles",
        language: "en",
        providerLanguage: "en",
        releaseName: "Synthetic.Show.S03E05.1080p.WEB-DL.H264-GROUP",
        hearingImpaired: false,
        forced: false,
      },
      {
        provider: "opensubtitles",
        language: "en",
        providerLanguage: "en",
        releaseName: "Synthetic.Show.S03E05.720p.WEB-DL.H264-OTHER",
        hearingImpaired: true,
        forced: true,
      },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /70000|private-result|private-subtitle|private comment|private uploader|opensubtitles\.com\/private/iu,
  );
});

test("PEG-OPENSUBTITLES-003 empty success, malformed data, and unrelated languages stay distinct", async () => {
  const emptyTransport = new FakeTransport();
  emptyTransport.response = { status: 200, headers: {}, body: syntheticOpenSubtitlesEmptySearchResponse };
  const empty = await client(emptyTransport).search({
    item: movie,
    language: { policyCode: "fr", providerCode: "fr" },
  });
  assert.equal(empty.status, "success");
  assert.deepEqual(empty.subtitles, []);

  const unrelatedTransport = new FakeTransport();
  const unrelated = await client(unrelatedTransport).search({
    item: episode,
    language: { policyCode: "pt-BR", providerCode: "pt-br" },
  });
  assert.equal(unrelated.status, "success");
  assert.deepEqual(unrelated.subtitles, []);

  const malformedTransport = new FakeTransport();
  malformedTransport.response = { status: 200, headers: {}, body: { total_count: 0 } };
  await assert.rejects(
    client(malformedTransport).search({
      item: movie,
      language: { policyCode: "fr", providerCode: "fr" },
    }),
    (error: unknown) => error instanceof OpenSubtitlesAdapterError && error.code === "invalid_response",
  );
});

test("PEG-OPENSUBTITLES-004 quota, timeout, outage, auth, and invalid responses remain honest", async () => {
  const cases: readonly {
    readonly response?: JsonResponse;
    readonly failure?: Error;
    readonly status?: string;
    readonly errorCode?: OpenSubtitlesAdapterError["code"];
  }[] = [
    {
      response: {
        status: 429,
        headers: {
          "Retry-After": "2",
          "X-RateLimit-Limit-Second": "5",
          "X-RateLimit-Remaining-Second": "0",
        },
        body: {},
      },
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
    if (testCase.response !== undefined) transport.response = testCase.response;
    transport.failure = testCase.failure;
    const search = () => client(transport).search({
      item: episode,
      language: { policyCode: "en", providerCode: "en" },
    });
    if (testCase.errorCode !== undefined) {
      await assert.rejects(search(), (error: unknown) => {
        assert.ok(error instanceof OpenSubtitlesAdapterError);
        assert.equal(error.code, testCase.errorCode);
        assert.doesNotMatch(error.message, /private timeout|private network|private body/iu);
        return true;
      });
    } else {
      const result = await search();
      assert.equal(result.status, testCase.status);
      assert.deepEqual(result.subtitles, []);
      assert.doesNotMatch(result.detail ?? "", /private timeout|private network|private body/iu);
      if (testCase.status === "rate_limited") {
        assert.deepEqual(result.quota, { limit: 5, remaining: 0, windowSeconds: 1 });
      }
    }
  }
});

test("PEG-OPENSUBTITLES-005 one stable item-language window uses one request until expiry", async () => {
  let now = 1_000;
  let releaseGate: (() => void) | undefined;
  const transport = new FakeTransport();
  transport.gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  const opensubtitles = client(transport, { now: () => now, cacheTtlMs: 60_000 });
  const window = { item: episode, language: { policyCode: "en", providerCode: "en" } } as const;

  const first = opensubtitles.search(window);
  const concurrent = opensubtitles.search(window);
  assert.equal(transport.requests.length, 1);
  releaseGate?.();
  assert.equal((await first).cache?.status, "miss");
  assert.equal((await concurrent).cache?.status, "hit");
  assert.equal((await opensubtitles.search(window)).cache?.status, "hit");
  assert.equal(transport.requests.length, 1);

  now += 60_001;
  await opensubtitles.search(window);
  assert.equal(transport.requests.length, 2);
});
