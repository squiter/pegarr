import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syntheticSubdlV2EpisodeSearchResponse } from "./fixtures/subdl-v2-subtitle-search.js";
import { runSubdlProbe } from "./probe-subdl.js";

async function configuredEnvironment(): Promise<{
  readonly directory: string;
  readonly environment: Readonly<Record<string, string>>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-subdl-probe-"));
  const secretPath = join(directory, "subdl-api-key");
  await writeFile(secretPath, "synthetic-subdl-api-key\n", { mode: 0o600 });
  return {
    directory,
    environment: {
      PEGARR_SUBDL_URL: "https://api.subdl.example.invalid",
      PEGARR_SUBDL_ALLOWED_HOSTS: "api.subdl.example.invalid",
      PEGARR_SUBDL_API_KEY_FILE: secretPath,
      PEGARR_SUBDL_PROBE_KIND: "episode",
      PEGARR_SUBDL_PROBE_IMDB_ID: "tt9000005",
      PEGARR_SUBDL_PROBE_POLICY_LANGUAGE: "private-policy-language",
      PEGARR_SUBDL_PROBE_PROVIDER_LANGUAGE: "EN",
      PEGARR_SUBDL_PROBE_SEASON: "3",
      PEGARR_SUBDL_PROBE_EPISODE: "5",
    },
  };
}

test("PEG-PROBE-007 one-shot SubDL search reports only bounded aggregate evidence", async () => {
  const configured = await configuredEnvironment();
  try {
    const outputs: string[] = [];
    let requestUrl: URL | undefined;
    let requestHeaders: Headers | undefined;
    const times = [1_000, 1_025];
    const exitCode = await runSubdlProbe({
      environment: configured.environment,
      fetchImplementation: async (input, init) => {
        requestUrl = new URL(input);
        requestHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify(syntheticSubdlV2EpisodeSearchResponse), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-limit": "2000",
            "x-ratelimit-remaining": "1999",
          },
        });
      },
      now: () => times.shift() ?? 1_025,
      write: (value) => outputs.push(value),
    });

    assert.equal(exitCode, 0);
    assert.equal(requestUrl?.pathname, "/api/v2/subtitles/search");
    assert.equal(requestUrl?.searchParams.get("imdb_id"), "tt9000005");
    assert.equal(requestHeaders?.get("authorization"), "Bearer synthetic-subdl-api-key");
    assert.deepEqual(JSON.parse(outputs.join("")), {
      probe: "subdl-search",
      provider: "subdl",
      mode: "read_only",
      configured: true,
      state: "available",
      requestCount: 1,
      subtitleCount: 3,
      quotaLimit: 2000,
      quotaRemaining: 1999,
      transportSecurity: "https",
      latencyMs: 25,
      observedAt: "1970-01-01T00:00:01.025Z",
    });
    assert.doesNotMatch(
      outputs.join(""),
      /tt9000005|private-policy-language|synthetic-subdl-api-key|WEB-DL|GROUP/iu,
    );
  } finally {
    await rm(configured.directory, { recursive: true });
  }
});

test("PEG-PROBE-008 SubDL probe states stay distinct and invalid input is redacted", async () => {
  const outputs: string[] = [];
  assert.equal(
    await runSubdlProbe({ environment: {}, write: (value) => outputs.push(value) }),
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
      const exitCode = await runSubdlProbe({
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
      assert.doesNotMatch(caseOutputs.join(""), /private|tt9000005|synthetic-subdl-api-key/iu);
    }

    const invalidOutputs: string[] = [];
    const invalidEnvironment = { ...configured.environment, PEGARR_SUBDL_PROBE_IMDB_ID: "private" };
    assert.equal(
      await runSubdlProbe({
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
