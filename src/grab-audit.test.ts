import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GrabAuditStore } from "./grab-audit.js";

test("PEG-GRAB-005 Grab audit persists bounded outcomes without Arr handles or credentials", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-grab-audit-"));
  context.after(async () => rm(directory, { recursive: true }));
  const path = join(directory, "audit.sqlite");
  const store = new GrabAuditStore(path);
  store.begin({
    eventId: "event_00000001",
    idempotencyKey: "idempotency_00000001",
    selection: { application: "sonarr", kind: "episode", itemId: 305 },
    targetLabel: "Synthetic Show S03E05 · Synthetic Episode Five",
    releaseId: "sonarr-0123456789abcdef01234567",
    releaseTitle: "Synthetic.Show.S03E05.1080p.WEB-DL-GROUP",
    requestedAtMs: 1_000,
  });
  const completed = store.complete("idempotency_00000001", "grabbed", "arr_accepted_grab", 1_025);
  assert.equal(completed.status, "grabbed");
  assert.equal(completed.completedAt, "1970-01-01T00:00:01.025Z");
  assert.equal(store.recentBlocking(
    { application: "sonarr", kind: "episode", itemId: 305 },
    "sonarr-0123456789abcdef01234567",
    0,
  )?.eventId, "event_00000001");
  store.close();

  const reopened = new GrabAuditStore(path);
  assert.equal(reopened.list()[0]?.status, "grabbed");
  assert.doesNotMatch(
    JSON.stringify(reopened.list()),
    /guid|indexerId|api.?key|authorization|synthetic-secret/iu,
  );
  assert.throws(() => reopened.begin({
    eventId: "event_00000002",
    idempotencyKey: "idempotency_00000001",
    selection: { application: "sonarr", kind: "episode", itemId: 305 },
    targetLabel: "Synthetic Show",
    releaseId: "sonarr-0123456789abcdef01234567",
    releaseTitle: "Synthetic release",
    requestedAtMs: 2_000,
  }));
  reopened.close();
});

test("PEG-GRAB-006 interrupted mutations recover as unknown and require reconciliation", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-grab-recovery-"));
  context.after(async () => rm(directory, { recursive: true }));
  const path = join(directory, "audit.sqlite");
  const initial = new GrabAuditStore(path, () => 1_000);
  initial.begin({
    eventId: "event_00000003",
    idempotencyKey: "idempotency_00000003",
    selection: { application: "radarr", kind: "movie", itemId: 84 },
    targetLabel: "Synthetic Movie (2024)",
    releaseId: "radarr-0123456789abcdef01234567",
    releaseTitle: "Synthetic.Movie.2024.1080p.WEB-DL-GROUP",
    requestedAtMs: 1_010,
  });
  initial.close();

  const recovered = new GrabAuditStore(path, () => 2_000);
  const event = recovered.byIdempotencyKey("idempotency_00000003");
  assert.equal(event?.status, "timeout_unknown");
  assert.equal(event?.detailCode, "process_restart_reconciliation_required");
  assert.equal(event?.completedAt, "1970-01-01T00:00:02.000Z");
  assert.equal(recovered.recentBlocking(
    { application: "radarr", kind: "movie", itemId: 84 },
    "radarr-0123456789abcdef01234567",
    0,
  )?.status, "timeout_unknown");
  recovered.close();
});
