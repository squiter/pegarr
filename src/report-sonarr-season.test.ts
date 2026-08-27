import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import {
  syntheticBazarrLanguageProfilesResponse,
  syntheticBazarrSeriesAssignmentResponse,
} from "./fixtures/bazarr-language-policy.js";
import { syntheticSonarrSeasonReleaseResponse } from "./fixtures/sonarr-season-release-search.js";
import { syntheticSubdlV2SeasonSearchResponse } from "./fixtures/subdl-v2-subtitle-search.js";
import { runSonarrSeasonReport } from "./report-sonarr-season.js";

async function fixtureEnvironment() {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-season-report-"));
  const files = {
    sonarr: join(directory, "sonarr_api_key"),
    bazarr: join(directory, "bazarr_api_key"),
    subdl: join(directory, "subdl_api_key"),
    request: join(directory, "request.json"),
  };
  await Promise.all([
    writeFile(files.sonarr, "synthetic-season-sonarr-key", { mode: 0o600 }),
    writeFile(files.bazarr, "synthetic-season-bazarr-key", { mode: 0o600 }),
    writeFile(files.subdl, "synthetic-season-subdl-key", { mode: 0o600 }),
    writeFile(files.request, JSON.stringify({
      sonarrSeriesId: 42,
      seasonNumber: 3,
      item: {
        kind: "season",
        title: "Private Synthetic Show — Season 3",
        season: 3,
        ids: { imdb: "tt9000005", tmdb: "900005" },
      },
      subdlLanguages: [
        { policyCode: "en", providerCode: "EN" },
        { policyCode: "pt-BR", providerCode: "PT-BR" },
        { policyCode: "es", providerCode: "ES" },
      ],
    }), { mode: 0o600 }),
  ]);
  return {
    directory,
    environment: {
      PEGARR_SONARR_URL: "https://sonarr.example.invalid",
      PEGARR_SONARR_ALLOWED_HOSTS: "sonarr.example.invalid",
      PEGARR_SONARR_API_KEY_FILE: files.sonarr,
      PEGARR_BAZARR_URL: "https://bazarr.example.invalid",
      PEGARR_BAZARR_ALLOWED_HOSTS: "bazarr.example.invalid",
      PEGARR_BAZARR_API_KEY_FILE: files.bazarr,
      PEGARR_SUBDL_URL: "https://subdl.example.invalid",
      PEGARR_SUBDL_ALLOWED_HOSTS: "subdl.example.invalid",
      PEGARR_SUBDL_API_KEY_FILE: files.subdl,
      PEGARR_SEASON_REPORT_REQUEST_FILE: files.request,
    },
  };
}

test("PEG-SEASONREPORT-001 packaged season report composes all three read-only integrations", async () => {
  const fixture = await fixtureEnvironment();
  try {
    const requests: URL[] = [];
    const fetchImplementation: FetchImplementation = async (input) => {
      const url = new URL(input);
      requests.push(url);
      if (url.hostname === "sonarr.example.invalid") return json(syntheticSonarrSeasonReleaseResponse);
      if (url.hostname === "bazarr.example.invalid" && url.pathname.endsWith("/profiles")) {
        return json(syntheticBazarrLanguageProfilesResponse);
      }
      if (url.hostname === "bazarr.example.invalid") return json(syntheticBazarrSeriesAssignmentResponse);
      if (url.searchParams.get("languages") === "PT-BR") return json(syntheticSubdlV2SeasonSearchResponse);
      return json({ status: true, subtitles: [] });
    };
    const output: string[] = [];
    const times = [4_000, 4_120];
    const exitCode = await runSonarrSeasonReport({
      environment: fixture.environment,
      fetchImplementation,
      now: () => times.shift() ?? 4_120,
      write: (value) => output.push(value),
    });

    assert.equal(exitCode, 0);
    const report = JSON.parse(output.join(""));
    assert.equal(report.kind, "sonarr-season-feasibility");
    assert.equal(report.status, "ready");
    assert.equal(report.mode, "read_only");
    assert.equal(report.report.releases.length, 2);
    assert.equal(report.report.releases[0].video.evidence.fullSeason, true);
    assert.equal(report.report.releases[0].subtitle.languages[1].confidence, "confirmed");
    assert.deepEqual(report.metrics, {
      sonarrRequests: 1,
      bazarrRequests: 2,
      providerRequests: 3,
      elapsedMs: 120,
    });
    assert.equal(requests.filter(({ hostname }) => hostname === "sonarr.example.invalid").length, 1);
    assert.equal(requests.filter(({ hostname }) => hostname === "bazarr.example.invalid").length, 2);
    assert.equal(requests.filter(({ hostname }) => hostname === "subdl.example.invalid").length, 3);
    assert.doesNotMatch(output.join(""), /synthetic-season-(?:sonarr|bazarr|subdl)-key/iu);
  } finally {
    await rm(fixture.directory, { recursive: true });
  }
});

