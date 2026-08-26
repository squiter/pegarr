import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syntheticRadarrSystemStatusResponse } from "./fixtures/radarr-system-status.js";
import { runRadarrProbe } from "./probe-radarr.js";

test("PEG-PROBE-003 one-shot Radarr probe reports measured safe evidence", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-radarr-probe-"));
  context.after(async () => rm(directory, { recursive: true }));
  const secretPath = join(directory, "radarr-api-key");
  const secret = "synthetic-radarr-key-value";
  await writeFile(secretPath, secret, { mode: 0o600 });
  const upstreamBody = JSON.stringify(syntheticRadarrSystemStatusResponse);
  const clock = [2_000, 2_041];
  let output = "";

  const exitCode = await runRadarrProbe({
    environment: {
      PEGARR_RADARR_URL: "https://radarr.example.invalid/root",
      PEGARR_RADARR_ALLOWED_HOSTS: "radarr.example.invalid",
      PEGARR_RADARR_API_KEY_FILE: secretPath,
    },
    fetchImplementation: async () =>
      new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    now: () => clock.shift() ?? 2_041,
    write: (value) => {
      output += value;
    },
  });
  const report = JSON.parse(output) as Record<string, unknown>;

  assert.equal(exitCode, 0);
  assert.deepEqual(report, {
    probe: "radarr-status",
    integration: "radarr",
    mode: "read_only",
    configured: true,
    state: "available",
    appName: "Radarr",
    version: "6.0.0.0",
    transportSecurity: "https",
    isDocker: true,
    responseBytes: new TextEncoder().encode(upstreamBody).byteLength,
    latencyMs: 41,
    observedAt: "1970-01-01T00:00:02.041Z",
  });
  assert.doesNotMatch(
    output,
    /synthetic-radarr-key|private movie|startup|app-data|urlBase|database|example\.invalid/iu,
  );
});

test("PEG-PROBE-004 Radarr probe exit states stay distinct and redacted", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-radarr-probe-errors-"));
  context.after(async () => rm(directory, { recursive: true }));
  const secretPath = join(directory, "radarr-api-key");
  await writeFile(secretPath, "synthetic-radarr-key-value", { mode: 0o600 });
  const outputs: string[] = [];
  const disabledExit = await runRadarrProbe({
    environment: {},
    write: (value) => outputs.push(value),
  });
  const invalidExit = await runRadarrProbe({
    environment: { PEGARR_RADARR_API_KEY: "synthetic-direct-radarr-secret" },
    write: (value) => outputs.push(value),
  });
  const unavailableExit = await runRadarrProbe({
    environment: {
      PEGARR_RADARR_URL: "https://radarr.example.invalid",
      PEGARR_RADARR_ALLOWED_HOSTS: "radarr.example.invalid",
      PEGARR_RADARR_API_KEY_FILE: secretPath,
    },
    fetchImplementation: async () => new Response("private unauthorized response", { status: 401 }),
    now: () => 2_000,
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
    /synthetic-direct-radarr-secret|API_KEY_FILE|private unauthorized|example\.invalid/iu,
  );
});
