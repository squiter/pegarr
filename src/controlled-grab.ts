import { randomUUID } from "node:crypto";

import type {
  ArrGrabReceipt,
  ArrReleaseHandle,
  MissingMediaItem,
  RevalidatedArrRelease,
} from "./domain.js";
import type { GrabAuditEntry, GrabReconciliationOutcome } from "./grab-audit.js";
import { GrabAuditStore } from "./grab-audit.js";
import type { MissingInventoryResult } from "./inventory-missing.js";
import type { ItemFeasibilitySelection } from "./item-feasibility.js";
import type { ControlledGrabSelection } from "./grab-selection.js";

export interface ControlledGrabSource {
  revalidate(selection: ControlledGrabSelection, releaseId: string): Promise<RevalidatedArrRelease | undefined>;
  grab(handle: ArrReleaseHandle, selection: ControlledGrabSelection): Promise<ArrGrabReceipt>;
}

export interface ControlledGrabServiceOptions {
  readonly readInventory: () => Promise<MissingInventoryResult>;
  readonly sonarr?: ControlledGrabSource;
  readonly radarr?: ControlledGrabSource;
  readonly audit: GrabAuditStore;
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly challengeTtlMs?: number;
  readonly duplicateWindowMs?: number;
  readonly maxChallenges?: number;
}

export interface ControlledGrabTarget {
  readonly selection: ControlledGrabSelection;
  readonly targetLabel: string;
}

export interface GrabChallenge {
  readonly status: "confirmation_required";
  readonly mode: "controlled_grab";
  readonly challengeId: string;
  readonly application: "sonarr" | "radarr";
  readonly instanceId: string;
  readonly kind: "episode" | "movie" | "season";
  readonly itemId: number;
  readonly seasonNumber?: number;
  readonly targetLabel: string;
  readonly releaseId: string;
  readonly releaseTitle: string;
  readonly confirmation: string;
  readonly expiresAt: string;
}

export type PrepareGrabResult =
  | GrabChallenge
  | {
      readonly status: "item_unavailable" | "release_changed" | "release_rejected" | "integration_failure";
      readonly mode: "controlled_grab";
      readonly detailCode: string;
    };

export type ExecuteGrabResult =
  | {
      readonly status: "grabbed" | "timeout_unknown" | "revalidation_failed" | "upstream_failure";
      readonly mode: "controlled_grab";
      readonly event: PublicGrabAuditEntry;
      readonly replayed: boolean;
      readonly requiresReconciliation: boolean;
    }
  | {
      readonly status: "challenge_expired" | "confirmation_mismatch" | "duplicate_blocked" | "duplicate_in_progress" | "idempotency_conflict";
      readonly mode: "controlled_grab";
      readonly detailCode: string;
      readonly previousEvent?: PublicGrabAuditEntry;
    };

export type PublicGrabAuditEntry = Omit<GrabAuditEntry, "idempotencyKey"> & {
  readonly reconciliationConfirmations?: {
    readonly grabbed: string;
    readonly notGrabbed: string;
  };
};

export type ReconcileGrabResult =
  | {
      readonly status: "reconciled";
      readonly mode: "controlled_grab";
      readonly event: PublicGrabAuditEntry;
    }
  | {
      readonly status: "event_not_found" | "not_reconcilable" | "confirmation_mismatch";
      readonly mode: "controlled_grab";
      readonly detailCode: string;
    };

interface StoredChallenge extends GrabChallenge {
  readonly expiresAtMs: number;
}

const defaultChallengeTtlMs = 2 * 60_000;
const defaultDuplicateWindowMs = 10 * 60_000;
const defaultMaxChallenges = 100;

