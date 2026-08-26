import {
  BazarrAdapterError,
  type BazarrLanguageProfileEvidence,
  type BazarrProfileAssignment,
  resolveBazarrPolicy,
} from "./adapters/bazarr.js";
import { SonarrAdapterError } from "./adapters/sonarr.js";
import { SubdlAdapterError, type SubdlSearchWindow } from "./adapters/subdl.js";
import type {
  ArrReleaseCandidate,
  FeasibilityReport,
  MediaIdentity,
  ProviderSearchResult,
} from "./domain.js";
import { buildFeasibilityReport } from "./matching.js";
import { normalizeLanguage } from "./normalization.js";

export interface SonarrEpisodeReleaseSource {
  searchEpisodeReleases(episodeId: number): Promise<readonly ArrReleaseCandidate[]>;
}

export interface BazarrEpisodePolicySource {
  listLanguageProfiles(): Promise<readonly BazarrLanguageProfileEvidence[]>;
  readSeriesAssignment(sonarrSeriesId: number): Promise<BazarrProfileAssignment>;
}

export interface SubdlWindowSource {
  search(window: SubdlSearchWindow): Promise<ProviderSearchResult>;
}

export interface ProviderLanguageMapping {
  readonly policyCode: string;
  readonly providerCode: string;
}

export interface SonarrEpisodeFeasibilityRequest {
  readonly episodeId: number;
  readonly sonarrSeriesId: number;
  readonly item: MediaIdentity;
  readonly subdlLanguages: readonly ProviderLanguageMapping[];
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
  readonly subdl: SubdlWindowSource;
  readonly now?: () => number;
}

export class SonarrEpisodeFeasibilityService {
  readonly #sonarr: SonarrEpisodeReleaseSource;
  readonly #bazarr: BazarrEpisodePolicySource;
  readonly #subdl: SubdlWindowSource;
  readonly #now: () => number;

  constructor(options: SonarrEpisodeFeasibilityServiceOptions) {
    this.#sonarr = options.sonarr;
    this.#bazarr = options.bazarr;
    this.#subdl = options.subdl;
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

    const mappings = languageMappingIndex(validated.subdlLanguages);
    const providerResults: ProviderSearchResult[] = [];
    let providerRequests = 0;
    const searched = new Set<string>();
    for (const requirement of resolution.policy.languages) {
      const normalizedCode = normalizeLanguage(requirement.code);
      if (searched.has(normalizedCode)) {
        continue;
      }
      searched.add(normalizedCode);
      const mapping = mappings.get(normalizedCode);
      if (mapping === undefined) {
        providerResults.push({
          provider: "subdl",
          status: "unsupported",
          searchedLanguages: [requirement.code],
          subtitles: [],
          detail: "No explicit SubDL language mapping is configured",
        });
        continue;
      }

      providerRequests += 1;
      try {
        const result = await this.#subdl.search({
          item: validated.item,
          language: { policyCode: requirement.code, providerCode: mapping.providerCode },
        });
        if (result.status === "success") {
          providerResults.push({ ...result, searchedLanguages: [requirement.code] });
          continue;
        }
        providerResults.push({
          provider: result.provider,
          status: result.status,
          subtitles: [],
          ...(result.detail === undefined ? {} : { detail: result.detail }),
          ...(result.quota === undefined ? {} : { quota: result.quota }),
        });
        break;
      } catch (error) {
        providerResults.push(providerFailure(error));
        break;
      }
    }

    return {
      status: "ready",
      mode: "read_only",
      report: buildFeasibilityReport({
        fixture: "orchestrated-sonarr-episode-v1",
        item: validated.item,
        policy: resolution.policy,
        releases,
        providerResults,
      }),
      metrics: metrics(providerRequests, startedAt, this.#now()),
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
  languageMappingIndex(request.subdlLanguages);
  return request;
}

function languageMappingIndex(
  mappings: readonly ProviderLanguageMapping[],
): ReadonlyMap<string, ProviderLanguageMapping> {
  const indexed = new Map<string, ProviderLanguageMapping>();
  for (const mapping of mappings) {
    const policyCode = safeLanguage(mapping.policyCode, "policyCode");
    const providerCode = safeLanguage(mapping.providerCode, "providerCode");
    const normalized = normalizeLanguage(policyCode);
    if (indexed.has(normalized)) {
      throw new TypeError("SubDL policy language mappings must be unique");
    }
    indexed.set(normalized, { policyCode, providerCode });
  }
  return indexed;
}

function providerFailure(error: unknown): ProviderSearchResult {
  const status = error instanceof SubdlAdapterError
    ? error.code === "unauthorized"
      ? "unauthorized"
      : error.code === "invalid_response"
        ? "invalid_response"
        : "unexpected_status"
    : "unavailable";
  return {
    provider: "subdl",
    status,
    subtitles: [],
    detail: `SubDL search ${status.replaceAll("_", " ")}`,
  };
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

function safeLanguage(value: string, field: string): string {
  if (!/^[a-z][a-z0-9_-]{0,31}$/iu.test(value)) {
    throw new TypeError(`${field} must be a safe language code`);
  }
  return value;
}
