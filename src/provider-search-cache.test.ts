import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { SubdlSearchWindow } from "./adapters/subdl.js";
import type { ProviderSearchResult } from "./domain.js";
import { ProviderSearchCache } from "./provider-search-cache.js";
import type { SubdlWindowSource } from "./provider-policy-search.js";

const window: SubdlSearchWindow = {
  item: {
    kind: "episode",
    title: "Private Synthetic Show",
    season: 3,
    episode: 5,
    ids: { imdb: "tt9000005", tmdb: "900005" },
  },
  language: { policyCode: "pt-BR", providerCode: "PT-BR" },
};

class Source implements SubdlWindowSource {
  calls = 0;
  gate: Promise<void> | undefined;
  result: ProviderSearchResult = {
    provider: "subdl",
    status: "success",
    searchedLanguages: ["pt-BR"],
    subtitles: [{
      id: "cached-subtitle",
      provider: "subdl",
      language: "pt-BR",
      releaseName: "Synthetic.Show.S03E05.1080p.WEB-DL-GROUP",
      mediaIds: window.item.ids,
      season: 3,
      episode: 5,
    }],
  };

  async search(): Promise<ProviderSearchResult> {
    this.calls += 1;
    await this.gate;
    return this.result;
  }
}

test("PEG-CACHE-001 successful provider results survive process-local cache reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-provider-cache-"));
  try {
    const path = join(directory, "provider.sqlite");
    const firstSource = new Source();
    const first = new ProviderSearchCache({ databasePath: path, source: firstSource, now: () => 1_000 });
    const miss = await first.search(window);
    first.close();

    const secondSource = new Source();
    const second = new ProviderSearchCache({ databasePath: path, source: secondSource, now: () => 2_000 });
    const hit = await second.search(window);
    second.close();

    assert.equal(firstSource.calls, 1);
    assert.equal(secondSource.calls, 0);
    assert.equal(miss.cache?.status, "miss");
    assert.equal(hit.cache?.status, "hit");
    assert.deepEqual(hit.subtitles, miss.subtitles);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("PEG-CACHE-002 expired and failed searches are never reused as successful evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-provider-cache-expiry-"));
  try {
    let now = 1_000;
    const source = new Source();
    const cache = new ProviderSearchCache({
      databasePath: join(directory, "provider.sqlite"),
      source,
      ttlMs: 1_000,
      now: () => now,
    });
    await cache.search(window);
    now = 2_001;
    await cache.search(window);
    source.result = { provider: "subdl", status: "rate_limited", subtitles: [] };
    now = 3_002;
    const failure = await cache.search(window);
    const repeatedFailure = await cache.search(window);
    cache.close();

    assert.equal(source.calls, 4);
    assert.equal(failure.status, "rate_limited");
    assert.equal(failure.cache, undefined);
    assert.equal(repeatedFailure.cache, undefined);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("PEG-CACHE-003 concurrent identical misses use one provider request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-provider-cache-flight-"));
  try {
    let release!: () => void;
    const source = new Source();
    source.gate = new Promise<void>((resolve) => { release = resolve; });
    const cache = new ProviderSearchCache({
      databasePath: join(directory, "provider.sqlite"),
      source,
      now: () => 1_000,
    });
    const first = cache.search(window);
    const second = cache.search(window);
    release();
    const [leader, follower] = await Promise.all([first, second]);
    cache.close();

    assert.equal(source.calls, 1);
    assert.equal(leader.cache?.status, "miss");
    assert.equal(follower.cache?.status, "hit");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("PEG-CACHE-004 cache keys never persist titles or raw media identifiers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-provider-cache-key-"));
  try {
    const path = join(directory, "provider.sqlite");
    const cache = new ProviderSearchCache({ databasePath: path, source: new Source(), now: () => 1_000 });
    await cache.search(window);
    cache.close();

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(path, { readOnly: true });
    const row = database.prepare("SELECT cache_key FROM provider_search_cache").get() as { cache_key: string };
    database.close();
    assert.match(row.cache_key, /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(row.cache_key, /private|tt9000005|900005/iu);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("PEG-CACHE-007 oldest provider windows are pruned at the configured bound", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-provider-cache-bound-"));
  try {
    let now = 1_000;
    const source = new Source();
    const cache = new ProviderSearchCache({
      databasePath: join(directory, "provider.sqlite"),
      source,
      maxEntries: 1,
      now: () => now,
    });
    await cache.search(window);
    now += 1;
    await cache.search({
      ...window,
      item: { ...window.item, ids: { imdb: "tt9000006", tmdb: "900006" } },
    });
    now += 1;
    const refetched = await cache.search(window);
    cache.close();

    assert.equal(source.calls, 3);
    assert.equal(refetched.cache?.status, "miss");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("PEG-CACHE-008 corrupt provider rows are discarded and fetched again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-provider-cache-corrupt-"));
  try {
    const path = join(directory, "provider.sqlite");
    const first = new ProviderSearchCache({ databasePath: path, source: new Source(), now: () => 1_000 });
    await first.search(window);
    first.close();

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(path);
    database.prepare("UPDATE provider_search_cache SET payload_json = ?").run("{corrupt");
    database.close();

    const source = new Source();
    const second = new ProviderSearchCache({ databasePath: path, source, now: () => 2_000 });
    const refetched = await second.search(window);
    second.close();

    assert.equal(source.calls, 1);
    assert.equal(refetched.cache?.status, "miss");
  } finally {
    await rm(directory, { recursive: true });
  }
});
