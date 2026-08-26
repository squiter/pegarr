import {
  BazarrAdapterError,
  type BazarrLanguageProfileEvidence,
  type BazarrProfileAssignment,
  resolveBazarrPolicy,
} from "./adapters/bazarr.js";
import { SonarrAdapterError } from "./adapters/sonarr.js";
import type { ArrReleaseCandidate, FeasibilityReport, MediaIdentity } from "./domain.js";
import { buildFeasibilityReport } from "./matching.js";
import {
  searchSubdlPolicy,
  validateLanguageMappings,
  type ProviderLanguageMapping,
  type SubdlWindowSource,
} from "./provider-policy-search.js";

export interface SonarrSeasonReleaseSource {
  searchSeasonReleases(
    seriesId: number,
    seasonNumber: number,
  ): Promise<readonly ArrReleaseCandidate[]>;
}

export interface BazarrSeasonPolicySource {
  listLanguageProfiles(): Promise<readonly BazarrLanguageProfileEvidence[]>;
  readSeriesAssignment(sonarrSeriesId: number): Promise<BazarrProfileAssignment>;
}

export interface SonarrSeasonFeasibilityRequest {
  readonly sonarrSeriesId: number;
  readonly seasonNumber: number;
  readonly item: MediaIdentity;
  readonly subdlLanguages: readonly ProviderLanguageMapping[];
}

export interface SeasonFeasibilityMetrics {
  readonly sonarrRequests: 1;
  readonly bazarrRequests: 2;
  readonly providerRequests: number;
  readonly elapsedMs: number;
}

export interface SeasonIntegrationFailure {
  readonly integration: "sonarr" | "bazarr";
  readonly operation: "release_search" | "profile_list" | "profile_assignment";
  readonly state: "unauthorized" | "rate_limited" | "unavailable" | "unexpected_status" | "invalid_response";
  readonly retryAfterSeconds?: number;
}

export type SonarrSeasonFeasibilityOutcome =
  | {
      readonly status: "ready";
      readonly mode: "read_only";
      readonly report: FeasibilityReport;
      readonly metrics: SeasonFeasibilityMetrics;
    }
  | {
      readonly status: "policy_unresolved";
      readonly mode: "read_only";
      readonly reason: "media_not_found" | "unassigned" | "profile_missing";
      readonly releases: readonly ArrReleaseCandidate[];
      readonly metrics: SeasonFeasibilityMetrics;
    }
  | {
      readonly status: "integration_failure";
      readonly mode: "read_only";
      readonly failures: readonly SeasonIntegrationFailure[];
      readonly releases: readonly ArrReleaseCandidate[];
      readonly metrics: SeasonFeasibilityMetrics;
    };

export interface SonarrSeasonFeasibilityServiceOptions {
  readonly sonarr: SonarrSeasonReleaseSource;
  readonly bazarr: BazarrSeasonPolicySource;
  readonly subdl: SubdlWindowSource;
  readonly now?: () => number;
}

export class SonarrSeasonFeasibilityService {
  readonly #sonarr: SonarrSeasonReleaseSource;
  readonly #bazarr: BazarrSeasonPolicySource;
  readonly #subdl: SubdlWindowSource;
  readonly #now: () => number;

  constructor(options: SonarrSeasonFeasibilityServiceOptions) {
    this.#sonarr = options.sonarr;
    this.#bazarr = options.bazarr;
    this.#subdl = options.subdl;
    this.#now = options.now ?? Date.now;
  }

  async build(request: SonarrSeasonFeasibilityRequest): Promise<SonarrSeasonFeasibilityOutcome> {
    const validated = validateRequest(request);
    const startedAt = this.#now();
    const [releaseResult, profileResult, assignmentResult] = await Promise.allSettled([
      this.#sonarr.searchSeasonReleases(validated.sonarrSeriesId, validated.seasonNumber),
      this.#bazarr.listLanguageProfiles(),
      this.#bazarr.readSeriesAssignment(validated.sonarrSeriesId),
    ]);
    const releases = releaseResult.status === "fulfilled" ? releaseResult.value : [];
    const failures = [
      failureFrom(releaseResult, "sonarr", "release_search"),
      failureFrom(profileResult, "bazarr", "profile_list"),
      failureFrom(assignmentResult, "bazarr", "profile_assignment"),
    ].filter((failure): failure is SeasonIntegrationFailure => failure !== undefined);
    if (failures.length > 0) {
      return {
        status: "integration_failure",
        mode: "read_only",
        failures,
        releases,
        metrics: metrics(0, startedAt, this.#now()),
      };
    }

    if (profileResult.status !== "fulfilled" || assignmentResult.status !== "fulfilled") {
      throw new Error("Unreachable settled-result state");
    }
    const resolution = resolveBazarrPolicy(assignmentResult.value, profileResult.value);
    if (resolution.status !== "resolved") {
      return {
        status: "policy_unresolved",
        mode: "read_only",
        reason: resolution.status,
        releases,
        metrics: metrics(0, startedAt, this.#now()),
      };
    }

    const providerSearch = await searchSubdlPolicy({
      item: validated.item,
      policy: resolution.policy,
      mappings: validated.subdlLanguages,
      subdl: this.#subdl,
    });
    return {
      status: "ready",
      mode: "read_only",
      report: buildFeasibilityReport({
        fixture: "orchestrated-sonarr-season-v1",
        item: validated.item,
        policy: resolution.policy,
        releases,
        providerResults: providerSearch.results,
      }),
      metrics: metrics(providerSearch.requestCount, startedAt, this.#now()),
    };
  }
}

function validateRequest(request: SonarrSeasonFeasibilityRequest): SonarrSeasonFeasibilityRequest {
  positiveInteger(request.sonarrSeriesId, "sonarrSeriesId");
  positiveInteger(request.seasonNumber, "seasonNumber");
  if (request.item.kind !== "season") {
    throw new TypeError("Sonarr season feasibility requires a season item");
  }
  positiveInteger(request.item.season ?? 0, "item.season");
  if (request.item.season !== request.seasonNumber) {
    throw new TypeError("item.season must match seasonNumber");
  }
  if (!request.item.title.trim() || request.item.title.length > 1_024) {
    throw new TypeError("item.title must be a non-empty bounded string");
  }
  validateLanguageMappings(request.subdlLanguages);
  return request;
}

function failureFrom(
  result: PromiseSettledResult<unknown>,
  integration: "sonarr" | "bazarr",
  operation: SeasonIntegrationFailure["operation"],
): SeasonIntegrationFailure | undefined {
  if (result.status === "fulfilled") return undefined;
  const error = result.reason;
  const adapterError = error instanceof SonarrAdapterError || error instanceof BazarrAdapterError
    ? error
    : undefined;
  return {
    integration,
    operation,
    state: adapterError?.code ?? "unavailable",
    ...(adapterError?.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: adapterError.retryAfterSeconds }),
  };
}

function metrics(
  providerRequests: number,
  startedAt: number,
  completedAt: number,
): SeasonFeasibilityMetrics {
  const elapsedMs = Number.isFinite(startedAt) && Number.isFinite(completedAt)
    ? Math.max(0, Math.min(180_000, Math.round(completedAt - startedAt)))
    : 0;
  return { sonarrRequests: 1, bazarrRequests: 2, providerRequests, elapsedMs };
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
}
