import assert from "node:assert/strict";
import test from "node:test";

import { SessionStore } from "./session-store.js";

test("PEG-SESSION-001 sessions are opaque, bounded, expiring, and mutation-bound to a separate CSRF token", () => {
  let now = 1_000;
  let sequence = 0;
  const store = new SessionStore({
    now: () => now,
    ttlMs: 60_000,
    maxSessions: 2,
    randomToken: () => `synthetic_${String(++sequence).padStart(32, "0")}`,
  });

  const first = store.create();
  const second = store.create();
  assert.equal(store.authenticate(first.token), true);
  assert.equal(store.authorizeMutation(first.token, first.csrfToken), true);
  assert.equal(store.authorizeMutation(first.token, second.csrfToken), false);
  assert.equal(store.authorizeMutation(first.csrfToken, first.csrfToken), false);
  assert.equal(first.expiresAt, "1970-01-01T00:01:01.000Z");
  const refreshed = store.refresh(first.token);
  assert.ok(refreshed);
  assert.equal(refreshed.expiresAt, first.expiresAt);
  assert.equal(store.authorizeMutation(first.token, first.csrfToken), false);
  assert.equal(store.authorizeMutation(first.token, refreshed.csrfToken), true);

  const third = store.create();
  assert.equal(store.authenticate(first.token), false);
  assert.equal(store.authenticate(second.token), true);
  assert.equal(store.authenticate(third.token), true);
  store.destroy(second.token);
  assert.equal(store.authenticate(second.token), false);

  now = 61_000;
  assert.equal(store.authenticate(third.token), false);
  assert.throws(() => new SessionStore({ ttlMs: 59_999 }), /ttlMs/u);
  assert.throws(() => new SessionStore({ maxSessions: 0 }), /maxSessions/u);
});
