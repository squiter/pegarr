import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveRoute } from "./app.js";
import { loadRuntimeConfiguration, SecretValue } from "./config.js";
import { syntheticSonarrSystemStatusResponse } from "./fixtures/sonarr-system-status.js";
import { createRuntimeServices } from "./runtime.js";

test("PEG-RUNTIME-001 configured Sonarr status returns only safe read-only evidence", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-runtime-"));
  context.after(async () => rm(directory, { recursive: true }));
  const secretPath = join(directory, "sonarr-api-key");
  const secret = "synthetic-api-key-value";
  await writeFile(secretPath, secret, { mode: 0o600 });
  const configuration = await loadRuntimeConfiguration({
    PEGARR_SONARR_URL: "https://sonarr.example.invalid/root",
    PEGARR_SONARR_ALLOWED_HOSTS: "sonarr.example.invalid",
    PEGARR_SONARR_API_KEY_FILE: secretPath,
    PEGARR_SONARR_INSTANCE_ID: "synthetic-sonarr",
  });

  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input, init) => {
      capturedUrl = new URL(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify(syntheticSonarrSystemStatusResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const response = await resolveRoute(
    "GET",
    "/api/v1/integrations/sonarr/status",
    tmpdir(),
    services,
  );
  const serialized = JSON.stringify(response);

  assert.equal(capturedUrl?.pathname, "/root/api/v3/system/status");
  assert.equal(capturedUrl?.search, "");
  assert.equal(capturedHeaders?.get("x-api-key"), secret);
  assert.deepEqual(response, {
    statusCode: 200,
    body: {
      service: "pegarr",
      integration: "sonarr",
      mode: "read_only",
      configured: true,
      state: "available",
      appName: "Sonarr",
      version: "5.0.0.0",
      isDocker: true,
    },
  });
  assert.doesNotMatch(
    serialized,
    /synthetic-api-key|private instance|startup|app-data|urlBase|database|example\.invalid/iu,
  );
});

test("PEG-RUNTIME-003 upstream failures remain distinct and redact private details", async () => {
  const configuration = {
    sonarr: {
      instanceId: "synthetic-sonarr",
      baseUrl: "https://sonarr.example.invalid",
      allowedHosts: ["sonarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-api-key-value"),
    },
  };
  const cases = [
    { response: new Response("private unauthorized response", { status: 401 }), state: "unauthorized" },
    { response: new Response("private outage response", { status: 503 }), state: "unavailable" },
    { response: new Response("not-json", { status: 200 }), state: "invalid_response" },
  ] as const;

  for (const testCase of cases) {
    const services = createRuntimeServices(configuration, {
      fetchImplementation: async () => testCase.response.clone(),
    });
    const status = await services.readSonarrStatus();

    assert.equal(status.configured, true);
    assert.equal(status.state, testCase.state);
    assert.doesNotMatch(JSON.stringify(status), /private|synthetic-api-key|example\.invalid/iu);
  }
});
