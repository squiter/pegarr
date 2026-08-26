import { SubdlAdapterError, type SubdlSearchWindow } from "./adapters/subdl.js";
import type {
  MediaIdentity,
  ProviderSearchResult,
  SubtitlePolicy,
} from "./domain.js";
import { normalizeLanguage } from "./normalization.js";

export interface SubdlWindowSource {
  search(window: SubdlSearchWindow): Promise<ProviderSearchResult>;
}

export interface ProviderLanguageMapping {
  readonly policyCode: string;
  readonly providerCode: string;
}

export interface ScopedProviderSearch {
  readonly results: readonly ProviderSearchResult[];
  readonly requestCount: number;
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

    requestCount += 1;
    try {
      const result = await options.subdl.search({
        item: options.item,
        language: { policyCode: requirement.code, providerCode: mapping.providerCode },
      });
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
      results.push(providerFailure(error));
      break;
    }
  }
  return { results, requestCount };
}

export function validateLanguageMappings(
  mappings: readonly ProviderLanguageMapping[],
): void {
  languageMappingIndex(mappings);
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

function safeLanguage(value: string, field: string): string {
  if (!/^[a-z][a-z0-9_-]{0,31}$/iu.test(value)) {
    throw new TypeError(`${field} must be a safe language code`);
  }
  return value;
}
