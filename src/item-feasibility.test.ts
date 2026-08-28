import assert from "node:assert/strict";
import test from "node:test";

import type { MissingMediaItem } from "./domain.js";
import type {
  SonarrEpisodeFeasibilityOutcome,
  SonarrEpisodeFeasibilityRequest,
} from "./episode-feasibility.js";
import { ItemFeasibilityService } from "./item-feasibility.js";
import type { RadarrMovieFeasibilityRequest } from "./movie-feasibility.js";

const episode: MissingMediaItem = {
  application: "sonarr",
  instanceId: "sonarr",
  kind: "episode",
  itemId: 305,
  parentId: 42,
  title: "Episode Five",
  parentTitle: "Synthetic Show",
  season: 3,
  episode: 5,
  monitored: true,
  hasFile: false,
  ids: { imdb: "tt9000005", tmdb: "900005" },
};

const movie: MissingMediaItem = {
  application: "radarr",
  instanceId: "radarr",
  kind: "movie",
  itemId: 84,
  title: "Synthetic Movie",
  year: 2024,
  monitored: true,
  hasFile: false,
  ids: { imdb: "tt9000084", tmdb: "900084" },
};

const readyInventory = {
  kind: "missing-item-inventory" as const,
  mode: "read_only" as const,
  status: "ready" as const,
  sources: [
    { integration: "sonarr" as const, status: "ready" as const, page: { page: 1, pageSize: 2, totalRecords: 1, items: [episode] } },
    { integration: "radarr" as const, status: "ready" as const, page: { page: 1, pageSize: 2, totalRecords: 1, items: [movie] } },
  ] as const,
  metrics: { requestCount: 2, itemCount: 2, elapsedMs: 5 },
};

test("PEG-ITEM-001 selected items build reports from server-owned inventory evidence", async () => {
  let episodeRequest: SonarrEpisodeFeasibilityRequest | undefined;
  let movieRequest: RadarrMovieFeasibilityRequest | undefined;
  const service = new ItemFeasibilityService({
    readInventory: async () => readyInventory,
    episode: {
      build: async (request) => {
        episodeRequest = request;
        return { status: "policy_unresolved", mode: "read_only", reason: "unassigned", releases: [], metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 0, elapsedMs: 2 } };
      },
    },
    movie: {
      build: async (request) => {
        movieRequest = request;
        return { status: "policy_unresolved", mode: "read_only", reason: "profile_missing", releases: [], metrics: { radarrRequests: 1, bazarrRequests: 2, providerRequests: 0, elapsedMs: 3 } };
      },
    },
    subdlLanguages: [{ policyCode: "pt-BR", providerCode: "PT-BR" }],
    missingIntegrations: { episode: [], movie: [] },
  });

  const episodeResult = await service.read({ application: "sonarr", kind: "episode", itemId: 305 });
  const movieResult = await service.read({ application: "radarr", kind: "movie", itemId: 84 });

  assert.equal(episodeResult.status, "policy_unresolved");
  assert.deepEqual(episodeRequest, {
    episodeId: 305,
    sonarrSeriesId: 42,
    item: { kind: "episode", title: "Synthetic Show", season: 3, episode: 5, ids: episode.ids },
    subdlLanguages: [{ policyCode: "pt-BR", providerCode: "PT-BR" }],
  });
  assert.equal(movieResult.status, "policy_unresolved");
  assert.deepEqual(movieRequest, {
    movieId: 84,
    item: { kind: "movie", title: "Synthetic Movie", year: 2024, ids: movie.ids },
    subdlLanguages: [{ policyCode: "pt-BR", providerCode: "PT-BR" }],
  });
});

