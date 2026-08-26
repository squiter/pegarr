import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { syntheticBazarrLanguageProfilesResponse } from "./fixtures/bazarr-language-policy.js";
import { syntheticRadarrMovieReleaseResponse } from "./fixtures/radarr-release-search.js";
import { syntheticSubdlV2MovieSearchResponse } from "./fixtures/subdl-v2-subtitle-search.js";
import { runRadarrMovieReport } from "./report-radarr-movie.js";

async function fixtureEnvironment() {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-movie-report-"));
  const files = {
    radarr: join(directory, "radarr_api_key"),
    bazarr: join(directory, "bazarr_api_key"),
    subdl: join(directory, "subdl_api_key"),
    request: join(directory, "request.json"),
  };
  await Promise.all([
    writeFile(files.radarr, "synthetic-radarr-key-value", { mode: 0o600 }),
    writeFile(files.bazarr, "synthetic-bazarr-key-value", { mode: 0o600 }),
    writeFile(files.subdl, "synthetic-subdl-key-value", { mode: 0o600 }),
    writeFile(files.request, JSON.stringify({
      movieId: 84,
      item: {
        kind: "movie",
        title: "Private Synthetic Movie",
        year: 2024,
        ids: { imdb: "tt9000084", tmdb: "900084" },
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
    files,
    environment: {
      PEGARR_RADARR_URL: "https://radarr.example.invalid",
      PEGARR_RADARR_ALLOWED_HOSTS: "radarr.example.invalid",
      PEGARR_RADARR_API_KEY_FILE: files.radarr,
      PEGARR_BAZARR_URL: "https://bazarr.example.invalid",
      PEGARR_BAZARR_ALLOWED_HOSTS: "bazarr.example.invalid",
      PEGARR_BAZARR_API_KEY_FILE: files.bazarr,
      PEGARR_SUBDL_URL: "https://subdl.example.invalid",
      PEGARR_SUBDL_ALLOWED_HOSTS: "subdl.example.invalid",
      PEGARR_SUBDL_API_KEY_FILE: files.subdl,
      PEGARR_MOVIE_REPORT_REQUEST_FILE: files.request,
    },
  };
}

test("PEG-MOVIEREPORT-001 packaged movie report composes all three read-only integrations", async () => {
  const fixture = await fixtureEnvironment();
  try {
    const requests: URL[] = [];
    const fetchImplementation: FetchImplementation = async (input) => {
      const url = new URL(input);
      requests.push(url);
      if (url.hostname === "radarr.example.invalid") {
        return json(syntheticRadarrMovieReleaseResponse);
      }
      if (url.hostname === "bazarr.example.invalid" && url.pathname.endsWith("/profiles")) {
        return json(syntheticBazarrLanguageProfilesResponse);
      }
      if (url.hostname === "bazarr.example.invalid") {
        return json({ data: [{ radarrId: 84, profileId: 7 }], total: 1 });
      }
      if (url.searchParams.get("languages") === "PT-BR") {
        return json(syntheticSubdlV2MovieSearchResponse);
      }
      return json({ status: true, subtitles: [] });
    };
    const output: string[] = [];
    const times = [2_000, 2_140];
    const exitCode = await runRadarrMovieReport({
      environment: fixture.environment,
      fetchImplementation,
      now: () => times.shift() ?? 2_140,
      write: (value) => output.push(value),
    });

    assert.equal(exitCode, 0);
    const report = JSON.parse(output.join(""));
    assert.equal(report.kind, "radarr-movie-feasibility");
    assert.equal(report.status, "ready");
    assert.equal(report.mode, "read_only");
    assert.equal(report.report.mode, "read_only");
    assert.equal(report.report.releases.length, 2);
    assert.deepEqual(report.metrics, {
      radarrRequests: 1,
      bazarrRequests: 2,
      providerRequests: 3,
      elapsedMs: 140,
    });
    assert.equal(requests.filter(({ hostname }) => hostname === "radarr.example.invalid").length, 1);
    assert.equal(requests.filter(({ hostname }) => hostname === "bazarr.example.invalid").length, 2);
    assert.equal(requests.filter(({ hostname }) => hostname === "subdl.example.invalid").length, 3);
    assert.doesNotMatch(output.join(""), /synthetic-(?:radarr|bazarr|subdl)-key-value/iu);
  } finally {
    await rm(fixture.directory, { recursive: true });
  }
});

test("PEG-MOVIEREPORT-002 invalid or incomplete movie report fails before network access", async () => {
  let fetchCalls = 0;
  const outputs: string[] = [];
  const exitCode = await runRadarrMovieReport({
    environment: { PEGARR_MOVIE_REPORT_REQUEST_FILE: "/private/missing/request.json" },
    fetchImplementation: async () => {
      fetchCalls += 1;
      return json({});
    },
    write: (value) => outputs.push(value),
  });

  assert.equal(exitCode, 2);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(JSON.parse(outputs.join("")), {
    kind: "radarr-movie-feasibility",
    mode: "read_only",
    status: "disabled",
  });
  assert.doesNotMatch(outputs.join(""), /private|missing/iu);

  const fixture = await fixtureEnvironment();
  try {
    await writeFile(fixture.files.request, JSON.stringify({
      movieId: 84,
      item: {
        kind: "movie",
        title: "Invalid synthetic request",
        ids: { tvdb: "unsupported-id" },
      },
      subdlLanguages: [{ policyCode: "en", providerCode: "EN" }],
    }), { mode: 0o600 });
    const invalidOutputs: string[] = [];
    const invalidExitCode = await runRadarrMovieReport({
      environment: fixture.environment,
      fetchImplementation: async () => {
        fetchCalls += 1;
        return json({});
      },
      write: (value) => invalidOutputs.push(value),
    });
    assert.equal(invalidExitCode, 2);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(JSON.parse(invalidOutputs.join("")), {
      kind: "radarr-movie-feasibility",
      mode: "read_only",
      status: "invalid_configuration",
    });
    assert.doesNotMatch(invalidOutputs.join(""), /unsupported-id/iu);
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
