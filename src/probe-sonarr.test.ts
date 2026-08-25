import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syntheticSonarrSystemStatusResponse } from "./fixtures/sonarr-system-status.js";
import { runSonarrProbe } from "./probe-sonarr.js";

test("PEG-PROBE-001 one-shot Sonarr probe reports measured safe evidence", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-probe-"));
  context.after(async () => rm(directory, { recursive: true }));
  const secretPath = join(directory, "sonarr-api-key");
  const secret = "synthetic-api-key-value";
  await writeFile(secretPath, secret, { mode: 0o600 });
  const upstreamBody = JSON.stringify(syntheticSonarrSystemStatusResponse);
  const clock = [1_000, 1_025];
  let output = "";

  const exitCode = await runSonarrProbe({
    environment: {
      PEGARR_SONARR_URL: "https://sonarr.example.invalid/root",
      PEGARR_SONARR_ALLOWED_HOSTS: "sonarr.example.invalid",
      PEGARR_SONARR_API_KEY_FILE: secretPath,
    },
    fetchImplementation: async () =>
      new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    now: () => clock.shift() ?? 1_025,
    write: (value) => {
      output += value;
    },
  });
  const report = JSON.parse(output) as Record<string, unknown>;

  assert.equal(exitCode, 0);
  assert.deepEqual(report, {
    probe: "sonarr-status",
    integration: "sonarr",
    mode: "read_only",
    configured: true,
    state: "available",
    appName: "Sonarr",
    version: "5.0.0.0",
    transportSecurity: "https",
    isDocker: true,
    responseBytes: new TextEncoder().encode(upstreamBody).byteLength,
    latencyMs: 25,
    observedAt: "1970-01-01T00:00:01.025Z",
  });
  assert.doesNotMatch(
    output,
    /synthetic-api-key|private instance|startup|app-data|urlBase|database|example\.invalid/iu,
  );
});

test("PEG-PROBE-002 probe exit states stay distinct and configuration failures are redacted", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-probe-errors-"));
  context.after(async () => rm(directory, { recursive: true }));
  const secretPath = join(directory, "sonarr-api-key");
  await writeFile(secretPath, "synthetic-api-key-value", { mode: 0o600 });
  const outputs: string[] = [];
  const disabledExit = await runSonarrProbe({
    environment: {},
    write: (value) => outputs.push(value),
  });
  const invalidExit = await runSonarrProbe({
    environment: { PEGARR_SONARR_API_KEY: "synthetic-direct-secret" },
    write: (value) => outputs.push(value),
  });
  const unavailableExit = await runSonarrProbe({
    environment: {
      PEGARR_SONARR_URL: "https://sonarr.example.invalid",
      PEGARR_SONARR_ALLOWED_HOSTS: "sonarr.example.invalid",
      PEGARR_SONARR_API_KEY_FILE: secretPath,
    },
    fetchImplementation: async () =>
      new Response("private unauthorized response", { status: 401 }),
    now: () => 1_000,
    write: (value) => outputs.push(value),
  });

  assert.equal(disabledExit, 2);
  assert.equal(invalidExit, 2);
  assert.equal(unavailableExit, 1);
  assert.equal((JSON.parse(outputs[0] ?? "{}") as { state?: string }).state, "disabled");
  assert.equal(
    (JSON.parse(outputs[1] ?? "{}") as { state?: string }).state,
    "invalid_configuration",
  );
  assert.equal((JSON.parse(outputs[2] ?? "{}") as { state?: string }).state, "unauthorized");
  assert.doesNotMatch(
    outputs.join(""),
    /synthetic-direct-secret|API_KEY_FILE|private unauthorized|example\.invalid/iu,
  );
});
