import assert from "node:assert/strict";
import test from "node:test";

import { demoFeasibilityInput } from "./fixtures/demo.js";
import { buildFeasibilityReport } from "./matching.js";
import { feasibilityView, rowsFromInventory, selectReleases, selectRows } from "./web/dashboard-model.js";

const inventory = {
  status: "ready",
  sources: [
    {
      integration: "sonarr",
      status: "ready",
      page: {
        items: [
          {
            application: "sonarr",
            kind: "episode",
            itemId: 305,
            title: "Episode Five",
            parentTitle: "Synthetic Show",
            season: 3,
            episode: 5,
            availableAt: "2024-03-05T20:00:00Z",
          },
        ],
      },
    },
    {
      integration: "radarr",
      status: "ready",
      page: {
        items: [
          {
            application: "radarr",
            kind: "movie",
            itemId: 84,
            title: "A Synthetic Movie",
            year: 2024,
            availableAt: "2024-05-12T00:00:00Z",
          },
          {
            application: "radarr",
            kind: "movie",
            itemId: 85,
            title: "Later Movie",
            year: 2023,
          },
        ],
      },
    },
  ],
};

test("PEG-DASH-001 inventory view-model mapping preserves only display-safe fields", () => {
  const rows = rowsFromInventory(inventory);

  assert.deepEqual(rows, [
    {
      key: "sonarr:episode:305",
      itemId: 305,
      application: "sonarr",
      kind: "episode",
      title: "Synthetic Show",
      context: "S03E05 · Episode Five",
      availableAt: "2024-03-05T20:00:00Z",
    },
    {
      key: "radarr:movie:84",
      itemId: 84,
      application: "radarr",
      kind: "movie",
      title: "A Synthetic Movie",
      context: "2024",
      availableAt: "2024-05-12T00:00:00Z",
    },
    {
      key: "radarr:movie:85",
      itemId: 85,
      application: "radarr",
      kind: "movie",
      title: "Later Movie",
      context: "2023",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /ids|path|overview|token/iu);
});

test("PEG-DASH-004 release view preserves Arr rejections and honest subtitle evidence", () => {
  const view = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    selection: { application: "sonarr", kind: "episode", itemId: 305 },
    report: buildFeasibilityReport(demoFeasibilityInput),
    metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 2, elapsedMs: 5 },
  });

  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  assert.equal(view.releases.length, 4);
  assert.equal(view.releases[0]?.downloadAllowed, true);
  const rejected = view.releases.find(({ downloadAllowed }) => !downloadAllowed);
  assert.deepEqual(rejected?.rejectionReasons, ["Quality profile does not allow HDTV-720p"]);
  assert.ok(view.releases.some(({ languages }) => languages.some(({ confidence }) => confidence === "unknown")));
  assert.ok(view.releases.some(({ languages }) => languages.some(({ evidence }) => evidence?.reasons.includes("Exact normalized release name"))));

  assert.deepEqual(
    feasibilityView({ kind: "item-feasibility", mode: "read_only", status: "policy_unresolved", reason: "unassigned" }),
    { state: "policy_unresolved", message: "Bazarr policy is unassigned. Pegarr did not assume a subtitle language." },
  );
});

test("PEG-DASH-005 analysis diagnostics preserve safe request, quota, and cache evidence", () => {
  const report = buildFeasibilityReport(demoFeasibilityInput);
  const view = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    selection: { application: "sonarr", kind: "episode", itemId: 305 },
    analysis: {
      source: "memory_cache",
      generatedAt: "2026-08-27T12:00:00.000Z",
      expiresAt: "2026-08-27T12:00:30.000Z",
    },
    report: {
      ...report,
      providerStatus: [{
        provider: "subdl",
        status: "success",
        searchedLanguages: ["pt-BR"],
        quota: { limit: 2_000, remaining: 1_999, resetAtEpochSeconds: 1_788_000_000 },
        cache: {
          status: "hit",
          storedAt: "2026-08-27T11:59:00.000Z",
          expiresAt: "2026-08-27T12:14:00.000Z",
        },
      }],
    },
    metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 0, elapsedMs: 17 },
  });

  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  assert.deepEqual(view.analysis, {
    source: "memory_cache",
    generatedAt: "2026-08-27T12:00:00.000Z",
    expiresAt: "2026-08-27T12:00:30.000Z",
    unavailableIntegrations: [],
    elapsedMs: 17,
    arrRequests: 1,
    bazarrRequests: 2,
    providerRequests: 0,
  });
  assert.deepEqual(view.providers, [{
    provider: "subdl",
    status: "success",
    detail: "",
    cacheStatus: "hit",
    cachedAt: "2026-08-27T11:59:00.000Z",
    cacheExpiresAt: "2026-08-27T12:14:00.000Z",
    quota: { limit: 2_000, remaining: 1_999, resetAtEpochSeconds: 1_788_000_000 },
  }]);
  assert.ok(view.releases.some(({ languages }) => languages.some(({ providerCount }) => providerCount > 0)));
  assert.doesNotMatch(JSON.stringify(view), /token|api.?key|example\.invalid/iu);
});

