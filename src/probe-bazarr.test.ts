import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syntheticBazarrLanguageProfilesResponse } from "./fixtures/bazarr-language-policy.js";
import { runBazarrProbe } from "./probe-bazarr.js";

test("PEG-PROBE-005 one-shot Bazarr profile probe reports only measured counts", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-bazarr-probe-"));
  context.after(async () => rm(directory, { recursive: true }));
  const secretPath = join(directory, "bazarr-api-key");
  await writeFile(secretPath, "synthetic-bazarr-key-value", { mode: 0o600 });
  const upstreamBody = JSON.stringify(syntheticBazarrLanguageProfilesResponse);
  const clock = [4_000, 4_037];
  let output = "";

  const exitCode = await runBazarrProbe({
    environment: {
      PEGARR_BAZARR_URL: "https://bazarr.example.invalid/root",
      PEGARR_BAZARR_ALLOWED_HOSTS: "bazarr.example.invalid",
      PEGARR_BAZARR_API_KEY_FILE: secretPath,
    },
    fetchImplementation: async () =>
      new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    now: () => clock.shift() ?? 4_037,
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(output), {
    probe: "bazarr-language-profiles",
    integration: "bazarr",
    mode: "read_only",
    configured: true,
    state: "available",
    profileCount: 2,
    languageItemCount: 4,
    responseBytes: new TextEncoder().encode(upstreamBody).byteLength,
    transportSecurity: "https",
    latencyMs: 37,
    observedAt: "1970-01-01T00:00:04.037Z",
  });
  assert.doesNotMatch(
    output,
    /synthetic-bazarr-key|multilingual|portuguese|primary_media|example\.invalid/iu,
  );
});

test("PEG-PROBE-006 Bazarr probe exit states stay distinct and redacted", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-bazarr-probe-errors-"));
  context.after(async () => rm(directory, { recursive: true }));
  const secretPath = join(directory, "bazarr-api-key");
  await writeFile(secretPath, "synthetic-bazarr-key-value", { mode: 0o600 });
  const outputs: string[] = [];
  const disabled = await runBazarrProbe({ environment: {}, write: (value) => outputs.push(value) });
  const invalid = await runBazarrProbe({
    environment: { PEGARR_BAZARR_API_KEY: "synthetic-direct-bazarr-secret" },
    write: (value) => outputs.push(value),
  });
  const unauthorized = await runBazarrProbe({
    environment: {
      PEGARR_BAZARR_URL: "https://bazarr.example.invalid",
      PEGARR_BAZARR_ALLOWED_HOSTS: "bazarr.example.invalid",
      PEGARR_BAZARR_API_KEY_FILE: secretPath,
    },
    fetchImplementation: async () => new Response("private response", { status: 401 }),
    now: () => 5_000,
    write: (value) => outputs.push(value),
  });

  assert.deepEqual([disabled, invalid, unauthorized], [2, 2, 1]);
  assert.deepEqual(
    outputs.map((value) => (JSON.parse(value) as { state: string }).state),
    ["disabled", "invalid_configuration", "unauthorized"],
  );
  assert.doesNotMatch(
    outputs.join(""),
    /synthetic-direct-bazarr-secret|API_KEY_FILE|private response|example\.invalid/iu,
  );
});
