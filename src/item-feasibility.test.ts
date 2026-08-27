import assert from "node:assert/strict";
import test from "node:test";

import type { MissingMediaItem } from "./domain.js";
import type { SonarrEpisodeFeasibilityRequest } from "./episode-feasibility.js";
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
      selection: { application: "sonarr", kind: "episode", itemId: 305 },
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
  assert.deepEqual(cached, first);

  currentTime += 30_001;
  await service.read(selection);
  assert.equal(builds, 2);
});
