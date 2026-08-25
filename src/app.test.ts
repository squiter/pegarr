import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import { healthResponse, readinessResponse, resolveRoute } from "./app.js";

test("liveness is healthy", () => {
  assert.deepEqual(healthResponse(), {
    statusCode: 200,
    body: { service: "pegarr", status: "ok" },
  });
});

test("readiness requires an accessible data directory", async () => {
  assert.equal((await readinessResponse(tmpdir())).statusCode, 200);
  assert.equal(
    (await readinessResponse(`${tmpdir()}/pegarr-directory-that-does-not-exist`)).statusCode,
    503,
  );
});

test("health routes reject mutations", async () => {
  const result = await resolveRoute("POST", "/health", tmpdir());

  assert.equal(result.statusCode, 405);
  assert.deepEqual(result.headers, { allow: "GET" });
});

test("unknown routes return a generic response", async () => {
  const result = await resolveRoute("GET", "/does-not-exist?token=secret", tmpdir());

  assert.deepEqual(result, {
    statusCode: 404,
    body: { service: "pegarr", status: "not_found" },
  });
});
