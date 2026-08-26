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
import { syntheticSonarrEpisodeReleaseResponse } from "./fixtures/sonarr-release-search.js";
import { syntheticSubdlV2EpisodeSearchResponse } from "./fixtures/subdl-v2-subtitle-search.js";
import { runSonarrEpisodeReport } from "./report-sonarr-episode.js";

async function fixtureEnvironment() {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-episode-report-"));
  const files = {
    sonarr: join(directory, "sonarr_api_key"),
    bazarr: join(directory, "bazarr_api_key"),
    subdl: join(directory, "subdl_api_key"),
    request: join(directory, "request.json"),
  };
  await Promise.all([
    writeFile(files.sonarr, "synthetic-sonarr-key-value", { mode: 0o600 }),
    writeFile(files.bazarr, "synthetic-bazarr-key-value", { mode: 0o600 }),
    writeFile(files.subdl, "synthetic-subdl-key-value", { mode: 0o600 }),
    writeFile(files.request, JSON.stringify({
      episodeId: 305,
      sonarrSeriesId: 42,
      item: {
        kind: "episode",
        title: "Private Synthetic Show — S03E05",
        season: 3,
        episode: 5,
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
      PEGARR_EPISODE_REPORT_REQUEST_FILE: files.request,
    },
  };
}

test("PEG-REPORT-001 packaged episode report composes all three read-only integrations", async () => {
  const fixture = await fixtureEnvironment();
  try {
    const requests: URL[] = [];
    const fetchImplementation: FetchImplementation = async (input) => {
      const url = new URL(input);
      requests.push(url);
      if (url.hostname === "sonarr.example.invalid") {
        return json(syntheticSonarrEpisodeReleaseResponse);
      }
      if (url.hostname === "bazarr.example.invalid" && url.pathname.endsWith("/profiles")) {
        return json(syntheticBazarrLanguageProfilesResponse);
      }
      if (url.hostname === "bazarr.example.invalid") {
        return json(syntheticBazarrSeriesAssignmentResponse);
      }
      if (url.searchParams.get("languages") === "PT-BR") {
        return json(syntheticSubdlV2EpisodeSearchResponse);
      }
      return json({ status: true, subtitles: [] });
    };
    const output: string[] = [];
    const times = [1_000, 1_125];
    const exitCode = await runSonarrEpisodeReport({
      environment: fixture.environment,
      fetchImplementation,
      now: () => times.shift() ?? 1_125,
      write: (value) => output.push(value),
    });

    assert.equal(exitCode, 0);
    const report = JSON.parse(output.join(""));
    assert.equal(report.kind, "sonarr-episode-feasibility");
    assert.equal(report.status, "ready");
    assert.equal(report.mode, "read_only");
    assert.equal(report.report.mode, "read_only");
    assert.equal(report.report.releases.length, 4);
    assert.deepEqual(report.metrics, {
      sonarrRequests: 1,
      bazarrRequests: 2,
      providerRequests: 3,
      elapsedMs: 125,
    });
    assert.equal(requests.filter(({ hostname }) => hostname === "sonarr.example.invalid").length, 1);
    assert.equal(requests.filter(({ hostname }) => hostname === "bazarr.example.invalid").length, 2);
    assert.equal(requests.filter(({ hostname }) => hostname === "subdl.example.invalid").length, 3);
    assert.doesNotMatch(output.join(""), /synthetic-(?:sonarr|bazarr|subdl)-key-value/iu);
  } finally {
    await rm(fixture.directory, { recursive: true });
  }
});

test("PEG-REPORT-002 invalid or incomplete report configuration fails before network access", async () => {
  let fetchCalls = 0;
  const outputs: string[] = [];
  const exitCode = await runSonarrEpisodeReport({
    environment: { PEGARR_EPISODE_REPORT_REQUEST_FILE: "/private/missing/request.json" },
    fetchImplementation: async () => {
      fetchCalls += 1;
      return json({});
    },
    write: (value) => outputs.push(value),
  });

  assert.equal(exitCode, 2);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(JSON.parse(outputs.join("")), {
    kind: "sonarr-episode-feasibility",
    mode: "read_only",
    status: "disabled",
  });
  assert.doesNotMatch(outputs.join(""), /private|missing/iu);
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