test("PEG-ITEM-002 missing configuration and inventory failures remain distinct without report work", async () => {
  let reportBuilds = 0;
  const disabled = new ItemFeasibilityService({
    readInventory: async () => readyInventory,
    episode: { build: async () => { reportBuilds += 1; throw new Error("must not run"); } },
    subdlLanguages: [],
    missingIntegrations: { episode: ["bazarr", "subdl"], movie: ["bazarr", "subdl"] },
  });
  assert.deepEqual(
    await disabled.read({ application: "sonarr", kind: "episode", itemId: 305 }),
    {
      kind: "item-feasibility",
      mode: "read_only",
      status: "disabled",
      selection: { application: "sonarr", instanceId: "sonarr", kind: "episode", itemId: 305 },
      missingIntegrations: ["bazarr", "subdl"],
    },
  );

  const unavailable = new ItemFeasibilityService({
    readInventory: async () => ({
      ...readyInventory,
      status: "partial",
      sources: [
        { integration: "sonarr", status: "integration_failure", state: "rate_limited", retryAfterSeconds: 60 },
        readyInventory.sources[1],
      ],
    }),
    subdlLanguages: [],
    missingIntegrations: { episode: [], movie: [] },
  });
  assert.equal((await unavailable.read({ application: "sonarr", kind: "episode", itemId: 305 })).status, "inventory_unavailable");

  const missing = new ItemFeasibilityService({
    readInventory: async () => readyInventory,
    subdlLanguages: [],
    missingIntegrations: { episode: [], movie: [] },
  });
  assert.equal((await missing.read({ application: "radarr", kind: "movie", itemId: 999 })).status, "not_found");
  assert.equal(reportBuilds, 0);
});

test("PEG-ITEM-003 concurrent and repeated selections share one bounded ready-report window", async () => {
  let builds = 0;
  let currentTime = 1_000;
  const service = new ItemFeasibilityService({
    readInventory: async () => readyInventory,
    episode: {
      build: async () => {
        builds += 1;
        await Promise.resolve();
        return {
          status: "ready",
          mode: "read_only",
          report: { fixture: "synthetic", mode: "read_only", item: { kind: "episode", title: "Synthetic Show", season: 3, episode: 5, ids: episode.ids }, policy: { source: "bazarr", profileId: "1", profileName: "Synthetic", languages: [] }, providerStatus: [], releases: [] },
          metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 0, elapsedMs: 1 },
        };
      },
    },
    subdlLanguages: [],
    missingIntegrations: { episode: [], movie: [] },
    now: () => currentTime,
    ttlMs: 30_000,
  });
  const selection = { application: "sonarr" as const, kind: "episode" as const, itemId: 305 };
  const [first, concurrent] = await Promise.all([service.read(selection), service.read(selection)]);
  const cached = await service.read(selection);
  assert.equal(builds, 1);
  assert.deepEqual(concurrent, first);
  assert.equal(first.status, "ready");
  assert.equal(cached.status, "ready");
  if (first.status === "ready" && cached.status === "ready") {
    assert.equal(first.analysis.source, "computed");
    assert.equal(cached.analysis.source, "memory_cache");
    assert.equal(cached.analysis.generatedAt, first.analysis.generatedAt);
  }

  currentTime += 30_001;
  const refreshed = await service.read(selection);
  assert.equal(builds, 2);
  assert.equal(refreshed.status === "ready" && refreshed.analysis.source, "computed");
});

test("PEG-ITEM-005 explicit refresh bypasses only the item cache and remains single-flight", async () => {
  let builds = 0;
  const service = new ItemFeasibilityService({
    readInventory: async () => readyInventory,
    episode: {
      build: async () => {
        builds += 1;
        await Promise.resolve();
        return {
          status: "ready",
          mode: "read_only",
          report: { fixture: "synthetic", mode: "read_only", item: { kind: "episode", title: "Synthetic Show", season: 3, episode: 5, ids: episode.ids }, policy: { source: "bazarr", profileId: "1", profileName: "Synthetic", languages: [] }, providerStatus: [], releases: [] },
          metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 0, elapsedMs: 1 },
        };
      },
    },
    subdlLanguages: [],
    missingIntegrations: { episode: [], movie: [] },
    now: () => 2_000,
    ttlMs: 30_000,
  });
  const selection = { application: "sonarr" as const, kind: "episode" as const, itemId: 305 };

  const first = await service.read(selection);
  const cached = await service.read(selection);
  const [refreshed, concurrentRefresh] = await Promise.all([
    service.read(selection, { refresh: true }),
    service.read(selection, { refresh: true }),
  ]);

  assert.equal(builds, 2);
  assert.equal(first.status === "ready" && first.analysis.source, "computed");
  assert.equal(cached.status === "ready" && cached.analysis.source, "memory_cache");
  assert.equal(refreshed.status === "ready" && refreshed.analysis.source, "computed");
  assert.deepEqual(concurrentRefresh, refreshed);
});

