import assert from "node:assert/strict";
import test from "node:test";

import { rowsFromInventory, selectRows } from "./web/dashboard-model.js";

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
      application: "sonarr",
      kind: "episode",
      title: "Synthetic Show",
      context: "S03E05 · Episode Five",
      availableAt: "2024-03-05T20:00:00Z",
    },
    {
      key: "radarr:movie:84",
      application: "radarr",
      kind: "movie",
      title: "A Synthetic Movie",
      context: "2024",
      availableAt: "2024-05-12T00:00:00Z",
    },
    {
      key: "radarr:movie:85",
      application: "radarr",
      kind: "movie",
      title: "Later Movie",
      context: "2023",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /ids|path|overview|token/iu);
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
