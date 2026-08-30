import {
  BazarrAdapterError,
  type BazarrLanguageProfileEvidence,
  type BazarrProfileAssignment,
  resolveBazarrPolicy,
} from "./adapters/bazarr.js";
import { RadarrAdapterError } from "./adapters/radarr.js";
import type { ArrReleaseCandidate, FeasibilityReport, MediaIdentity } from "./domain.js";
import { buildFeasibilityReport } from "./matching.js";
import {
  searchProviderPolicy,
  validateLanguageMappings,
  type PlannedSubtitleProvider,
  type ProviderLanguageMapping,
  type SubtitleWindowSource,
  type SubdlWindowSource,
} from "./provider-policy-search.js";

export interface RadarrMovieReleaseSource {
  searchMovieReleases(movieId: number): Promise<readonly ArrReleaseCandidate[]>;
}

export interface BazarrMoviePolicySource {
  listLanguageProfiles(): Promise<readonly BazarrLanguageProfileEvidence[]>;
  readMovieAssignment(radarrId: number): Promise<BazarrProfileAssignment>;
}

export interface RadarrMovieFeasibilityRequest {
  readonly movieId: number;
  readonly item: MediaIdentity;
  readonly subdlLanguages: readonly ProviderLanguageMapping[];
  readonly opensubtitlesLanguages?: readonly ProviderLanguageMapping[];
}

export interface MovieFeasibilityMetrics {
  readonly radarrRequests: 1;
  readonly bazarrRequests: 2;
  readonly providerRequests: number;
  readonly elapsedMs: number;
}

export type MovieIntegrationFailureState =
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unexpected_status"
  | "invalid_response";

export interface MovieIntegrationFailure {
  readonly integration: "radarr" | "bazarr";
  readonly operation: "release_search" | "profile_list" | "profile_assignment";
  readonly state: MovieIntegrationFailureState;
  readonly retryAfterSeconds?: number;
}

export type RadarrMovieFeasibilityOutcome =
  | {
      readonly status: "ready";
      readonly mode: "read_only";
      readonly report: FeasibilityReport;
      readonly metrics: MovieFeasibilityMetrics;
    }
  | {
      readonly status: "policy_unresolved";
      readonly mode: "read_only";
      readonly reason: "media_not_found" | "unassigned" | "profile_missing";
      readonly releases: readonly ArrReleaseCandidate[];
      readonly metrics: MovieFeasibilityMetrics;
    }
  | {
      readonly status: "integration_failure";
      readonly mode: "read_only";
      readonly failures: readonly MovieIntegrationFailure[];
      readonly releases: readonly ArrReleaseCandidate[];
      readonly metrics: MovieFeasibilityMetrics;
    };

export interface RadarrMovieFeasibilityServiceOptions {
  readonly radarr: RadarrMovieReleaseSource;
  readonly bazarr: BazarrMoviePolicySource;
  readonly subdl?: SubdlWindowSource;
  readonly opensubtitles?: SubtitleWindowSource;
  readonly providers?: readonly PlannedSubtitleProvider[];
  readonly now?: () => number;
}

export class RadarrMovieFeasibilityService {
  readonly #radarr: RadarrMovieReleaseSource;
  readonly #bazarr: BazarrMoviePolicySource;
  readonly #subdl: SubdlWindowSource | undefined;
  readonly #opensubtitles: SubtitleWindowSource | undefined;
  readonly #providers: readonly PlannedSubtitleProvider[] | undefined;
  readonly #now: () => number;

  constructor(options: RadarrMovieFeasibilityServiceOptions) {
    this.#radarr = options.radarr;
    this.#bazarr = options.bazarr;
    this.#subdl = options.subdl;
    this.#opensubtitles = options.opensubtitles;
    this.#providers = options.providers;
    if (this.#subdl === undefined && this.#providers === undefined) {
      throw new TypeError("Movie feasibility requires at least one subtitle provider");
    }
    this.#now = options.now ?? Date.now;
  }

  async build(request: RadarrMovieFeasibilityRequest): Promise<RadarrMovieFeasibilityOutcome> {
    const validated = validateRequest(request);
    const startedAt = this.#now();
    const [releaseResult, profileResult, assignmentResult] = await Promise.allSettled([
      this.#radarr.searchMovieReleases(validated.movieId),
      this.#bazarr.listLanguageProfiles(),
      this.#bazarr.readMovieAssignment(validated.movieId),
    ]);
    const releases = releaseResult.status === "fulfilled" ? releaseResult.value : [];
    const failures = [
      failureFrom(releaseResult, "radarr", "release_search"),
      failureFrom(profileResult, "bazarr", "profile_list"),
      failureFrom(assignmentResult, "bazarr", "profile_assignment"),
    ].filter((failure): failure is MovieIntegrationFailure => failure !== undefined);
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

    const providers = this.#providers ?? [
      ...(this.#subdl === undefined ? [] : [{
        provider: "subdl",
        tier: "preferred" as const,
        mappings: validated.subdlLanguages,
        source: this.#subdl,
      }]),
      ...(this.#opensubtitles === undefined ? [] : [{
        provider: "opensubtitles",
        tier: "fallback" as const,
        mappings: validated.opensubtitlesLanguages ?? [],
        source: this.#opensubtitles,
      }]),
    ];
    const providerSearch = await searchProviderPolicy({
      item: validated.item,
      policy: resolution.policy,
      releases,
      providers,
    });
    return {
      status: "ready",
      mode: "read_only",
      report: buildFeasibilityReport({
        fixture: "orchestrated-radarr-movie-v1",
        item: validated.item,
        policy: resolution.policy,
        releases,
        providerResults: providerSearch.results,
      }),
      metrics: metrics(providerSearch.requestCount, startedAt, this.#now()),
    };
  }
}

function validateRequest(request: RadarrMovieFeasibilityRequest): RadarrMovieFeasibilityRequest {
  positiveInteger(request.movieId, "movieId");
  if (request.item.kind !== "movie") {
    throw new TypeError("Radarr movie feasibility requires a movie item");
  }
  if (!request.item.title.trim() || request.item.title.length > 1_024) {
    throw new TypeError("item.title must be a non-empty bounded string");
  }
  if (request.item.year !== undefined) {
    positiveInteger(request.item.year, "item.year");
  }
  validateLanguageMappings(request.subdlLanguages);
  if (request.opensubtitlesLanguages !== undefined) {
    validateLanguageMappings(request.opensubtitlesLanguages);
  }
  return request;
}

function failureFrom(
  result: PromiseSettledResult<unknown>,
  integration: "radarr" | "bazarr",
  operation: MovieIntegrationFailure["operation"],
): MovieIntegrationFailure | undefined {
  if (result.status === "fulfilled") {
    return undefined;
  }
  const error = result.reason;
  const adapterError = error instanceof RadarrAdapterError || error instanceof BazarrAdapterError
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
): MovieFeasibilityMetrics {
  const elapsedMs = Number.isFinite(startedAt) && Number.isFinite(completedAt)
    ? Math.max(0, Math.min(180_000, Math.round(completedAt - startedAt)))
    : 0;
  return { radarrRequests: 1, bazarrRequests: 2, providerRequests, elapsedMs };
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
}
