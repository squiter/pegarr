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

test("PEG-ACCESS-005 username and password login is bounded and constant-time comparable", () => {
  const username = "pegarr-user";
  const password = "synthetic-password-value-00000000001";
  const access = new AccessControl(undefined, { username, password: new SecretValue(password) });
  const basic = (candidateUsername: string, candidatePassword: string) =>
    `Basic ${Buffer.from(`${candidateUsername}:${candidatePassword}`, "utf8").toString("base64")}`;

  assert.equal(access.configured, true);
  assert.equal(access.challenge, 'Basic realm="pegarr", charset="UTF-8"');
  assert.equal(access.authorize(basic(username, password)), true);
  assert.equal(access.authorize(basic("wrong-user", password)), false);
  assert.equal(access.authorize(basic(username, "wrong-password-value-000000000000")), false);
  assert.equal(access.authorize("Basic not-base64!"), false);
  assert.equal(access.authorize(`Basic ${"a".repeat(8_201)}`), false);
});