export class ControlledGrabService {
  readonly #options: ControlledGrabServiceOptions;
  readonly #now: () => number;
  readonly #randomId: () => string;
  readonly #challengeTtlMs: number;
  readonly #duplicateWindowMs: number;
  readonly #maxChallenges: number;
  readonly #challenges = new Map<string, StoredChallenge>();
  readonly #executions = new Map<string, {
    readonly selection: ControlledGrabSelection;
    readonly confirmation: string;
    readonly promise: Promise<ExecuteGrabResult>;
  }>();
  readonly #targets = new Set<string>();

  constructor(options: ControlledGrabServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#randomId = options.randomId ?? randomUUID;
    this.#challengeTtlMs = boundedInteger(options.challengeTtlMs ?? defaultChallengeTtlMs, 10_000, 10 * 60_000, "challengeTtlMs");
    this.#duplicateWindowMs = boundedInteger(options.duplicateWindowMs ?? defaultDuplicateWindowMs, 60_000, 24 * 60 * 60_000, "duplicateWindowMs");
    this.#maxChallenges = boundedInteger(options.maxChallenges ?? defaultMaxChallenges, 1, 1_000, "maxChallenges");
  }

  async prepare(selection: ItemFeasibilitySelection, releaseId: string): Promise<PrepareGrabResult> {
    const validated = validateSelection(selection) as ItemFeasibilitySelection;
    const item = await this.#item(validated);
    if (item === undefined) return failure("item_unavailable", "item_not_missing");
    const canonicalSelection = { ...validated, instanceId: item.instanceId };
    return this.#prepareTarget(canonicalSelection, itemLabel(item), releaseId);
  }

  async prepareTarget(target: ControlledGrabTarget, releaseId: string): Promise<PrepareGrabResult> {
    const selection = validateSelection(target.selection);
    if (selection.instanceId === undefined) throw new TypeError("Controlled Grab target instance is required");
    return this.#prepareTarget(
      { ...selection, instanceId: selection.instanceId },
      boundedText(target.targetLabel, "targetLabel", 2_048),
      releaseId,
    );
  }

  async #prepareTarget(
    selection: ControlledGrabSelection & { readonly instanceId: string },
    targetLabel: string,
    releaseId: string,
  ): Promise<PrepareGrabResult> {
    const normalizedReleaseId = validateReleaseId(releaseId, selection.application);
    const source = this.#source(selection.application);
    if (source === undefined) return failure("item_unavailable", "integration_disabled");
    let release: RevalidatedArrRelease | undefined;
    try {
      release = await source.revalidate(selection, normalizedReleaseId);
    } catch (error) {
      return failure("integration_failure", safeUpstreamCode(error));
    }
    if (release === undefined) return failure("release_changed", "release_not_returned");
    if (!release.candidate.downloadAllowed) return failure("release_rejected", "arr_rejected_release");
    const releaseTitle = boundedText(release.candidate.title, "releaseTitle", 4_096);
    const requestedAt = safeNow(this.#now());
    this.#pruneChallenges(requestedAt);
    while (this.#challenges.size >= this.#maxChallenges) {
      const oldest = this.#challenges.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#challenges.delete(oldest);
    }
    const challengeId = validateOpaqueId(this.#randomId(), "challengeId");
    const expiresAtMs = requestedAt + this.#challengeTtlMs;
    const challenge: StoredChallenge = {
      status: "confirmation_required",
      mode: "controlled_grab",
      challengeId,
      application: selection.application,
      instanceId: selection.instanceId,
      kind: selection.kind,
      itemId: selection.itemId,
      ...(selection.kind === "season" ? { seasonNumber: selection.seasonNumber } : {}),
      targetLabel,
      releaseId: normalizedReleaseId,
      releaseTitle,
      confirmation: confirmationText(releaseTitle, targetLabel),
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
    };
    this.#challenges.set(challengeId, challenge);
    return publicChallenge(challenge);
  }

  async execute(
    selection: ControlledGrabSelection,
    challengeId: string,
    confirmation: string,
    idempotencyKey: string,
  ): Promise<ExecuteGrabResult> {
    const normalizedIdempotencyKey = validateOpaqueId(idempotencyKey, "idempotencyKey");
    const validatedSelection = validateSelection(selection);
    const validatedConfirmation = boundedText(confirmation, "confirmation", 8_192);
    const active = this.#executions.get(normalizedIdempotencyKey);
    if (active !== undefined) {
      return sameSelection(active.selection, validatedSelection) && active.confirmation === validatedConfirmation
        ? active.promise
        : executionFailure("idempotency_conflict", "idempotency_key_reused");
    }
    const execution = this.#execute(
      validatedSelection,
      validateOpaqueId(challengeId, "challengeId"),
      validatedConfirmation,
      normalizedIdempotencyKey,
    );
    const activeExecution = { selection: validatedSelection, confirmation: validatedConfirmation, promise: execution };
    this.#executions.set(normalizedIdempotencyKey, activeExecution);
    try {
      return await execution;
    } finally {
      if (this.#executions.get(normalizedIdempotencyKey) === activeExecution) this.#executions.delete(normalizedIdempotencyKey);
    }
  }

  history(limit = 50): readonly PublicGrabAuditEntry[] {
    return this.#options.audit.list(limit).map(publicAudit);
  }

  reconcile(eventId: string, outcome: GrabReconciliationOutcome, confirmation: string): ReconcileGrabResult {
    const normalizedEventId = validateOpaqueId(eventId, "eventId");
    const validatedOutcome = validateReconciliationOutcome(outcome);
    const validatedConfirmation = boundedText(confirmation, "confirmation", 8_192);
    const event = this.#options.audit.byEventId(normalizedEventId);
    if (event === undefined) return reconciliationFailure("event_not_found", "audit_event_not_found");
    if (event.status !== "timeout_unknown" || event.reconciliationOutcome !== undefined) {
      return reconciliationFailure("not_reconcilable", "audit_event_not_reconcilable");
    }
    if (validatedConfirmation !== reconciliationText(event, validatedOutcome)) {
      return reconciliationFailure("confirmation_mismatch", "exact_confirmation_required");
    }
    try {
      return {
        status: "reconciled",
        mode: "controlled_grab",
        event: publicAudit(this.#options.audit.reconcile(normalizedEventId, validatedOutcome, safeNow(this.#now()))),
      };
    } catch {
      return reconciliationFailure("not_reconcilable", "audit_event_not_reconcilable");
    }
  }

  close(): void {
    this.#options.audit.close();
  }

  async #execute(
    selection: ControlledGrabSelection,
    challengeId: string,
    confirmation: string,
    idempotencyKey: string,
  ): Promise<ExecuteGrabResult> {
    const previous = this.#options.audit.byIdempotencyKey(idempotencyKey);
    if (previous !== undefined) {
      const sameRequest = previous.application === selection.application
        && (selection.instanceId === undefined || previous.instanceId === selection.instanceId)
        && previous.kind === selection.kind
        && previous.itemId === selection.itemId
        && (selection.kind !== "season" || previous.seasonNumber === selection.seasonNumber)
        && confirmation === confirmationText(previous.releaseTitle, previous.targetLabel);
      return sameRequest
        ? resultFromAudit(previous, true)
        : executionFailure("idempotency_conflict", "idempotency_key_reused");
    }
    const requestedAt = safeNow(this.#now());
    this.#pruneChallenges(requestedAt);
    const challenge = this.#challenges.get(challengeId);
    if (challenge === undefined) return executionFailure("challenge_expired", "challenge_missing_or_expired");
    if (
      challenge.application !== selection.application ||
      (selection.instanceId !== undefined && challenge.instanceId !== selection.instanceId) ||
      challenge.kind !== selection.kind ||
      challenge.itemId !== selection.itemId ||
      (selection.kind === "season" && challenge.seasonNumber !== selection.seasonNumber)
    ) {
      return executionFailure("confirmation_mismatch", "challenge_target_mismatch");
    }
    if (confirmation !== challenge.confirmation) return executionFailure("confirmation_mismatch", "exact_confirmation_required");

    const canonicalSelection = { ...selection, instanceId: challenge.instanceId };
    const targetKey = `${canonicalSelection.application}:${canonicalSelection.instanceId}:${canonicalSelection.kind}:${canonicalSelection.itemId}:${canonicalSelection.kind === "season" ? canonicalSelection.seasonNumber : "item"}:${challenge.releaseId}`;
    if (this.#targets.has(targetKey)) return executionFailure("duplicate_in_progress", "target_grab_in_progress");
    const blocking = this.#options.audit.recentBlocking(
      canonicalSelection,
      challenge.releaseId,
      Math.max(0, requestedAt - this.#duplicateWindowMs),
    );
    if (blocking !== undefined) {
      return {
        ...executionFailure(
          "duplicate_blocked",
          blocking.status === "timeout_unknown" && blocking.reconciliationOutcome === undefined
            ? "reconciliation_required"
            : "recent_grab_exists",
        ),
        previousEvent: publicAudit(blocking),
      };
    }

    this.#targets.add(targetKey);
    try {
      try {
        this.#options.audit.begin({
          eventId: validateOpaqueId(this.#randomId(), "eventId"),
          idempotencyKey,
          selection: canonicalSelection,
          targetLabel: challenge.targetLabel,
          releaseId: challenge.releaseId,
          releaseTitle: challenge.releaseTitle,
          requestedAtMs: requestedAt,
        });
      } catch {
        const raced = this.#options.audit.byIdempotencyKey(idempotencyKey);
        if (raced !== undefined) return resultFromAudit(raced, true);
        throw new Error("Grab audit could not record the request");
      }

      const source = this.#source(canonicalSelection.application);
      if (source === undefined) return this.#complete(idempotencyKey, "revalidation_failed", "integration_disabled");
      let revalidated: RevalidatedArrRelease | undefined;
      try {
        revalidated = await source.revalidate(canonicalSelection, challenge.releaseId);
      } catch (error) {
        return this.#complete(idempotencyKey, "revalidation_failed", safeUpstreamCode(error));
      }
      if (
        revalidated === undefined ||
        !revalidated.candidate.downloadAllowed ||
        revalidated.candidate.title !== challenge.releaseTitle
      ) {
        return this.#complete(idempotencyKey, "revalidation_failed", "release_changed_before_grab");
      }

      try {
        await source.grab(revalidated.handle, canonicalSelection);
        this.#challenges.delete(challengeId);
        return this.#complete(idempotencyKey, "grabbed", "arr_accepted_grab");
      } catch (error) {
        this.#challenges.delete(challengeId);
        const detailCode = safeUpstreamCode(error);
        return detailCode === "timeout"
          ? this.#complete(idempotencyKey, "timeout_unknown", "reconciliation_required")
          : this.#complete(idempotencyKey, "upstream_failure", detailCode);
      }
    } finally {
      this.#targets.delete(targetKey);
    }
  }

  #complete(
    idempotencyKey: string,
    status: "grabbed" | "revalidation_failed" | "timeout_unknown" | "upstream_failure",
    detailCode: string,
  ): ExecuteGrabResult {
    const event = this.#options.audit.complete(idempotencyKey, status, detailCode, safeNow(this.#now()));
    return resultFromAudit(event, false);
  }

  #source(application: "sonarr" | "radarr"): ControlledGrabSource | undefined {
    return application === "sonarr" ? this.#options.sonarr : this.#options.radarr;
  }

  async #item(selection: ItemFeasibilitySelection): Promise<MissingMediaItem | undefined> {
    const inventory = await this.#options.readInventory();
    if (inventory.status === "disabled") return undefined;
    const matches = inventory.sources
      .filter(({ integration, status }) => integration === selection.application && status === "ready")
      .flatMap((source) => source.status === "ready" ? source.page.items : [])
      .filter((item) =>
        item.application === selection.application
        && item.kind === selection.kind
        && item.itemId === selection.itemId
        && (selection.instanceId === undefined || item.instanceId === selection.instanceId)
      );
    return matches.length === 1 ? matches[0] : undefined;
  }

  #pruneChallenges(now: number): void {
    for (const [id, challenge] of this.#challenges) {
      if (challenge.expiresAtMs <= now) this.#challenges.delete(id);
    }
  }
}

