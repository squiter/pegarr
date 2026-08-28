import { SubdlAdapterError, type SubdlSearchWindow } from "./adapters/subdl.js";
import type {
  ArrReleaseCandidate,
  MediaIdentity,
  ProviderSearchResult,
  SubtitlePolicy,
} from "./domain.js";
import { assessLanguage } from "./matching.js";
import { normalizeLanguage } from "./normalization.js";

export interface SubdlWindowSource {
  search(window: SubdlSearchWindow): Promise<ProviderSearchResult>;
}

export type SubtitleWindowSource = SubdlWindowSource;

export interface ProviderLanguageMapping {
  readonly policyCode: string;
  readonly providerCode: string;
}

export interface ScopedProviderSearch {
  readonly results: readonly ProviderSearchResult[];
  readonly requestCount: number;
}

export interface PlannedSubtitleProvider {
  readonly provider: string;
  readonly tier: "preferred" | "fallback";
  readonly mappings: readonly ProviderLanguageMapping[];
  readonly source: SubtitleWindowSource;
}

export async function searchProviderPolicy(options: {
  readonly item: MediaIdentity;
  readonly policy: SubtitlePolicy;
  readonly releases: readonly ArrReleaseCandidate[];
  readonly providers: readonly PlannedSubtitleProvider[];
  readonly minimumConfidence?: "confirmed" | "likely";
}): Promise<ScopedProviderSearch> {
  const providers = validateProviders(options.providers);
  const requirements = orderedRequirements(options.policy);
  const results: ProviderSearchResult[] = [];
  let requestCount = 0;
  for (const provider of providers) {
    if (
      provider.tier === "fallback" &&
      hasSufficientCoverage(
        options.item,
        options.policy,
        options.releases,
        results,
        options.minimumConfidence ?? "likely",
      )
    ) {
      continue;
    }
    const mappings = languageMappingIndex(provider.mappings, provider.provider);
    for (const requirement of requirements) {
      const normalizedCode = normalizeLanguage(requirement.code);
      const mapping = mappings.get(normalizedCode);
      if (mapping === undefined) {
        results.push({
          provider: provider.provider,
          status: "unsupported",
          searchedLanguages: [requirement.code],
          subtitles: [],
          detail: `No explicit ${provider.provider} language mapping is configured`,
        });
        continue;
      }
      try {
        const result = await provider.source.search({
          item: options.item,
          language: { policyCode: requirement.code, providerCode: mapping.providerCode },
        });
        if (result.cache?.status !== "hit") requestCount += 1;
        if (result.provider !== provider.provider) {
          results.push(providerFailure(provider.provider, "invalid_response"));
          break;
        }
        if (result.status === "success") {
          results.push({ ...result, searchedLanguages: [requirement.code] });
        } else {
          results.push({
            provider: result.provider,
            status: result.status,
            subtitles: [],
            ...(result.detail === undefined ? {} : { detail: result.detail }),
            ...(result.quota === undefined ? {} : { quota: result.quota }),
          });
          break;
        }
      } catch (error) {
        requestCount += 1;
        results.push(providerFailure(provider.provider, classifyProviderError(error)));
        break;
      }
      if (
        provider.tier === "fallback" &&
        hasSufficientCoverage(
          options.item,
          options.policy,
          options.releases,
          results,
          options.minimumConfidence ?? "likely",
        )
      ) {
        break;
      }
    }
  }
  return { results, requestCount };
}

export async function searchSubdlPolicy(options: {
  readonly item: MediaIdentity;
  readonly policy: SubtitlePolicy;
  readonly mappings: readonly ProviderLanguageMapping[];
  readonly subdl: SubdlWindowSource;
}): Promise<ScopedProviderSearch> {
  const mappings = languageMappingIndex(options.mappings);
  const results: ProviderSearchResult[] = [];
  let requestCount = 0;
  const searched = new Set<string>();
  for (const requirement of options.policy.languages) {
    const normalizedCode = normalizeLanguage(requirement.code);
    if (searched.has(normalizedCode)) {
      continue;
    }
    searched.add(normalizedCode);
    const mapping = mappings.get(normalizedCode);
    if (mapping === undefined) {
      results.push({
        provider: "subdl",
        status: "unsupported",
        searchedLanguages: [requirement.code],
        subtitles: [],
        detail: "No explicit SubDL language mapping is configured",
      });
      continue;
    }

    try {
      const result = await options.subdl.search({
        item: options.item,
        language: { policyCode: requirement.code, providerCode: mapping.providerCode },
      });
      if (result.cache?.status !== "hit") requestCount += 1;
      if (result.status === "success") {
        results.push({ ...result, searchedLanguages: [requirement.code] });
        continue;
      }
      results.push({
        provider: result.provider,
        status: result.status,
        subtitles: [],
        ...(result.detail === undefined ? {} : { detail: result.detail }),
        ...(result.quota === undefined ? {} : { quota: result.quota }),
      });
      break;
    } catch (error) {
      requestCount += 1;
      results.push(providerFailure(error));
      break;
    }
  }
  return { results, requestCount };
}