test("PEG-DASH-006 stale analysis remains visibly distinct from fresh evidence", () => {
  const view = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    selection: { application: "sonarr", kind: "episode", itemId: 305 },
    analysis: {
      source: "stale_cache",
      generatedAt: "2026-08-27T12:00:00.000Z",
      expiresAt: "2026-08-27T12:00:30.000Z",
      staleUntil: "2026-08-27T18:00:30.000Z",
      refreshFailure: "integration_failure",
      unavailableIntegrations: ["sonarr", "bazarr", "private-upstream"],
    },
    report: buildFeasibilityReport(demoFeasibilityInput),
    metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 1, elapsedMs: 8 },
  });

  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  assert.deepEqual(view.analysis, {
    source: "stale_cache",
    generatedAt: "2026-08-27T12:00:00.000Z",
    expiresAt: "2026-08-27T12:00:30.000Z",
    staleUntil: "2026-08-27T18:00:30.000Z",
    refreshFailure: "integration_failure",
    unavailableIntegrations: ["sonarr", "bazarr"],
    elapsedMs: 8,
    arrRequests: 1,
    bazarrRequests: 2,
    providerRequests: 1,
  });
  assert.equal(view.releases.length, 4);
  assert.doesNotMatch(JSON.stringify(view), /private-upstream/iu);
});

test("PEG-DASH-007 release filtering and sorting stay local and preserve Arr decisions", () => {
  const view = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    selection: { application: "sonarr", kind: "episode", itemId: 305 },
    report: buildFeasibilityReport(demoFeasibilityInput),
    metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 2, elapsedMs: 5 },
  });

  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  const originalOrder = view.releases.map(({ id }) => id);
  const rejected = selectReleases(view.releases, { decision: "rejected" });
  const confirmed = selectReleases(view.releases, { confidence: "confirmed" });
  const byCustomFormat = selectReleases(view.releases, { sort: "custom-format-desc" });
  const byTitle = selectReleases(view.releases, { sort: "title-asc" });

  assert.ok(rejected.length > 0);
  assert.ok(rejected.every(({ downloadAllowed, rejectionReasons }) => !downloadAllowed && rejectionReasons.length > 0));
  assert.ok(confirmed.length > 0);
  assert.ok(confirmed.every(({ confidence }) => confidence === "confirmed"));
  assert.ok(byCustomFormat.every((release, index) => index === 0 || byCustomFormat[index - 1]!.customFormatScore >= release.customFormatScore));
  assert.deepEqual(byTitle.map(({ title }) => title), byTitle.map(({ title }) => title).toSorted((left, right) => left.localeCompare(right)));
  assert.deepEqual(view.releases.map(({ id }) => id), originalOrder);
  assert.deepEqual(selectReleases(view.releases, { decision: "unsafe", confidence: "unsafe", sort: "unsafe" }), view.releases);
});

test("PEG-DASH-002 search, filtering, and sorting are pure local operations", () => {
  const rows = rowsFromInventory(inventory);

  assert.deepEqual(
    selectRows(rows, { kind: "movie", sort: "title-asc" }).map(({ title }) => title),
    ["A Synthetic Movie", "Later Movie"],
  );
  assert.deepEqual(
    selectRows(rows, { query: "s03e05" }).map(({ key }) => key),
    ["sonarr:episode:305"],
  );
  assert.deepEqual(
    selectRows(rows, { sort: "available-desc" }).map(({ key }) => key),
    ["radarr:movie:84", "sonarr:episode:305", "radarr:movie:85"],
  );
  assert.deepEqual(rowsFromInventory({ sources: [{ status: "ready", page: { items: [{}] } }] }), []);
});