function publicChallenge(challenge: StoredChallenge): GrabChallenge {
  const { expiresAtMs: _expiresAtMs, ...result } = challenge;
  return result;
}

function publicAudit(entry: GrabAuditEntry): PublicGrabAuditEntry {
  const { idempotencyKey: _idempotencyKey, ...result } = entry;
  return entry.status === "timeout_unknown" && entry.reconciliationOutcome === undefined
    ? {
        ...result,
        reconciliationConfirmations: {
          grabbed: reconciliationText(entry, "grabbed"),
          notGrabbed: reconciliationText(entry, "not_grabbed"),
        },
      }
    : result;
}

function resultFromAudit(entry: GrabAuditEntry, replayed: boolean): ExecuteGrabResult {
  const status = entry.status === "in_progress" ? "duplicate_in_progress" : entry.status;
  if (status === "duplicate_in_progress") return executionFailure(status, "target_grab_in_progress");
  return {
    status,
    mode: "controlled_grab",
    event: publicAudit(entry),
    replayed,
    requiresReconciliation: status === "timeout_unknown" && entry.reconciliationOutcome === undefined,
  };
}

function failure(
  status: Extract<PrepareGrabResult, { readonly detailCode: string }>["status"],
  detailCode: string,
): PrepareGrabResult {
  return { status, mode: "controlled_grab", detailCode };
}

