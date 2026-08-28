import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ControlledGrabService, type ControlledGrabSource } from "./controlled-grab.js";
import type { ArrReleaseCandidate, RevalidatedArrRelease } from "./domain.js";
import { GrabAuditStore } from "./grab-audit.js";

const selection = { application: "sonarr", kind: "episode", itemId: 305 } as const;
const releaseId = "sonarr-0123456789abcdef01234567";
const candidate: ArrReleaseCandidate = {
  id: releaseId,
  title: "Synthetic.Show.S03E05.1080p.WEB-DL-GROUP",
  downloadAllowed: true,
  rejectionReasons: [],
  customFormatScore: 100,
  evidence: {
    application: "sonarr",
    instanceId: "sonarr",
    indexer: "Synthetic Indexer",
    protocol: "torrent",
    languages: ["English"],
    customFormats: [],
  },
};
const revalidated: RevalidatedArrRelease = {
  candidate,
  handle: { guid: "server-only-guid", indexerId: 11 },
};

async function fixture(context: test.TestContext, source: ControlledGrabSource, clock = [1_000, 1_010, 1_020, 1_030]) {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-controlled-grab-"));
  context.after(async () => rm(directory, { recursive: true }));
  let id = 0;
  return new ControlledGrabService({
    readInventory: async () => ({
      kind: "missing-item-inventory",
      mode: "read_only",
      status: "ready",
      sources: [{
        integration: "sonarr",
        status: "ready",
        page: {
          page: 1,
          pageSize: 1,
          totalRecords: 1,
          items: [{
            application: "sonarr",
            instanceId: "sonarr",
            kind: "episode",
            itemId: 305,
            parentId: 42,
            title: "Synthetic Episode Five",
            parentTitle: "Synthetic Show",
            season: 3,
            episode: 5,
            monitored: true,
            hasFile: false,
            ids: {},
          }],
        },
      }, {
        integration: "radarr",
        status: "disabled",
      }],
      metrics: { requestCount: 1, itemCount: 1, elapsedMs: 1 },
    }),
    sonarr: source,
    audit: new GrabAuditStore(join(directory, "audit.sqlite")),
    now: () => clock.shift() ?? 1_030,
    randomId: () => `synthetic_id_${String(++id).padStart(8, "0")}`,
  });
}

test("PEG-GRAB-001 preparation revalidates and requires the exact target and release", async (context) => {
  let revalidations = 0;
  const service = await fixture(context, {
    revalidate: async () => { revalidations += 1; return revalidated; },
    grab: async () => ({ status: "accepted", responseStatus: 200 }),
  });
  context.after(() => service.close());

  const prepared = await service.prepare(selection, releaseId);
  assert.equal(prepared.status, "confirmation_required");
  assert.equal(revalidations, 1);
  if (prepared.status !== "confirmation_required") return;
  assert.equal(prepared.instanceId, "sonarr");
  assert.equal(
    prepared.confirmation,
    "GRAB Synthetic.Show.S03E05.1080p.WEB-DL-GROUP FOR Synthetic Show S03E05 · Synthetic Episode Five",
  );
  assert.doesNotMatch(JSON.stringify(prepared), /server-only-guid|indexerId/iu);

  const rejectedService = await fixture(context, {
    revalidate: async () => ({ ...revalidated, candidate: { ...candidate, downloadAllowed: false } }),
    grab: async () => { throw new Error("must not run"); },
  });
  context.after(() => rejectedService.close());
  assert.equal((await rejectedService.prepare(selection, releaseId)).status, "release_rejected");
});

test("PEG-GRAB-002 execution revalidates again and performs exactly one confirmed Grab", async (context) => {
  let revalidations = 0;
  let grabs = 0;
  const service = await fixture(context, {
    revalidate: async () => { revalidations += 1; return revalidated; },
    grab: async (handle) => {
      grabs += 1;
      assert.deepEqual(handle, { guid: "server-only-guid", indexerId: 11 });
      return { status: "accepted", responseStatus: 200 };
    },
  });
  context.after(() => service.close());
  const prepared = await service.prepare(selection, releaseId);
  assert.equal(prepared.status, "confirmation_required");
  if (prepared.status !== "confirmation_required") return;

  const mismatch = await service.execute(selection, prepared.challengeId, "not exact", "idempotency_00000001");
  assert.equal(mismatch.status, "confirmation_mismatch");
  assert.equal(grabs, 0);
  const wrongTarget = await service.execute(
    { application: "radarr", kind: "movie", itemId: 305 },
    prepared.challengeId,
    prepared.confirmation,
    "idempotency_wrong_target_0001",
  );
  assert.equal(wrongTarget.status, "confirmation_mismatch");
  assert.equal("detailCode" in wrongTarget && wrongTarget.detailCode, "challenge_target_mismatch");
  assert.equal(grabs, 0);
  const wrongInstance = await service.execute(
    { ...selection, instanceId: "sonarr-anime" },
    prepared.challengeId,
    prepared.confirmation,
    "idempotency_wrong_instance_01",
  );
  assert.equal(wrongInstance.status, "confirmation_mismatch");
  assert.equal("detailCode" in wrongInstance && wrongInstance.detailCode, "challenge_target_mismatch");
  assert.equal(grabs, 0);
  const result = await service.execute(selection, prepared.challengeId, prepared.confirmation, "idempotency_00000001");
  assert.equal(result.status, "grabbed");
  assert.equal(revalidations, 2);
  assert.equal(grabs, 1);
});