test("PEG-ITEM-006 transient failures use a labeled stale report only inside the bounded window", async () => {
  let builds = 0;
  let currentTime = 1_000;
  let outcome: SonarrEpisodeFeasibilityOutcome = {
    status: "ready",
    mode: "read_only",
    report: { fixture: "synthetic", mode: "read_only", item: { kind: "episode", title: "Synthetic Show", season: 3, episode: 5, ids: episode.ids }, policy: { source: "bazarr", profileId: "1", profileName: "Synthetic", languages: [] }, providerStatus: [], releases: [] },
    metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 0, elapsedMs: 1 },
  };
  const service = new ItemFeasibilityService({
    readInventory: async () => readyInventory,
    episode: { build: async () => { builds += 1; return outcome; } },
    subdlLanguages: [],
    missingIntegrations: { episode: [], movie: [] },
    now: () => currentTime,
    ttlMs: 100,
    staleTtlMs: 5_000,
  });
  const selection = { application: "sonarr" as const, kind: "episode" as const, itemId: 305 };
  const first = await service.read(selection);
  outcome = {
    status: "integration_failure",
    mode: "read_only",
    failures: [{ integration: "bazarr", operation: "profile_list", state: "unavailable" }],
    releases: [],
    metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 0, elapsedMs: 2 },
  };

  currentTime = 1_101;
  const stale = await service.read(selection, { refresh: true });
  assert.equal(builds, 2);
  assert.equal(stale.status, "ready");
  if (first.status === "ready" && stale.status === "ready") {
    assert.strictEqual(stale.report, first.report);
    assert.deepEqual(stale.analysis, {
      ...first.analysis,
      source: "stale_cache",
      refreshFailure: "integration_failure",
      unavailableIntegrations: ["bazarr"],
    });
    assert.equal(stale.analysis.staleUntil, "1970-01-01T00:00:06.100Z");
  }

  currentTime = 1_150;
  const throttled = await service.read(selection);
  assert.equal(builds, 2);
  assert.equal(throttled.status === "ready" && throttled.analysis.source, "stale_cache");

  currentTime = 1_202;
  assert.equal((await service.read(selection)).status, "ready");
  assert.equal(builds, 3);

  currentTime = 6_100;
  const expired = await service.read(selection);
  assert.equal(expired.status, "integration_failure");
  assert.equal(builds, 4);
});

test("PEG-INSTANCE-002 colliding item IDs require and preserve exact Arr instance identity", async () => {
  const requests: SonarrEpisodeFeasibilityRequest[] = [];
  const alternate = {
    ...episode,
    instanceId: "sonarr-anime",
    parentId: 84,
    parentTitle: "Synthetic Anime",
    ids: { tvdb: "840305" },
  };
  const service = new ItemFeasibilityService({
    readInventory: async () => ({
      ...readyInventory,
      sources: [
        readyInventory.sources[0],
        { integration: "sonarr", status: "ready", page: { page: 1, pageSize: 2, totalRecords: 1, items: [alternate] } },
        readyInventory.sources[1],
      ],
    }),
    episode: {
      build: async (request) => {
        requests.push(request);
        return {
          status: "policy_unresolved",
          mode: "read_only",
          reason: "unassigned",
          releases: [],
          metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 0, elapsedMs: 1 },
        };
      },
    },
    subdlLanguages: [],
    missingIntegrations: { episode: [], movie: [] },
  });

  const ambiguous = await service.read({ application: "sonarr", kind: "episode", itemId: 305 });
  const main = await service.read({ application: "sonarr", instanceId: "sonarr", kind: "episode", itemId: 305 });
  const anime = await service.read({ application: "sonarr", instanceId: "sonarr-anime", kind: "episode", itemId: 305 });

  assert.equal(ambiguous.status, "not_found");
  assert.equal(main.selection.instanceId, "sonarr");
  assert.equal(anime.selection.instanceId, "sonarr-anime");
  assert.deepEqual(requests.map(({ sonarrSeriesId }) => sonarrSeriesId), [42, 84]);
});