function executionFailure(
  status: Extract<ExecuteGrabResult, { readonly detailCode: string }>["status"],
  detailCode: string,
): Extract<ExecuteGrabResult, { readonly detailCode: string }> {
  return { status, mode: "controlled_grab", detailCode };
}

function confirmationText(releaseTitle: string, targetLabel: string): string {
  return `GRAB ${releaseTitle} FOR ${targetLabel}`;
}

function reconciliationText(entry: Pick<GrabAuditEntry, "releaseTitle" | "targetLabel">, outcome: GrabReconciliationOutcome): string {
  return `RECONCILE ${entry.releaseTitle} FOR ${entry.targetLabel} AS ${outcome === "grabbed" ? "GRABBED" : "NOT GRABBED"}`;
}

function validateReconciliationOutcome(value: string): GrabReconciliationOutcome {
  if (value === "grabbed" || value === "not_grabbed") return value;
  throw new TypeError("reconciliation outcome is invalid");
}

function reconciliationFailure(
  status: Extract<ReconcileGrabResult, { readonly detailCode: string }>["status"],
  detailCode: string,
): Extract<ReconcileGrabResult, { readonly detailCode: string }> {
  return { status, mode: "controlled_grab", detailCode };
}

function itemLabel(item: MissingMediaItem): string {
  if (item.kind === "episode") {
    const season = String(item.season ?? 0).padStart(2, "0");
    const episode = String(item.episode ?? 0).padStart(2, "0");
    return boundedText(`${item.parentTitle ?? item.title} S${season}E${episode} · ${item.title}`, "targetLabel", 2_048);
  }
  return boundedText(`${item.title}${item.year === undefined ? "" : ` (${item.year})`}`, "targetLabel", 2_048);
}

