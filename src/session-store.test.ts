import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  store.close();
  assert.throws(() => new SessionStore({ ttlMs: 59_999 }), /ttlMs/u);
  assert.throws(() => new SessionStore({ maxSessions: 0 }), /maxSessions/u);
  assert.throws(() => new SessionStore({ databasePath: "relative.sqlite" }), /absolute/u);
});

test("PEG-SESSION-004 hashed sessions survive a store restart without extending expiry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-sessions-"));
  const databasePath = join(directory, "sessions.sqlite");
  let now = 1_000;
  let sequence = 0;
  const randomToken = () => `persistent_${String(++sequence).padStart(40, "0")}`;

  try {
    const firstStore = new SessionStore({ databasePath, now: () => now, ttlMs: 60_000, randomToken });
    const created = firstStore.create();
    firstStore.close();

    const reopenedStore = new SessionStore({ databasePath, now: () => now, ttlMs: 60_000, randomToken });
    assert.equal(reopenedStore.authenticate(created.token), true);
    assert.equal(reopenedStore.authorizeMutation(created.token, created.csrfToken), true);
    const refreshed = reopenedStore.refresh(created.token);
    assert.ok(refreshed);
    assert.equal(refreshed.expiresAt, created.expiresAt);
    assert.equal(reopenedStore.authorizeMutation(created.token, created.csrfToken), false);
    assert.equal(reopenedStore.authorizeMutation(created.token, refreshed.csrfToken), true);
    reopenedStore.close();

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare("SELECT session_digest, csrf_digest, expires_at_ms FROM sessions").get() as {
      readonly session_digest: string;
      readonly csrf_digest: Uint8Array;
      readonly expires_at_ms: number;
    };
    database.close();
    assert.equal(row.session_digest, createHash("sha256").update(created.token).digest("hex"));
    assert.equal(row.csrf_digest.byteLength, 32);
    assert.equal(row.expires_at_ms, 61_000);
    assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
    const persistedBytes = (await readFile(databasePath)).toString("latin1");
    assert.equal(persistedBytes.includes(created.token), false);
    assert.equal(persistedBytes.includes(created.csrfToken), false);
    assert.equal(persistedBytes.includes(refreshed.csrfToken), false);

    now = 61_000;
    const expiredStore = new SessionStore({ databasePath, now: () => now, ttlMs: 60_000, randomToken });
    assert.equal(expiredStore.authenticate(created.token), false);
    expiredStore.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
