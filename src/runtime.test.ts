import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveRoute } from "./app.js";
import { loadRuntimeConfiguration, SecretValue } from "./config.js";
import { syntheticSonarrSystemStatusResponse } from "./fixtures/sonarr-system-status.js";
import { syntheticRadarrSystemStatusResponse } from "./fixtures/radarr-system-status.js";
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
  const upstreamBody = JSON.stringify(syntheticSonarrSystemStatusResponse);
  const clock = [1_000, 1_025];
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input, init) => {
      capturedUrl = new URL(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    now: () => clock.shift() ?? 1_025,
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
      transportSecurity: "https",
      isDocker: true,
      responseBytes: new TextEncoder().encode(upstreamBody).byteLength,
      latencyMs: 25,
      observedAt: "1970-01-01T00:00:01.025Z",
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

test("PEG-RUNTIME-004 concurrent and repeated status reads use one bounded probe window", async () => {
  const configuration = {
    sonarr: {
      instanceId: "synthetic-sonarr",
      baseUrl: "https://sonarr.example.invalid",
      allowedHosts: ["sonarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-api-key-value"),
    },
  };
  let currentTime = 1_000;
  let requestCount = 0;
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async () => {
      requestCount += 1;
      await Promise.resolve();
      return new Response(JSON.stringify(syntheticSonarrSystemStatusResponse), { status: 200 });
    },
    now: () => currentTime,
    sonarrStatusTtlMs: 30_000,
  });

  const [first, concurrent] = await Promise.all([
    services.readSonarrStatus(),
    services.readSonarrStatus(),
  ]);
  const cached = await services.readSonarrStatus();
  assert.equal(requestCount, 1);
  assert.deepEqual(concurrent, first);
  assert.deepEqual(cached, first);

  currentTime += 30_001;
  const refreshed = await services.readSonarrStatus();
  assert.equal(requestCount, 2);
  assert.equal(refreshed.state, "available");
});

test("PEG-RUNTIME-005 configured Radarr status returns measured browser-safe evidence", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-radarr-runtime-"));
  context.after(async () => rm(directory, { recursive: true }));
  const secretPath = join(directory, "radarr-api-key");
  const secret = "synthetic-radarr-key-value";
  await writeFile(secretPath, secret, { mode: 0o600 });
  const configuration = await loadRuntimeConfiguration({
    PEGARR_RADARR_URL: "https://radarr.example.invalid/root",
    PEGARR_RADARR_ALLOWED_HOSTS: "radarr.example.invalid",
    PEGARR_RADARR_API_KEY_FILE: secretPath,
    PEGARR_RADARR_INSTANCE_ID: "synthetic-radarr",
  });

  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  const upstreamBody = JSON.stringify(syntheticRadarrSystemStatusResponse);
  const clock = [2_000, 2_041];
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async (input, init) => {
      capturedUrl = new URL(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    now: () => clock.shift() ?? 2_041,
  });
  const response = await resolveRoute(
    "GET",
    "/api/v1/integrations/radarr/status",
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
    },
  });
  assert.doesNotMatch(
    serialized,
    /synthetic-radarr-key|private movie|startup|app-data|urlBase|database|example\.invalid/iu,
  );
});

test("PEG-RUNTIME-006 Radarr failures and refreshes stay classified and bounded", async () => {
  const configuration = {
    radarr: {
      instanceId: "synthetic-radarr",
      baseUrl: "https://radarr.example.invalid",
      allowedHosts: ["radarr.example.invalid"],
      allowInsecureHttp: false,
      apiKey: new SecretValue("synthetic-radarr-key-value"),
    },
  };
  let currentTime = 2_000;
  let requestCount = 0;
  let response = new Response("private outage response", { status: 503 });
  const services = createRuntimeServices(configuration, {
    fetchImplementation: async () => {
      requestCount += 1;
      await Promise.resolve();
      return response.clone();
    },
    now: () => currentTime,
    radarrStatusTtlMs: 30_000,
  });

  const [failed, concurrent] = await Promise.all([
    services.readRadarrStatus(),
    services.readRadarrStatus(),
  ]);
  assert.equal(requestCount, 1);
  assert.equal(failed.state, "unavailable");
  assert.deepEqual(concurrent, failed);
  assert.doesNotMatch(JSON.stringify(failed), /private|synthetic-radarr-key|example\.invalid/iu);

  response = new Response(JSON.stringify(syntheticRadarrSystemStatusResponse), { status: 200 });
  currentTime += 30_001;
  const refreshed = await services.readRadarrStatus();
  assert.equal(requestCount, 2);
  assert.equal(refreshed.state, "available");
});