function validateSelection(selection: ControlledGrabSelection): ControlledGrabSelection {
  if (!Number.isSafeInteger(selection.itemId) || selection.itemId < 1) throw new TypeError("itemId must be positive");
  if (selection.instanceId !== undefined && !/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(selection.instanceId)) {
    throw new TypeError("instanceId is invalid");
  }
  if (selection.application === "sonarr" && selection.kind === "episode") return selection;
  if (selection.application === "sonarr" && selection.kind === "season" && Number.isSafeInteger(selection.seasonNumber) && selection.seasonNumber >= 0 && selection.seasonNumber <= 10_000) return selection;
  if (selection.application === "radarr" && selection.kind === "movie") return selection;
  throw new TypeError("selection is inconsistent");
}

function sameSelection(left: ControlledGrabSelection, right: ControlledGrabSelection): boolean {
  return left.application === right.application
    && (left.instanceId === undefined || right.instanceId === undefined || left.instanceId === right.instanceId)
    && left.kind === right.kind
    && left.itemId === right.itemId
    && (left.kind !== "season" || right.kind !== "season" || left.seasonNumber === right.seasonNumber);
}

function validateReleaseId(value: string, application: "sonarr" | "radarr"): string {
  if (!new RegExp(`^${application}-[a-f0-9]{24}$`, "u").test(value)) throw new TypeError("releaseId is invalid");
  return value;
}

function validateOpaqueId(value: string, field: string): string {
  if (!/^[a-z0-9_-]{8,128}$/iu.test(value)) throw new TypeError(`${field} is invalid`);
  return value;
}

function boundedText(value: string, field: string, maximum: number): string {
  if (!value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function safeUpstreamCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "upstream_failure";
  const code = String(error.code);
  return /^(?:timeout|unauthorized|rate_limited|release_unavailable|upstream_failure|invalid_response|unavailable|unexpected_status)$/u.test(code)
    ? code
    : "upstream_failure";
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${field} is invalid`);
  return value;
}

function safeNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8.64e15) throw new TypeError("clock returned an invalid timestamp");
  return value;
}
