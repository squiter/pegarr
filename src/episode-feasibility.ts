import {
  BazarrAdapterError,
  type BazarrLanguageProfileEvidence,
  type BazarrProfileAssignment,
  resolveBazarrPolicy,
} from "./adapters/bazarr.js";
import { SonarrAdapterError } from "./adapters/sonarr.js";
import type {
  ArrReleaseCandidate,
  FeasibilityReport,
  MediaIdentity,
} from "./domain.js";
import { buildFeasibilityReport } from "./matching.js";
import {
  searchProviderPolicy,
  validateLanguageMappings,
  type PlannedSubtitleProvider,
  type ProviderLanguageMapping,
  type SubtitleWindowSource,
  type SubdlWindowSource,
} from "./provider-policy-search.js";

export type { ProviderLanguageMapping, SubdlWindowSource } from "./provider-policy-search.js";

export interface SonarrEpisodeReleaseSource {
  searchEpisodeReleases(episodeId: number): Promise<readonly ArrReleaseCandidate[]>;
}

export interface BazarrEpisodePolicySource {
  listLanguageProfiles(): Promise<readonly BazarrLanguageProfileEvidence[]>;
  readSeriesAssignment(sonarrSeriesId: number): Promise<BazarrProfileAssignment>;
}

export interface SonarrEpisodeFeasibilityRequest {
  readonly episodeId: number;
  readonly sonarrSeriesId: number;
  readonly item: MediaIdentity;
  readonly subdlLanguages: readonly ProviderLanguageMapping[];
  readonly opensubtitlesLanguages?: readonly ProviderLanguageMapping[];
}

export interface EpisodeFeasibilityMetrics {
  readonly sonarrRequests: 1;
  readonly bazarrRequests: 2;
  readonly providerRequests: number;
  readonly elapsedMs: number;
}

export type IntegrationFailureState =
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unexpected_status"
  | "invalid_response";

export interface EpisodeIntegrationFailure {
  readonly integration: "sonarr" | "bazarr";
  readonly operation: "release_search" | "profile_list" | "profile_assignment";
  readonly state: IntegrationFailureState;
  readonly retryAfterSeconds?: number;
}

export type SonarrEpisodeFeasibilityOutcome =
  | {
      readonly status: "ready";
      readonly mode: "read_only";
      readonly report: FeasibilityReport;
      readonly metrics: EpisodeFeasibilityMetrics;
    }
  | {
      readonly status: "policy_unresolved";
      readonly mode: "read_only";
      readonly reason: "media_not_found" | "unassigned" | "profile_missing";
      readonly releases: readonly ArrReleaseCandidate[];
      readonly metrics: EpisodeFeasibilityMetrics;
    }
  | {
      readonly status: "integration_failure";
      readonly mode: "read_only";
      readonly failures: readonly EpisodeIntegrationFailure[];
      readonly releases: readonly ArrReleaseCandidate[];
      readonly metrics: EpisodeFeasibilityMetrics;
    };

export interface SonarrEpisodeFeasibilityServiceOptions {
  readonly sonarr: SonarrEpisodeReleaseSource;
  readonly bazarr: BazarrEpisodePolicySource;
  readonly subdl?: SubdlWindowSource;
  readonly opensubtitles?: SubtitleWindowSource;
  readonly providers?: readonly PlannedSubtitleProvider[];
  readonly now?: () => number;
}

export class SonarrEpisodeFeasibilityService {
  readonly #sonarr: SonarrEpisodeReleaseSource;
  readonly #bazarr: BazarrEpisodePolicySource;
  readonly #subdl: SubdlWindowSource | undefined;
  readonly #opensubtitles: SubtitleWindowSource | undefined;
  readonly #providers: readonly PlannedSubtitleProvider[] | undefined;
  readonly #now: () => number;

  constructor(options: SonarrEpisodeFeasibilityServiceOptions) {
    this.#sonarr = options.sonarr;
    this.#bazarr = options.bazarr;
    this.#subdl = options.subdl;
    this.#opensubtitles = options.opensubtitles;
    this.#providers = options.providers;
    if (this.#subdl === undefined && this.#providers === undefined) {
      throw new TypeError("Episode feasibility requires at least one subtitle provider");
    }
    this.#now = options.now ?? Date.now;
  }

  async build(
    request: SonarrEpisodeFeasibilityRequest,
  ): Promise<SonarrEpisodeFeasibilityOutcome> {
    const validated = validateRequest(request);
    const startedAt = this.#now();
    const [releaseResult, profileResult, assignmentResult] = await Promise.allSettled([
      this.#sonarr.searchEpisodeReleases(validated.episodeId),
      this.#bazarr.listLanguageProfiles(),
      this.#bazarr.readSeriesAssignment(validated.sonarrSeriesId),
    ]);
    const releases = releaseResult.status === "fulfilled" ? releaseResult.value : [];
    const failures = [
      failureFrom(releaseResult, "sonarr", "release_search"),
      failureFrom(profileResult, "bazarr", "profile_list"),
      failureFrom(assignmentResult, "bazarr", "profile_assignment"),
    ].filter((failure): failure is EpisodeIntegrationFailure => failure !== undefined);
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
        fixture: "orchestrated-sonarr-episode-v1",
        item: validated.item,
        policy: resolution.policy,
        releases,
        providerResults: providerSearch.results,
      }),
      metrics: metrics(providerSearch.requestCount, startedAt, this.#now()),
    };
  }
}

function validateRequest(
  request: SonarrEpisodeFeasibilityRequest,
): SonarrEpisodeFeasibilityRequest {
  positiveInteger(request.episodeId, "episodeId");
  positiveInteger(request.sonarrSeriesId, "sonarrSeriesId");
  if (request.item.kind !== "episode") {
    throw new TypeError("Sonarr episode feasibility requires an episode item");
  }
  positiveInteger(request.item.season ?? 0, "item.season");
  positiveInteger(request.item.episode ?? 0, "item.episode");
  if (!request.item.title.trim() || request.item.title.length > 1_024) {
    throw new TypeError("item.title must be a non-empty bounded string");
  }
  validateLanguageMappings(request.subdlLanguages);
  if (request.opensubtitlesLanguages !== undefined) {
    validateLanguageMappings(request.opensubtitlesLanguages);
  }
  return request;
}

function failureFrom(
  result: PromiseSettledResult<unknown>,
  integration: "sonarr" | "bazarr",
  operation: EpisodeIntegrationFailure["operation"],
): EpisodeIntegrationFailure | undefined {
  if (result.status === "fulfilled") {
    return undefined;
  }
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
): EpisodeFeasibilityMetrics {
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
