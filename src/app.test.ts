import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import type { FeasibilityReport } from "./domain.js";
import { AccessControl } from "./access-control.js";
import { SecretValue } from "./config.js";
import { healthResponse, readinessResponse, resolveRoute } from "./app.js";
import type { RuntimeServices } from "./runtime.js";

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

test("PEG-RUNTIME-007 Radarr status is read-only and disabled without configuration", async () => {
  const result = await resolveRoute(
    "GET",
    "/api/v1/integrations/radarr/status",
    tmpdir(),
  );
  assert.deepEqual(result, {
    statusCode: 200,
    body: {
      service: "pegarr",
      integration: "radarr",
      mode: "read_only",
      configured: false,
      state: "disabled",
    },
  });
  assert.equal(
    (await resolveRoute("POST", "/api/v1/integrations/radarr/status", tmpdir())).statusCode,
    405,
  );
});

test("PEG-ACCESS-002 protected inventory stays hidden or unauthorized without upstream work", async () => {
  let inventoryReads = 0;
  const services = fakeServices(async () => {
    inventoryReads += 1;
    return { kind: "missing-item-inventory", mode: "read_only", status: "disabled" };
  });
  const unconfigured = await resolveRoute(
    "GET",
    "/api/v1/library/missing?token=unsafe",
    tmpdir(),
    services,
    { control: new AccessControl(undefined) },
  );
  assert.deepEqual(unconfigured, {
    statusCode: 404,
    body: { service: "pegarr", status: "not_found" },
  });
  assert.equal(
    (await resolveRoute(
      "POST",
      "/api/v1/library/missing",
      tmpdir(),
      services,
      { control: new AccessControl(undefined) },
    )).statusCode,
    404,
  );

  const access = new AccessControl(new SecretValue("synthetic-access-token-value-0000000001"));
  const unauthorized = await resolveRoute(
    "GET",
    "/api/v1/library/missing",
    tmpdir(),
    services,
    { control: access, authorization: "Bearer wrong-token-value-000000000000000" },
  );
  assert.equal(unauthorized.statusCode, 401);
  assert.deepEqual(unauthorized.headers, {
    "www-authenticate": 'Bearer realm="pegarr", charset="UTF-8"',
  });
  assert.equal(inventoryReads, 0);
  assert.doesNotMatch(JSON.stringify([unconfigured, unauthorized]), /unsafe|wrong-token/iu);
});

test("PEG-ACCESS-003 authorized inventory is read-only and rejects mutation methods", async () => {
  const token = "synthetic-access-token-value-0000000001";
  let inventoryReads = 0;
  const services = fakeServices(async () => {
    inventoryReads += 1;
    return { kind: "missing-item-inventory", mode: "read_only", status: "disabled" };
  });
  const access = { control: new AccessControl(new SecretValue(token)), authorization: `Bearer ${token}` };
  const response = await resolveRoute(
    "GET",
    "/api/v1/library/missing",
    tmpdir(),
    services,
    access,
  );
  const mutation = await resolveRoute(
    "POST",
    "/api/v1/library/missing",
    tmpdir(),
    services,
    access,
  );

  assert.deepEqual(response, {
    statusCode: 200,
    body: { kind: "missing-item-inventory", mode: "read_only", status: "disabled" },
  });
  assert.equal(mutation.statusCode, 405);
  assert.equal(inventoryReads, 1);
});

test("PEG-DASH-003 dashboard routes are accessible, responsive, and secret-safe", async () => {
  const page = await resolveRoute("GET", "/", tmpdir());
  const client = await resolveRoute("GET", "/assets/dashboard.js", tmpdir());
  const model = await resolveRoute("GET", "/assets/dashboard-model.js", tmpdir());
  const styles = await resolveRoute("GET", "/assets/dashboard.css", tmpdir());

  assert.equal(page.statusCode, 200);
  assert.equal(page.headers?.["content-type"], "text/html; charset=utf-8");
  assert.match(page.headers?.["content-security-policy"] ?? "", /default-src 'self'/u);
  assert.match(String(page.body), /<main id="main"|role="status"|aria-live="polite"/u);
  assert.match(String(page.body), /type="password"|autocomplete="off"/u);
  assert.match(String(styles.body), /@media \(max-width: 760px\)|prefers-reduced-motion/u);
  assert.match(String(client.body), /authorization: `Bearer \$\{accessToken\}`|credentials: "omit"/u);
  assert.match(String(client.body), /textContent|replaceChildren/u);
  assert.match(String(model.body), /export function selectRows/u);
  assert.doesNotMatch(
    [page.body, client.body, model.body, styles.body].join("\n"),
    /localStor(?:age)|sessionStor(?:age)|document\.cookie|innerHTML|PEGARR_ACCESS_TOKEN/iu,
  );
  assert.equal((await resolveRoute("POST", "/", tmpdir())).statusCode, 405);
});

function fakeServices(
  readMissingInventory: RuntimeServices["readMissingInventory"],
): RuntimeServices {
  return {
    readSonarrStatus: async () => ({
      integration: "sonarr",
      mode: "read_only",
      configured: false,
      state: "disabled",
    }),
    readRadarrStatus: async () => ({
      integration: "radarr",
      mode: "read_only",
      configured: false,
      state: "disabled",
    }),
    readMissingInventory,
  };
}
