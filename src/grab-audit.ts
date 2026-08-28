import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ItemFeasibilitySelection } from "./item-feasibility.js";

export type GrabAuditStatus =
  | "in_progress"
  | "grabbed"
  | "revalidation_failed"
  | "timeout_unknown"
  | "upstream_failure";

export interface GrabAuditEntry {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly application: "sonarr" | "radarr";
  readonly kind: "episode" | "movie";
  readonly itemId: number;
  readonly targetLabel: string;
  readonly releaseId: string;
  readonly releaseTitle: string;
  readonly status: GrabAuditStatus;
  readonly detailCode?: string;
  readonly requestedAt: string;
  readonly completedAt?: string;
}

export interface BeginGrabAudit {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly selection: ItemFeasibilitySelection;
  readonly targetLabel: string;
  readonly releaseId: string;
  readonly releaseTitle: string;
  readonly requestedAtMs: number;
}

export class GrabAuditStore {
  readonly #database: DatabaseSync;

  constructor(databasePath: string, now: () => number = Date.now) {
    if (!isAbsolute(databasePath)) throw new TypeError("Grab audit database path must be absolute");
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS grab_audit (
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
      CREATE INDEX IF NOT EXISTS grab_audit_target_recent
        ON grab_audit(application, kind, item_id, release_id, requested_at_ms DESC);
      CREATE INDEX IF NOT EXISTS grab_audit_recent
        ON grab_audit(requested_at_ms DESC, event_id DESC);
    `);
    const recoveredAtMs = now();
    safeEpoch(recoveredAtMs, "recoveredAtMs");
    this.#database.prepare(`
      UPDATE grab_audit
      SET status = 'timeout_unknown',
          detail_code = 'process_restart_reconciliation_required',
          completed_at_ms = ?
      WHERE status = 'in_progress'
    `).run(recoveredAtMs);
  }

  begin(entry: BeginGrabAudit): GrabAuditEntry {
    validateBegin(entry);
    this.#database.prepare(`
      INSERT INTO grab_audit(
        event_id, idempotency_key, application, kind, item_id,
        target_label, release_id, release_title, status, requested_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', ?)
    `).run(
      entry.eventId,
      entry.idempotencyKey,
      entry.selection.application,
      entry.selection.kind,
      entry.selection.itemId,
      entry.targetLabel,
      entry.releaseId,
      entry.releaseTitle,
      entry.requestedAtMs,
    );
    return this.#requiredByIdempotencyKey(entry.idempotencyKey);
  }

  complete(
    idempotencyKey: string,
    status: Exclude<GrabAuditStatus, "in_progress">,
    detailCode: string,
    completedAtMs: number,
  ): GrabAuditEntry {
    validateToken(idempotencyKey, "idempotencyKey", 128);
    validateToken(detailCode, "detailCode", 64);
    safeEpoch(completedAtMs, "completedAtMs");
    const result = this.#database.prepare(`
      UPDATE grab_audit
      SET status = ?, detail_code = ?, completed_at_ms = ?
      WHERE idempotency_key = ? AND status = 'in_progress'
    `).run(status, detailCode, completedAtMs, idempotencyKey);
    if (result.changes !== 1) throw new Error("Grab audit transition was not available");
    return this.#requiredByIdempotencyKey(idempotencyKey);
  }

  byIdempotencyKey(idempotencyKey: string): GrabAuditEntry | undefined {
    validateToken(idempotencyKey, "idempotencyKey", 128);
    const row = this.#database.prepare(`
      SELECT * FROM grab_audit WHERE idempotency_key = ?
    `).get(idempotencyKey) as AuditRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  recentBlocking(
    selection: ItemFeasibilitySelection,
    releaseId: string,
    sinceMs: number,
  ): GrabAuditEntry | undefined {
    validateSelection(selection);
    validateToken(releaseId, "releaseId", 64);
    safeEpoch(sinceMs, "sinceMs");
    const row = this.#database.prepare(`
      SELECT * FROM grab_audit
      WHERE application = ? AND kind = ? AND item_id = ? AND release_id = ?
        AND requested_at_ms >= ? AND status IN ('in_progress', 'grabbed', 'timeout_unknown')
      ORDER BY requested_at_ms DESC, event_id DESC
      LIMIT 1
    `).get(selection.application, selection.kind, selection.itemId, releaseId, sinceMs) as AuditRow | undefined;
    return row === undefined ? undefined : mapRow(row);
  }

  list(limit = 50): readonly GrabAuditEntry[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("Grab audit limit must be between 1 and 100");
    const rows = this.#database.prepare(`
      SELECT * FROM grab_audit
      ORDER BY requested_at_ms DESC, event_id DESC
      LIMIT ?
    `).all(limit) as unknown as AuditRow[];
    return rows.map(mapRow);
  }

  close(): void {
    this.#database.close();
  }

  #requiredByIdempotencyKey(idempotencyKey: string): GrabAuditEntry {
    const entry = this.byIdempotencyKey(idempotencyKey);
    if (entry === undefined) throw new Error("Grab audit entry was not persisted");
    return entry;
  }
}

interface AuditRow {
  readonly event_id: string;
  readonly idempotency_key: string;
  readonly application: "sonarr" | "radarr";
  readonly kind: "episode" | "movie";
  readonly item_id: number;
  readonly target_label: string;
  readonly release_id: string;
  readonly release_title: string;
  readonly status: GrabAuditStatus;
  readonly detail_code: string | null;
  readonly requested_at_ms: number;
  readonly completed_at_ms: number | null;
}

function mapRow(row: AuditRow): GrabAuditEntry {
  return {
    eventId: row.event_id,
    idempotencyKey: row.idempotency_key,
    application: row.application,
    kind: row.kind,
    itemId: row.item_id,
    targetLabel: row.target_label,
    releaseId: row.release_id,
    releaseTitle: row.release_title,
    status: row.status,
    ...(row.detail_code === null ? {} : { detailCode: row.detail_code }),
    requestedAt: new Date(row.requested_at_ms).toISOString(),
    ...(row.completed_at_ms === null ? {} : { completedAt: new Date(row.completed_at_ms).toISOString() }),
  };
}

function validateBegin(entry: BeginGrabAudit): void {
  validateToken(entry.eventId, "eventId", 128);
  validateToken(entry.idempotencyKey, "idempotencyKey", 128);
  validateSelection(entry.selection);
  validateText(entry.targetLabel, "targetLabel", 2_048);
  validateToken(entry.releaseId, "releaseId", 64);
  validateText(entry.releaseTitle, "releaseTitle", 4_096);
  safeEpoch(entry.requestedAtMs, "requestedAtMs");
}

function validateSelection(selection: ItemFeasibilitySelection): void {
  if (!Number.isSafeInteger(selection.itemId) || selection.itemId < 1) throw new TypeError("itemId must be positive");
  if ((selection.application === "sonarr") !== (selection.kind === "episode")) throw new TypeError("selection is inconsistent");
}

function validateToken(value: string, field: string, maximum: number): void {
  if (!/^[a-z0-9_-]+$/iu.test(value) || value.length > maximum) throw new TypeError(`${field} is invalid`);
}

function validateText(value: string, field: string, maximum: number): void {
  if (!value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${field} is invalid`);
  }
}

function safeEpoch(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8.64e15) throw new TypeError(`${field} is invalid`);
}