test("PEG-SEASONREPORT-002 incomplete season report configuration fails before network", async () => {
  let fetchCalls = 0;
  const output: string[] = [];
  const exitCode = await runSonarrSeasonReport({
    environment: { PEGARR_SEASON_REPORT_REQUEST_FILE: "/private/missing/request.json" },
    fetchImplementation: async () => {
      fetchCalls += 1;
      return json({});
    },
    write: (value) => output.push(value),
  });

  assert.equal(exitCode, 2);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(JSON.parse(output.join("")), {
    kind: "sonarr-season-feasibility",
    mode: "read_only",
    status: "disabled",
  });
  assert.doesNotMatch(output.join(""), /private|missing/iu);
});

test("PEG-CACHE-005 packaged reports reuse successful provider windows after cache reopen", async () => {
  const fixture = await fixtureEnvironment();
  try {
    const requests: URL[] = [];
    const fetchImplementation: FetchImplementation = async (input) => {
      const url = new URL(input);
      requests.push(url);
      if (url.hostname === "sonarr.example.invalid") return json(syntheticSonarrSeasonReleaseResponse);
      if (url.hostname === "bazarr.example.invalid" && url.pathname.endsWith("/profiles")) {
        return json(syntheticBazarrLanguageProfilesResponse);
      }
      if (url.hostname === "bazarr.example.invalid") return json(syntheticBazarrSeriesAssignmentResponse);
      if (url.searchParams.get("languages") === "PT-BR") return json(syntheticSubdlV2SeasonSearchResponse);
      return json({ status: true, subtitles: [] });
    };
    const environment = {
      ...fixture.environment,
      DATA_DIR: fixture.directory,
      PEGARR_PROVIDER_CACHE_FILE: join(fixture.directory, "provider-search-cache.sqlite"),
    };
    const outputs: string[][] = [[], []];
    for (const output of outputs) {
      const exitCode = await runSonarrSeasonReport({
        environment,
        fetchImplementation,
        write: (value) => output.push(value),
      });
      assert.equal(exitCode, 0);
    }

    const first = JSON.parse(outputs[0]?.join("") ?? "");
    const second = JSON.parse(outputs[1]?.join("") ?? "");
    assert.equal(first.metrics.providerRequests, 3);
    assert.equal(second.metrics.providerRequests, 0);
    assert.deepEqual(
      first.report.providerStatus.map(({ cache }: { cache: { status: string } }) => cache.status),
      ["miss", "miss", "miss"],
    );
    assert.deepEqual(
      second.report.providerStatus.map(({ cache }: { cache: { status: string } }) => cache.status),
      ["hit", "hit", "hit"],
    );
    assert.equal(requests.filter(({ hostname }) => hostname === "subdl.example.invalid").length, 3);
    assert.equal(requests.filter(({ hostname }) => hostname === "sonarr.example.invalid").length, 2);
    assert.equal(requests.filter(({ hostname }) => hostname === "bazarr.example.invalid").length, 4);
  } finally {
    await rm(fixture.directory, { recursive: true });
  }
});

test("PEG-CACHE-006 unsafe packaged cache configuration fails before network", async () => {
  const fixture = await fixtureEnvironment();
  try {
    let fetchCalls = 0;
    const validCache = join(fixture.directory, "provider-search-cache.sqlite");
    const invalidEnvironments = [
      {
        DATA_DIR: fixture.directory,
        PEGARR_PROVIDER_CACHE_FILE: join(fixture.directory, "..", "escaped.sqlite"),
      },
      { DATA_DIR: "relative-data", PEGARR_PROVIDER_CACHE_FILE: validCache },
      {
        DATA_DIR: fixture.directory,
        PEGARR_PROVIDER_CACHE_FILE: validCache,
        PEGARR_PROVIDER_CACHE_TTL_SECONDS: "0",
      },
      {
        DATA_DIR: fixture.directory,
        PEGARR_PROVIDER_CACHE_FILE: validCache,
        PEGARR_PROVIDER_CACHE_MAX_ENTRIES: "100001",
      },
    ];
    for (const invalidEnvironment of invalidEnvironments) {
      const output: string[] = [];
      const exitCode = await runSonarrSeasonReport({
        environment: { ...fixture.environment, ...invalidEnvironment },
        fetchImplementation: async () => {
          fetchCalls += 1;
          return json({});
        },
        write: (value) => output.push(value),
      });

      assert.equal(exitCode, 2);
      assert.deepEqual(JSON.parse(output.join("")), {
        kind: "sonarr-season-feasibility",
        mode: "read_only",
        status: "invalid_configuration",
      });
      assert.doesNotMatch(output.join(""), /escaped|provider-search-cache|\.sqlite/iu);
    }
    assert.equal(fetchCalls, 0);
  } finally {
    await rm(fixture.directory, { recursive: true });
  }
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
