import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { syntheticRadarrMissingItemsResponse } from "./fixtures/radarr-missing-items.js";
import { syntheticSonarrMissingItemsResponse } from "./fixtures/sonarr-missing-items.js";
import { runMissingInventory } from "./inventory-missing.js";

async function fixtureEnvironment() {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-missing-inventory-"));
  const sonarr = join(directory, "sonarr_api_key");
  const radarr = join(directory, "radarr_api_key");
  await Promise.all([
    writeFile(sonarr, "synthetic-sonarr-inventory-key", { mode: 0o600 }),
    writeFile(radarr, "synthetic-radarr-inventory-key", { mode: 0o600 }),
  ]);
  return {
    directory,
    environment: {
      PEGARR_SONARR_URL: "https://sonarr.example.invalid",
      PEGARR_SONARR_ALLOWED_HOSTS: "sonarr.example.invalid",
      PEGARR_SONARR_API_KEY_FILE: sonarr,
      PEGARR_RADARR_URL: "https://radarr.example.invalid",
      PEGARR_RADARR_ALLOWED_HOSTS: "radarr.example.invalid",
      PEGARR_RADARR_API_KEY_FILE: radarr,
      PEGARR_MISSING_PAGE_SIZE: "2",
    },
  };
}

test("PEG-INVENTORY-001 packaged inventory reads one bounded page from each configured Arr", async () => {
  const fixture = await fixtureEnvironment();
  try {
    const requests: URL[] = [];
    const fetchImplementation: FetchImplementation = async (input) => {
      const url = new URL(input);
      requests.push(url);
      return json(url.hostname.startsWith("sonarr")
        ? syntheticSonarrMissingItemsResponse
        : syntheticRadarrMissingItemsResponse);
    };
    const output: string[] = [];
    const times = [1_000, 1_080];
    const exitCode = await runMissingInventory({
      environment: fixture.environment,
      fetchImplementation,
      now: () => times.shift() ?? 1_080,
      write: (value) => output.push(value),
    });

    assert.equal(exitCode, 0);
    const inventory = JSON.parse(output.join(""));
    assert.equal(inventory.kind, "missing-item-inventory");
    assert.equal(inventory.mode, "read_only");
    assert.equal(inventory.status, "ready");
    assert.deepEqual(inventory.metrics, { requestCount: 2, itemCount: 4, elapsedMs: 80 });
    assert.equal(inventory.sources[0].page.items[0].kind, "episode");
    assert.equal(inventory.sources[1].page.items[0].kind, "movie");
    assert.equal(requests.length, 2);
    assert.ok(requests.every((url) => url.pathname === "/api/v3/wanted/missing"));
    assert.ok(requests.every((url) => url.searchParams.get("pageSize") === "2"));
    assert.doesNotMatch(output.join(""), /inventory-key|private|overview|path|images/iu);
  } finally {
    await rm(fixture.directory, { recursive: true });
  }
});

test("PEG-INVENTORY-002 one unavailable Arr produces usable partial inventory", async () => {
  const fixture = await fixtureEnvironment();
  try {
    const output: string[] = [];
    const exitCode = await runMissingInventory({
      environment: fixture.environment,
      fetchImplementation: async (input) => {
        const url = new URL(input);
        if (url.hostname.startsWith("radarr")) return new Response("{}", { status: 503 });
        return json(syntheticSonarrMissingItemsResponse);
      },
      write: (value) => output.push(value),
    });

    assert.equal(exitCode, 0);
    const inventory = JSON.parse(output.join(""));
    assert.equal(inventory.status, "partial");
    assert.equal(inventory.sources[0].status, "ready");
    assert.deepEqual(inventory.sources[1], {
      integration: "radarr",
      status: "integration_failure",
      state: "unavailable",
    });
    assert.equal(inventory.metrics.itemCount, 2);
  } finally {
    await rm(fixture.directory, { recursive: true });
  }
});

test("PEG-INVENTORY-003 disabled or invalid inventory configuration fails before network", async () => {
  let fetchCalls = 0;
  const output: string[] = [];
  const exitCode = await runMissingInventory({
    environment: {},
    fetchImplementation: async () => {
      fetchCalls += 1;
      return json({});
    },
    write: (value) => output.push(value),
  });
  assert.equal(exitCode, 2);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(JSON.parse(output.join("")), {
    kind: "missing-item-inventory",
    mode: "read_only",
    status: "disabled",
  });

  const invalidOutput: string[] = [];
  const invalidExitCode = await runMissingInventory({
    environment: { PEGARR_MISSING_PAGE_SIZE: "101" },
    fetchImplementation: async () => {
      fetchCalls += 1;
      return json({});
    },
    write: (value) => invalidOutput.push(value),
  });
  assert.equal(invalidExitCode, 2);
  assert.equal(fetchCalls, 0);
  assert.equal(JSON.parse(invalidOutput.join("")).status, "invalid_configuration");
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
