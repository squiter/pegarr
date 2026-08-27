import assert from "node:assert/strict";
import test from "node:test";

import { AccessControl } from "./access-control.js";
import { SecretValue } from "./config.js";

const token = "synthetic-access-token-value-0000000001";

test("PEG-ACCESS-001 bearer authentication uses one bounded in-memory token", () => {
  const access = new AccessControl(new SecretValue(token));

  assert.equal(access.configured, true);
  assert.equal(access.authorize(`Bearer ${token}`), true);
  assert.equal(access.authorize(`bearer ${token}`), true);
  assert.equal(access.authorize(undefined), false);
  assert.equal(access.authorize("Basic synthetic"), false);
  assert.equal(access.authorize("Bearer synthetic-access-token-value-0000000002"), false);
  assert.equal(access.authorize(`Bearer ${"x".repeat(4_097)}`), false);
  assert.equal(new AccessControl(undefined).configured, false);
});
