import assert from "node:assert/strict";
import test from "node:test";

import type { SubdlSearchWindow } from "./adapters/subdl.js";
import type { ProviderSearchResult, SubtitleCandidate } from "./domain.js";
import { demoFeasibilityInput } from "./fixtures/demo.js";
import {
  searchProviderPolicy,
  type PlannedSubtitleProvider,
  type SubtitleWindowSource,
} from "./provider-policy-search.js";

class Source implements SubtitleWindowSource {
  readonly calls: SubdlSearchWindow[] = [];
  readonly #provider: string;
  readonly #result: (window: SubdlSearchWindow) => ProviderSearchResult;

  constructor(provider: string, result: (window: SubdlSearchWindow) => ProviderSearchResult) {
    this.#provider = provider;
    this.#result = result;
  }

  async search(window: SubdlSearchWindow): Promise<ProviderSearchResult> {
    this.calls.push(window);
    return this.#result(window);
  }

  success(window: SubdlSearchWindow, subtitles: readonly SubtitleCandidate[]): ProviderSearchResult {
    return {
      provider: this.#provider,
      status: "success",
      searchedLanguages: [window.language.policyCode],
      subtitles,
    };
  }
}

const mappings = [
  { policyCode: "pt-BR", providerCode: "pt-br" },
  { policyCode: "en", providerCode: "en" },
] as const;

function candidate(provider: string, language: string, releaseName: string): SubtitleCandidate {
  return {
    id: `${provider}-${language}`,
    provider,
    language,
    releaseName,
    mediaIds: demoFeasibilityInput.item.ids,
    ...(demoFeasibilityInput.item.season === undefined ? {} : { season: demoFeasibilityInput.item.season }),
    ...(demoFeasibilityInput.item.episode === undefined ? {} : { episode: demoFeasibilityInput.item.episode }),
    hearingImpaired: false,
    forced: false,
  };
}

function plan(preferred: Source, fallback: Source): readonly PlannedSubtitleProvider[] {
  return [
    { provider: "opensubtitles", tier: "fallback", mappings, source: fallback },
    { provider: "subdl", tier: "preferred", mappings, source: preferred },
  ];
}

test("PEG-PROVIDER-001 sufficient preferred evidence prevents fallback provider requests", async () => {
  let preferred!: Source;
  preferred = new Source("subdl", (window) => preferred.success(
    window,
    window.language.policyCode === "pt-BR"
      ? [candidate("subdl", "pt-BR", demoFeasibilityInput.releases[0]!.title)]
      : [],
  ));
  const fallback = new Source("opensubtitles", () => {
    throw new Error("Fallback provider must not be called");
  });

  const result = await searchProviderPolicy({
    item: demoFeasibilityInput.item,
    policy: demoFeasibilityInput.policy,
    releases: demoFeasibilityInput.releases,
    providers: plan(preferred, fallback),
  });

  assert.deepEqual(preferred.calls.map(({ language }) => language.policyCode), ["pt-BR", "en"]);
  assert.equal(fallback.calls.length, 0);
  assert.equal(result.requestCount, 2);
  assert.deepEqual(result.results.map(({ provider, status }) => ({ provider, status })), [
    { provider: "subdl", status: "success" },
    { provider: "subdl", status: "success" },
  ]);
});

test("PEG-PROVIDER-002 partial preferred evidence calls fallback only until required coverage is sufficient", async () => {
  let preferred!: Source;
  preferred = new Source("subdl", (window) => preferred.success(
    window,
    window.language.policyCode === "pt-BR"
      ? [candidate("subdl", "pt-BR", "Unrelated.Release.480p.OLD")]
      : [],
  ));
  let fallback!: Source;
  fallback = new Source("opensubtitles", (window) => fallback.success(
    window,
    [candidate("opensubtitles", window.language.policyCode, demoFeasibilityInput.releases[0]!.title)],
  ));

  const result = await searchProviderPolicy({
    item: demoFeasibilityInput.item,
    policy: demoFeasibilityInput.policy,
    releases: demoFeasibilityInput.releases,
    providers: plan(preferred, fallback),
  });

  assert.deepEqual(fallback.calls.map(({ language }) => language.policyCode), ["pt-BR"]);
  assert.equal(result.requestCount, 3);
  assert.deepEqual(result.results.map(({ provider }) => provider), [
    "subdl", "subdl", "opensubtitles",
  ]);
});

test("PEG-PROVIDER-003 preferred quota failures stay Unknown and allow bounded fallback", async () => {
  const preferred = new Source("subdl", (window) => ({
    provider: "subdl",
    status: "rate_limited",
    searchedLanguages: [window.language.policyCode],
    subtitles: [],
    detail: "Synthetic preferred-provider quota",
    quota: { limit: 2_000, remaining: 0 },
  }));
  let fallback!: Source;
  fallback = new Source("opensubtitles", (window) => fallback.success(
    window,
    [candidate("opensubtitles", window.language.policyCode, demoFeasibilityInput.releases[0]!.title)],
  ));

  const result = await searchProviderPolicy({
    item: demoFeasibilityInput.item,
    policy: demoFeasibilityInput.policy,
    releases: demoFeasibilityInput.releases,
    providers: plan(preferred, fallback),
  });

  assert.equal(preferred.calls.length, 1);
  assert.equal(fallback.calls.length, 1);
  assert.equal(result.requestCount, 2);
  assert.equal(result.results[0]?.status, "rate_limited");
  assert.deepEqual(result.results[0]?.searchedLanguages, ["pt-BR"]);
  assert.deepEqual(result.results[0]?.quota, { limit: 2_000, remaining: 0 });
  assert.equal(result.results[1]?.status, "success");
});

test("PEG-PROVIDER-004 cached evidence for a rejected release does not suppress fallback or change Arr rejection", async () => {
  let preferred!: Source;
  preferred = new Source("subdl", (window) => ({
    ...preferred.success(
      window,
      window.language.policyCode === "pt-BR"
        ? [candidate("subdl", "pt-BR", demoFeasibilityInput.releases[2]!.title)]
        : [],
    ),
    cache: {
      status: "hit",
      storedAt: "2026-08-28T00:00:00.000Z",
      expiresAt: "2026-08-29T00:00:00.000Z",
    },
  }));
  let fallback!: Source;
  fallback = new Source("opensubtitles", (window) => fallback.success(
    window,
    [candidate("opensubtitles", window.language.policyCode, demoFeasibilityInput.releases[0]!.title)],
  ));

  const result = await searchProviderPolicy({
    item: demoFeasibilityInput.item,
    policy: demoFeasibilityInput.policy,
    releases: demoFeasibilityInput.releases,
    providers: plan(preferred, fallback),
  });

  assert.equal(result.requestCount, 1);
  assert.equal(fallback.calls.length, 1);
  assert.equal(demoFeasibilityInput.releases[2]?.downloadAllowed, false);
  assert.ok((demoFeasibilityInput.releases[2]?.rejectionReasons.length ?? 0) > 0);
});
