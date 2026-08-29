import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  assert.equal(recovered.recentBlocking(
    { application: "radarr", kind: "movie", itemId: 84 },
    "radarr-0123456789abcdef01234567",
    1_000_000,
  )?.status, "timeout_unknown");
  recovered.close();
});

test("PEG-GRAB-007 reconciliation migrates durably and releases duplicates only when Arr did not Grab", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-grab-reconciliation-"));
  context.after(async () => rm(directory, { recursive: true }));
  const path = join(directory, "audit.sqlite");
  const selection = { application: "sonarr", kind: "episode", itemId: 305 } as const;
  const releaseId = "sonarr-0123456789abcdef01234567";
  const current = new GrabAuditStore(path);
  current.close();
  const legacy = new DatabaseSync(path);
  legacy.exec("ALTER TABLE grab_audit DROP COLUMN reconciled_at_ms; ALTER TABLE grab_audit DROP COLUMN reconciliation_outcome");
  legacy.close();
  const store = new GrabAuditStore(path);

  const recordUnknown = (suffix: "04" | "05", requestedAt: number) => {
    store.begin({
      eventId: `event_000000${suffix}`,
      idempotencyKey: `idempotency_000000${suffix}`,
      selection,
      targetLabel: "Synthetic Show S03E05 · Synthetic Episode Five",
      releaseId,
      releaseTitle: "Synthetic.Show.S03E05.1080p.WEB-DL-GROUP",
      requestedAtMs: requestedAt,
    });
    store.complete(`idempotency_000000${suffix}`, "timeout_unknown", "reconciliation_required", requestedAt + 10);
  };

  recordUnknown("04", 4_000);
  const notGrabbed = store.reconcile("event_00000004", "not_grabbed", 4_100);
  assert.equal(notGrabbed.status, "timeout_unknown");
  assert.equal(notGrabbed.reconciliationOutcome, "not_grabbed");
  assert.equal(notGrabbed.reconciledAt, "1970-01-01T00:00:04.100Z");
  assert.throws(() => store.reconcile("event_00000004", "grabbed", 4_200));
  assert.equal(store.recentBlocking(selection, releaseId, 0), undefined);
  recordUnknown("05", 5_000);
  const grabbed = store.reconcile("event_00000005", "grabbed", 5_100);
  assert.equal(grabbed.reconciliationOutcome, "grabbed");
  assert.equal(store.recentBlocking(selection, releaseId, 4_500)?.eventId, "event_00000005");
  assert.equal(store.recentBlocking(selection, releaseId, 5_050)?.eventId, "event_00000005");
  assert.equal(store.recentBlocking(selection, releaseId, 0)?.reconciliationOutcome, "grabbed");
  store.close();

  const reopened = new GrabAuditStore(path);
  assert.equal(reopened.byEventId("event_00000004")?.reconciliationOutcome, "not_grabbed");
  assert.equal(reopened.byEventId("event_00000005")?.reconciliationOutcome, "grabbed");
  reopened.close();
});

test("PEG-INSTANCE-003 duplicate protection is isolated by Arr instance", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-grab-instance-"));
  context.after(async () => rm(directory, { recursive: true }));
  const store = new GrabAuditStore(join(directory, "audit.sqlite"));
  const main = { application: "sonarr", instanceId: "sonarr-main", kind: "episode", itemId: 305 } as const;
  const anime = { application: "sonarr", instanceId: "sonarr-anime", kind: "episode", itemId: 305 } as const;
  const releaseId = "sonarr-0123456789abcdef01234567";
  store.begin({
    eventId: "event_instance_0001",
    idempotencyKey: "idempotency_instance_0001",
    selection: main,
    targetLabel: "Synthetic Show S03E05",
    releaseId,
    releaseTitle: "Synthetic.Show.S03E05.1080p.WEB-DL-GROUP",
    requestedAtMs: 1_000,
  });
  const completed = store.complete("idempotency_instance_0001", "grabbed", "arr_accepted_grab", 1_010);

  assert.equal(completed.instanceId, "sonarr-main");
  assert.equal(store.recentBlocking(main, releaseId, 0)?.eventId, "event_instance_0001");
  assert.equal(store.recentBlocking(anime, releaseId, 0), undefined);
  store.close();
});

test("PEG-GRAB-010 legacy audit schema migrates before season-pack identities are recorded", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-grab-season-migration-"));
  context.after(async () => rm(directory, { recursive: true }));
  const path = join(directory, "audit.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE grab_audit (
      event_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      application TEXT NOT NULL CHECK (application IN ('sonarr', 'radarr')),
      kind TEXT NOT NULL CHECK (kind IN ('episode', 'movie')),
      item_id INTEGER NOT NULL CHECK (item_id > 0),
      target_label TEXT NOT NULL,
      release_id TEXT NOT NULL,
      release_title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'grabbed', 'revalidation_failed', 'timeout_unknown', 'upstream_failure')),
      detail_code TEXT,
      requested_at_ms INTEGER NOT NULL CHECK (requested_at_ms >= 0),
      completed_at_ms INTEGER
    ) STRICT;
    INSERT INTO grab_audit VALUES (
      'event_legacy_0001', 'idempotency_legacy_0001', 'sonarr', 'episode', 305,
      'Synthetic Show S03E05', 'sonarr-0123456789abcdef01234567',
      'Synthetic.Show.S03E05.1080p', 'grabbed', 'arr_accepted_grab', 1000, 1010
    );
  `);
  legacy.close();

  const store = new GrabAuditStore(path);
  assert.equal(store.byEventId("event_legacy_0001")?.instanceId, "sonarr");
  const season = store.begin({
    eventId: "event_season_0001",
    idempotencyKey: "idempotency_season_0001",
    selection: { application: "sonarr", instanceId: "sonarr-main", kind: "season", itemId: 91, seasonNumber: 3 },
    targetLabel: "Synthetic Show Season 3",
    releaseId: "sonarr-fedcba9876543210fedcba98",
    releaseTitle: "Synthetic.Show.S03.1080p",
    requestedAtMs: 2_000,
  });
  assert.equal(season.kind, "season");
  assert.equal(season.seasonNumber, 3);
  assert.equal(store.recentBlocking(
    { application: "sonarr", instanceId: "sonarr-main", kind: "season", itemId: 91, seasonNumber: 3 },
    "sonarr-fedcba9876543210fedcba98",
    0,
  )?.eventId, "event_season_0001");
  store.close();
});
