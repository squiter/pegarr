import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syntheticOpenSubtitlesEpisodeSearchResponse } from "./fixtures/opensubtitles-subtitle-search.js";
import { runOpenSubtitlesProbe } from "./probe-opensubtitles.js";

async function configuredEnvironment(): Promise<{
  readonly directory: string;
  readonly environment: Readonly<Record<string, string>>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-opensubtitles-probe-"));
  const secretPath = join(directory, "opensubtitles-api-key");
  await writeFile(secretPath, "synthetic-opensubtitles-api-key\n", { mode: 0o600 });
  return {
    directory,
    environment: {
      PEGARR_OPENSUBTITLES_URL: "https://api.opensubtitles.example.invalid/api/v1",
      PEGARR_OPENSUBTITLES_ALLOWED_HOSTS: "api.opensubtitles.example.invalid",
      PEGARR_OPENSUBTITLES_API_KEY_FILE: secretPath,
      PEGARR_OPENSUBTITLES_PROBE_KIND: "episode",
      PEGARR_OPENSUBTITLES_PROBE_IMDB_ID: "tt9000005",
      PEGARR_OPENSUBTITLES_PROBE_POLICY_LANGUAGE: "private-policy-language",
      PEGARR_OPENSUBTITLES_PROBE_PROVIDER_LANGUAGE: "en",
      PEGARR_OPENSUBTITLES_PROBE_SEASON: "3",
      PEGARR_OPENSUBTITLES_PROBE_EPISODE: "5",
    },
  };
}

test("PEG-PROBE-009 one-shot OpenSubtitles search reports only bounded aggregate evidence", async () => {
  const configured = await configuredEnvironment();
  try {
    const outputs: string[] = [];
    let requestUrl: URL | undefined;
    let requestHeaders: Headers | undefined;
    const times = [1_000, 1_025];
    const exitCode = await runOpenSubtitlesProbe({
      environment: configured.environment,
      fetchImplementation: async (input, init) => {
        requestUrl = new URL(input);
        requestHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify(syntheticOpenSubtitlesEpisodeSearchResponse), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-limit-second": "5",
            "x-ratelimit-remaining-second": "4",
          },
        });
      },
      now: () => times.shift() ?? 1_025,
      write: (value) => outputs.push(value),
    });

    assert.equal(exitCode, 0);
    assert.equal(requestUrl?.pathname, "/api/v1/subtitles");
    assert.equal(requestUrl?.searchParams.get("parent_imdb_id"), "9000005");
    assert.equal(requestHeaders?.get("api-key"), "synthetic-opensubtitles-api-key");
    assert.equal(requestHeaders?.get("user-agent"), "Pegarr v0.1.0");
    assert.deepEqual(JSON.parse(outputs.join("")), {
      probe: "opensubtitles-search",
      provider: "opensubtitles",
      mode: "read_only",
      configured: true,
      state: "available",
      requestCount: 1,
      subtitleCount: 2,
      quotaLimit: 5,
      quotaRemaining: 4,
      quotaWindowSeconds: 1,
      transportSecurity: "https",
      latencyMs: 25,
      observedAt: "1970-01-01T00:00:01.025Z",
    });
    assert.doesNotMatch(
      outputs.join(""),
      /tt9000005|9000005|private-policy-language|synthetic-opensubtitles-api-key|WEB-DL|GROUP/iu,
    );
  } finally {
    await rm(configured.directory, { recursive: true });
  }
});

test("PEG-PROBE-010 OpenSubtitles probe states stay distinct and invalid input is redacted", async () => {
  const outputs: string[] = [];
  assert.equal(
    await runOpenSubtitlesProbe({ environment: {}, write: (value) => outputs.push(value) }),
    2,
  );
  assert.equal(JSON.parse(outputs.pop() ?? "{}").state, "disabled");

  const configured = await configuredEnvironment();
  try {
    const cases = [
      { status: 429, headers: { "retry-after": "30" }, state: "rate_limited", body: {} },
      { status: 401, headers: {}, state: "unauthorized", body: {} },
      { status: 200, headers: {}, state: "invalid_response", body: { private: "value" } },
    ] as const;
    for (const testCase of cases) {
      const caseOutputs: string[] = [];
      const exitCode = await runOpenSubtitlesProbe({
        environment: configured.environment,
        fetchImplementation: async () =>
          new Response(JSON.stringify(testCase.body), {
            status: testCase.status,
            headers: testCase.headers,
          }),
        write: (value) => caseOutputs.push(value),
      });
      assert.equal(exitCode, 1);
      assert.equal(JSON.parse(caseOutputs.join("")).state, testCase.state);
      assert.doesNotMatch(
        caseOutputs.join(""),
        /private|tt9000005|synthetic-opensubtitles-api-key/iu,
      );
    }

    const invalidOutputs: string[] = [];
    const invalidEnvironment = {
      ...configured.environment,
      PEGARR_OPENSUBTITLES_PROBE_IMDB_ID: "private",
    };
    assert.equal(
      await runOpenSubtitlesProbe({
        environment: invalidEnvironment,
        write: (value) => invalidOutputs.push(value),
      }),
      2,
    );
    assert.equal(JSON.parse(invalidOutputs.join("")).state, "invalid_configuration");
    assert.doesNotMatch(invalidOutputs.join(""), /private/iu);
  } finally {
    await rm(configured.directory, { recursive: true });
  }
});