export function validateLanguageMappings(
  mappings: readonly ProviderLanguageMapping[],
): void {
  languageMappingIndex(mappings, "SubDL");
}

function languageMappingIndex(
  mappings: readonly ProviderLanguageMapping[],
  provider = "SubDL",
): ReadonlyMap<string, ProviderLanguageMapping> {
  const indexed = new Map<string, ProviderLanguageMapping>();
  for (const mapping of mappings) {
    const policyCode = safeLanguage(mapping.policyCode, "policyCode");
    const providerCode = safeLanguage(mapping.providerCode, "providerCode");
    const normalized = normalizeLanguage(policyCode);
    if (indexed.has(normalized)) {
      throw new TypeError(`${provider} policy language mappings must be unique`);
    }
    indexed.set(normalized, { policyCode, providerCode });
  }
  return indexed;
}

function providerFailure(
  providerOrError: string | unknown,
  explicitStatus?: Exclude<ProviderSearchResult["status"], "success" | "unsupported">,
): ProviderSearchResult {
  const provider = typeof providerOrError === "string" ? providerOrError : "subdl";
  const error = typeof providerOrError === "string" ? undefined : providerOrError;
  const status = explicitStatus ?? (error instanceof SubdlAdapterError
    ? error.code === "unauthorized"
      ? "unauthorized"
      : error.code === "invalid_response"
        ? "invalid_response"
        : "unexpected_status"
    : "unavailable");
  return {
    provider,
    status,
    subtitles: [],
    detail: `${providerDisplayName(provider)} search ${status.replaceAll("_", " ")}`,
  };
}

function classifyProviderError(
  error: unknown,
): Exclude<ProviderSearchResult["status"], "success" | "unsupported"> {
  if (error instanceof SubdlAdapterError) {
    return error.code === "unauthorized"
      ? "unauthorized"
      : error.code === "invalid_response"
        ? "invalid_response"
        : "unexpected_status";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "OpenSubtitlesAdapterError" &&
    "code" in error
  ) {
    return error.code === "unauthorized"
      ? "unauthorized"
      : error.code === "invalid_response"
        ? "invalid_response"
        : "unexpected_status";
  }
  return "unavailable";
}

function validateProviders(
  providers: readonly PlannedSubtitleProvider[],
): readonly PlannedSubtitleProvider[] {
  if (providers.length < 1 || providers.length > 8) {
    throw new TypeError("Provider plan must contain between 1 and 8 providers");
  }
  const seen = new Set<string>();
  const ranked = providers.map((provider, index) => {
    if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(provider.provider)) {
      throw new TypeError("Provider plan contains an invalid provider ID");
    }
    if (seen.has(provider.provider)) throw new TypeError("Provider plan IDs must be unique");
    seen.add(provider.provider);
    languageMappingIndex(provider.mappings, provider.provider);
    return { provider, index };
  });
  return ranked
    .sort((left, right) =>
      tierRank(left.provider.tier) - tierRank(right.provider.tier) || left.index - right.index,
    )
    .map(({ provider }) => provider);
}

function tierRank(tier: PlannedSubtitleProvider["tier"]): number {
  return tier === "preferred" ? 0 : 1;
}

function orderedRequirements(policy: SubtitlePolicy): SubtitlePolicy["languages"] {
  const unique = new Map<string, SubtitlePolicy["languages"][number]>();
  for (const requirement of policy.languages) {
    const normalized = normalizeLanguage(requirement.code);
    if (!unique.has(normalized)) unique.set(normalized, requirement);
  }
  const requirements = [...unique.values()];
  return [
    ...requirements.filter(({ required }) => required),
    ...requirements.filter(({ required }) => !required),
  ];
}

function hasSufficientCoverage(
  item: MediaIdentity,
  policy: SubtitlePolicy,
  releases: readonly ArrReleaseCandidate[],
  results: readonly ProviderSearchResult[],
  minimumConfidence: "confirmed" | "likely",
): boolean {
  const required = orderedRequirements(policy).filter(({ required }) => required);
  if (required.length === 0) return false;
  return releases.some((release) =>
    release.downloadAllowed && required.every((requirement) => {
      const confidence = assessLanguage(item, release, requirement, results).confidence;
      return confidence === "confirmed" || (minimumConfidence === "likely" && confidence === "likely");
    }),
  );
}

function providerDisplayName(provider: string): string {
  return provider === "subdl"
    ? "SubDL"
    : provider === "opensubtitles"
      ? "OpenSubtitles"
      : "Subtitle provider";
}

function safeLanguage(value: string, field: string): string {
  if (!/^[a-z][a-z0-9_-]{0,31}$/iu.test(value)) {
    throw new TypeError(`${field} must be a safe language code`);
  }
  return value;
}
