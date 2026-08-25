import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import type { FeasibilityReport } from "./domain.js";
import { healthResponse, readinessResponse, resolveRoute } from "./app.js";

test("PEG-OPS-001 liveness is healthy", () => {
  assert.deepEqual(healthResponse(), {
    statusCode: 200,
    body: { service: "pegarr", status: "ok" },
  });
});

test("PEG-OPS-002 readiness requires an accessible data directory", async () => {
  assert.equal((await readinessResponse(tmpdir())).statusCode, 200);
  assert.equal(
    (await readinessResponse(`${tmpdir()}/pegarr-directory-that-does-not-exist`)).statusCode,
    503,
  );
});

test("PEG-API-001 health routes reject mutations", async () => {
  const result = await resolveRoute("POST", "/health", tmpdir());

  assert.equal(result.statusCode, 405);
  assert.deepEqual(result.headers, { allow: "GET" });
});

test("PEG-API-002 fixture-backed feasibility route is read-only and explainable", async () => {
  const result = await resolveRoute("GET", "/api/v1/feasibility/demo", tmpdir());
  const report = result.body as FeasibilityReport;

  assert.equal(result.statusCode, 200);
  assert.equal(report.mode, "read_only");
  assert.equal(report.fixture, "synthetic-sonarr-episode-v1");
  assert.equal(report.releases[0]?.video.evidence.application, "sonarr");
  assert.equal(report.releases[0]?.subtitle.languages[0]?.evidence?.reasons[0], "Exact normalized release name");
  assert.doesNotMatch(JSON.stringify(report), /synthetic-guid|downloadUrl|magnetUrl/iu);
  assert.equal((await resolveRoute("POST", "/api/v1/feasibility/demo", tmpdir())).statusCode, 405);
});

test("PEG-API-003 unknown routes return a generic response", async () => {
  const result = await resolveRoute("GET", "/does-not-exist?token=secret", tmpdir());

  assert.deepEqual(result, {
    statusCode: 404,
    body: { service: "pegarr", status: "not_found" },
  });
});

test("PEG-RUNTIME-002 Sonarr status is read-only and disabled without configuration", async () => {
  const result = await resolveRoute(
    "GET",
    "/api/v1/integrations/sonarr/status",
    tmpdir(),
  );
  assert.deepEqual(result, {
    statusCode: 200,
    body: {
      service: "pegarr",
      integration: "sonarr",
      mode: "read_only",
      configured: false,
      state: "disabled",
    },
  });
  assert.equal(
    (await resolveRoute("POST", "/api/v1/integrations/sonarr/status", tmpdir())).statusCode,
    405,
  );
});