test("PEG-GRAB-003 idempotency replay returns the audit outcome without a second mutation", async (context) => {
  let grabs = 0;
  const service = await fixture(context, {
    revalidate: async () => revalidated,
    grab: async () => { grabs += 1; return { status: "accepted", responseStatus: 200 }; },
  });
  context.after(() => service.close());
  const prepared = await service.prepare(selection, releaseId);
  if (prepared.status !== "confirmation_required") return;
  const first = await service.execute(selection, prepared.challengeId, prepared.confirmation, "idempotency_00000002");
  const replay = await service.execute(selection, prepared.challengeId, prepared.confirmation, "idempotency_00000002");
  assert.equal(first.status, "grabbed");
  assert.equal(replay.status, "grabbed");
  assert.equal("replayed" in replay && replay.replayed, true);
  assert.equal(grabs, 1);
  const conflict = await service.execute(
    { application: "radarr", kind: "movie", itemId: 84 },
    prepared.challengeId,
    prepared.confirmation,
    "idempotency_00000002",
  );
  assert.equal(conflict.status, "idempotency_conflict");
  assert.equal(grabs, 1);
});

test("PEG-GRAB-004 timeout stays unknown and blocks a duplicate until reconciliation", async (context) => {
  const timeout = Object.assign(new Error("private timeout"), { code: "timeout" });
  const service = await fixture(context, {
    revalidate: async () => revalidated,
    grab: async () => { throw timeout; },
  });
  context.after(() => service.close());
  const prepared = await service.prepare(selection, releaseId);
  if (prepared.status !== "confirmation_required") return;
  const result = await service.execute(selection, prepared.challengeId, prepared.confirmation, "idempotency_00000003");
  assert.equal(result.status, "timeout_unknown");
  assert.equal("requiresReconciliation" in result && result.requiresReconciliation, true);

  const second = await service.prepare(selection, releaseId);
  if (second.status !== "confirmation_required") return;
  const blocked = await service.execute(selection, second.challengeId, second.confirmation, "idempotency_00000004");
  assert.equal(blocked.status, "duplicate_blocked");
  assert.equal("detailCode" in blocked && blocked.detailCode, "reconciliation_required");
});

test("PEG-GRAB-008 exact operator reconciliation releases only a confirmed not-grabbed retry", async (context) => {
  const timeout = Object.assign(new Error("private timeout"), { code: "timeout" });
  let grabs = 0;
  const service = await fixture(context, {
    revalidate: async () => revalidated,
    grab: async () => { grabs += 1; throw timeout; },
  }, [1_000, 1_010, 1_020, 1_030, 1_040, 1_050, 1_060]);
  context.after(() => service.close());
  const prepared = await service.prepare(selection, releaseId);
  if (prepared.status !== "confirmation_required") return;
  const unknown = await service.execute(selection, prepared.challengeId, prepared.confirmation, "idempotency_00000008");
  if (unknown.status !== "timeout_unknown") return;
  const confirmations = unknown.event.reconciliationConfirmations;
  assert.ok(confirmations);
  assert.equal(
    confirmations.notGrabbed,
    "RECONCILE Synthetic.Show.S03E05.1080p.WEB-DL-GROUP FOR Synthetic Show S03E05 · Synthetic Episode Five AS NOT GRABBED",
  );
  assert.equal(service.reconcile(unknown.event.eventId, "not_grabbed", "not exact").status, "confirmation_mismatch");
  const reconciled = service.reconcile(unknown.event.eventId, "not_grabbed", confirmations.notGrabbed);
  assert.equal(reconciled.status, "reconciled");
  if (reconciled.status !== "reconciled") return;
  assert.equal(reconciled.event.status, "timeout_unknown");
  assert.equal(reconciled.event.reconciliationOutcome, "not_grabbed");
  assert.equal(reconciled.event.reconciliationConfirmations, undefined);
  assert.equal(service.reconcile(unknown.event.eventId, "grabbed", confirmations.grabbed).status, "not_reconcilable");

  const retry = await service.prepare(selection, releaseId);
  if (retry.status !== "confirmation_required") return;
  const retryResult = await service.execute(selection, retry.challengeId, retry.confirmation, "idempotency_00000009");
  assert.equal(retryResult.status, "timeout_unknown");
  assert.equal(grabs, 2);
});
