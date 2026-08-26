import { createHash } from "node:crypto";

import type {
  MediaIdentity,
  ProviderQuotaEvidence,
  ProviderSearchResult,
  SubtitleCandidate,
} from "../domain.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonTransport,
  type ReadonlyJsonRequest,
} from "./http.js";

export type SubdlErrorCode = "unauthorized" | "unexpected_status" | "invalid_response";

export class SubdlAdapterError extends Error {
  readonly code: SubdlErrorCode;
  readonly status: number | undefined;

  constructor(code: SubdlErrorCode, message: string, options: { readonly status?: number } = {}) {
    super(message);
    this.name = "SubdlAdapterError";
    this.code = code;
    this.status = options.status;
  }
}

export interface SubdlLanguageWindow {
  readonly policyCode: string;
  readonly providerCode: string;
}

export interface SubdlSearchWindow {
  readonly item: MediaIdentity;
  readonly language: SubdlLanguageWindow;
}

export interface SubdlClientOptions {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly cacheTtlMs?: number;
  readonly maxCachedWindows?: number;
  readonly now?: () => number;
}

interface CachedSearch {
  readonly expiresAt: number;
  readonly result: Promise<ProviderSearchResult>;
}

interface NormalizedSearchWindow {
  readonly mediaType: "movie" | "tv";
  readonly mediaIds: Readonly<Record<string, string>>;
  readonly identifier: { readonly field: "imdb_id" | "tmdb_id"; readonly value: string };
  readonly season?: number;
  readonly episode?: number;
  readonly policyCode: string;
  readonly providerCode: string;
  readonly key: string;
}

const defaultTimeoutMs = 15_000;
const defaultMaxResponseBytes = 2 * 1024 * 1024;
const defaultCacheTtlMs = 15 * 60 * 1_000;
const defaultMaxCachedWindows = 256;

export class SubdlClient {
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #cacheTtlMs: number;
  readonly #maxCachedWindows: number;
  readonly #now: () => number;
  readonly #transport: JsonTransport;
  readonly #cache = new Map<string, CachedSearch>();

  constructor(options: SubdlClientOptions, transport: JsonTransport) {
    const apiKey = options.apiKey.trim();
    if (!apiKey || apiKey.length > 4_096 || /[\r\n]/u.test(apiKey)) {
      throw new TypeError("SubDL apiKey must be a non-empty bounded header value");
    }
    this.#apiKey = apiKey;
    this.#timeoutMs = boundedInteger(options.timeoutMs ?? defaultTimeoutMs, 1, 60_000, "timeoutMs");
    this.#maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? defaultMaxResponseBytes,
      1_024,
      5 * 1024 * 1024,
      "maxResponseBytes",
    );
    this.#cacheTtlMs = boundedInteger(
      options.cacheTtlMs ?? defaultCacheTtlMs,
      1_000,
      60 * 60 * 1_000,
      "cacheTtlMs",
    );
    this.#maxCachedWindows = boundedInteger(
      options.maxCachedWindows ?? defaultMaxCachedWindows,
      1,
      10_000,
      "maxCachedWindows",
    );
    this.#now = options.now ?? Date.now;
    this.#transport = transport;
  }

  search(window: SubdlSearchWindow): Promise<ProviderSearchResult> {
    const normalized = normalizeSearchWindow(window);
    const now = this.#now();
    const cached = this.#cache.get(normalized.key);
    if (cached !== undefined && cached.expiresAt > now) {
      return cached.result;
    }
    if (cached !== undefined) {
      this.#cache.delete(normalized.key);
    }
    while (this.#cache.size >= this.#maxCachedWindows) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.#cache.delete(oldest);
    }

    const result = this.#searchOnce(normalized);
    this.#cache.set(normalized.key, { expiresAt: now + this.#cacheTtlMs, result });
    return result;
  }

  async #searchOnce(window: NormalizedSearchWindow): Promise<ProviderSearchResult> {
    const query: Record<string, string> = {
      [window.identifier.field]: window.identifier.value,
      type: window.mediaType,
      languages: window.providerCode,
      subs_per_page: "30",
    };
    if (window.season !== undefined && window.episode !== undefined) {
      query.season = String(window.season);
      query.episode = String(window.episode);
    }

    let response: JsonResponse;
    try {
      response = await this.#transport.requestJson({
        method: "GET",
        path: "/api/v2/subtitles/search",
        query,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.#apiKey}`,
        },
        timeoutMs: this.#timeoutMs,
        maxResponseBytes: this.#maxResponseBytes,
      });
    } catch (error) {
      if (error instanceof JsonTransportError && error.code === "timeout") {
        return providerFailure("timeout", "SubDL search timed out");
      }
      if (
        error instanceof JsonTransportError &&
        (error.code === "invalid_json" || error.code === "response_too_large")
      ) {
        throw new SubdlAdapterError("invalid_response", "SubDL returned an invalid response");
      }
      return providerFailure("unavailable", "SubDL search transport failed");
    }

    if (response.status === 401 || response.status === 403) {
      throw new SubdlAdapterError("unauthorized", "SubDL rejected the configured credentials", {
        status: response.status,
      });
    }
    if (response.status === 429) {
      const retryAfter = numericHeader(response.headers, "retry-after");
      return providerFailure(
        "rate_limited",
        retryAfter === undefined
          ? "SubDL search quota or rate limit was reached"
          : `SubDL search quota or rate limit was reached; retry after ${retryAfter} seconds`,
        rateLimitEvidence(response.headers),
      );
    }
    if (response.status >= 500) {
      return providerFailure("unavailable", `SubDL search is unavailable (HTTP ${response.status})`);
    }
    if (response.status !== 200) {
      throw new SubdlAdapterError("unexpected_status", "SubDL rejected the search request", {
        status: response.status,
      });
    }

    try {
      return {
        provider: "subdl",
        status: "success",
        subtitles: mapSubdlSearchResponse(response.body, window),
        ...optionalQuota(response.headers),
      };
    } catch {
      throw new SubdlAdapterError("invalid_response", "SubDL returned an invalid search response", {
        status: response.status,
      });
    }
  }
}

export function mapSubdlSearchResponse(
  body: unknown,
  window: Omit<NormalizedSearchWindow, "key"> & { readonly key?: string },
): readonly SubtitleCandidate[] {
  const response = record(body, "SubDL search response");
  if (response.status !== undefined && response.status !== true) {
    throw new TypeError("SubDL search response.status must be true");
  }
  if (!Array.isArray(response.subtitles)) {
    throw new TypeError("SubDL search response.subtitles must be an array");
  }
  if (response.results !== undefined && !Array.isArray(response.results)) {
    throw new TypeError("SubDL search response.results must be an array when present");
  }

  return response.subtitles.flatMap((value, index) => {
    const subtitle = record(value, `subtitles[${index}]`);
    const releases = releaseNames(subtitle, index);
    const providerLanguage = optionalString(subtitle.language) ?? optionalString(subtitle.lang);
    const hearingImpaired = optionalBoolean(
      subtitle.hi ?? subtitle.hearing_impaired,
      `subtitles[${index}].hi`,
    );
    const forced = optionalBoolean(subtitle.forced, `subtitles[${index}].forced`);
    const fullSeason = optionalBoolean(
      subtitle.full_season,
      `subtitles[${index}].full_season`,
    );
    const season = optionalPositiveInteger(subtitle.season, `subtitles[${index}].season`);
    const episode = optionalPositiveInteger(subtitle.episode, `subtitles[${index}].episode`);
    const rawId = optionalScalarString(subtitle.n_id) ?? optionalScalarString(subtitle.id) ?? String(index);

    return releases.map((releaseName, releaseIndex) => ({
      id: stableSubtitleId(window, rawId, releaseName, releaseIndex),
      provider: "subdl",
      language: window.policyCode,
      ...(providerLanguage === undefined ? {} : { providerLanguage }),
      releaseName,
      mediaIds: window.mediaIds,
      ...(window.season === undefined ? {} : { season: season ?? window.season }),
      ...(window.episode === undefined ? {} : { episode: episode ?? window.episode }),
      ...(hearingImpaired === undefined ? {} : { hearingImpaired }),
      ...(forced === undefined ? {} : { forced }),
      ...(fullSeason === undefined ? {} : { fullSeason }),
    }));
  });
}

function normalizeSearchWindow(window: SubdlSearchWindow): NormalizedSearchWindow {
  const policyCode = safeLanguageCode(window.language.policyCode, "policyCode");
  const providerCode = safeLanguageCode(window.language.providerCode, "providerCode");
  const imdb = window.item.ids.imdb;
  const tmdb = window.item.ids.tmdb;
  const identifier = imdb !== undefined
    ? { field: "imdb_id" as const, value: imdbIdentifier(imdb) }
    : tmdb !== undefined
      ? { field: "tmdb_id" as const, value: numericIdentifier(tmdb, "tmdb") }
      : undefined;
  if (identifier === undefined) {
    throw new TypeError("SubDL search requires an IMDb or TMDB identifier");
  }

  const mediaIds: Record<string, string> = {};
  if (imdb !== undefined) {
    mediaIds.imdb = imdbIdentifier(imdb);
  }
  if (tmdb !== undefined) {
    mediaIds.tmdb = numericIdentifier(tmdb, "tmdb");
  }

  const episodeFields = window.item.kind === "episode"
    ? {
        season: boundedInteger(window.item.season ?? 0, 1, 100_000, "season"),
        episode: boundedInteger(window.item.episode ?? 0, 1, 100_000, "episode"),
      }
    : {};
  const rawKey = JSON.stringify({
    kind: window.item.kind,
    identifier,
    ...episodeFields,
    policyCode: policyCode.toLowerCase(),
    providerCode: providerCode.toLowerCase(),
  });

  return {
    mediaType: window.item.kind === "movie" ? "movie" : "tv",
    mediaIds,
    identifier,
    ...episodeFields,
    policyCode,
    providerCode,
    key: createHash("sha256").update(rawKey).digest("hex"),
  };
}

function providerFailure(
  status: "rate_limited" | "timeout" | "unavailable",
  detail: string,
  quota?: ProviderQuotaEvidence,
): ProviderSearchResult {
  return {
    provider: "subdl",
    status,
    subtitles: [],
    detail,
    ...(quota === undefined ? {} : { quota }),
  };
}

function stableSubtitleId(
  window: Omit<NormalizedSearchWindow, "key"> & { readonly key?: string },
  rawId: string,
  releaseName: string,
  releaseIndex: number,
): string {
  const digest = createHash("sha256")
    .update(`${window.mediaType}\0${JSON.stringify(window.mediaIds)}\0${rawId}\0${releaseName}\0${releaseIndex}`)
    .digest("hex")
    .slice(0, 24);
  return `subdl-${digest}`;
}

function releaseNames(
  subtitle: Readonly<Record<string, unknown>>,
  index: number,
): readonly string[] {
  const names: string[] = [];
  const releaseName = optionalString(subtitle.release_name);
  if (releaseName !== undefined) {
    names.push(releaseName);
  }
  if (subtitle.releases !== undefined) {
    if (!Array.isArray(subtitle.releases)) {
      throw new TypeError(`subtitles[${index}].releases must be an array`);
    }
    for (const [releaseIndex, release] of subtitle.releases.entries()) {
      names.push(requiredString(release, `subtitles[${index}].releases[${releaseIndex}]`));
    }
  }
  const fallbackName = optionalString(subtitle.name);
  if (names.length === 0 && fallbackName !== undefined) {
    names.push(fallbackName);
  }
  const unique = [...new Set(names)];
  if (unique.length === 0) {
    throw new TypeError(`subtitles[${index}] must include release evidence`);
  }
  return unique;
}

function numericHeader(
  headers: Readonly<Record<string, string>>,
  wanted: string,
): number | undefined {
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === wanted)?.[1];
  if (value === undefined || !/^\d+$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function rateLimitEvidence(
  headers: Readonly<Record<string, string>>,
): ProviderQuotaEvidence | undefined {
  const limit = numericHeader(headers, "x-ratelimit-limit");
  const remaining = numericHeader(headers, "x-ratelimit-remaining");
  const resetAtEpochSeconds = numericHeader(headers, "x-ratelimit-reset");
  if (limit === undefined && remaining === undefined && resetAtEpochSeconds === undefined) {
    return undefined;
  }
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...(resetAtEpochSeconds === undefined ? {} : { resetAtEpochSeconds }),
  };
}

function optionalQuota(headers: Readonly<Record<string, string>>): {
  readonly quota?: ProviderQuotaEvidence;
} {
  const quota = rateLimitEvidence(headers);
  return quota === undefined ? {} : { quota };
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    throw new TypeError(`${field} must be a non-empty bounded string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024
    ? value
    : undefined;
}

function optionalScalarString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0 && value.length <= 1_024) {
    return value;
  }
  return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : undefined;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new TypeError(`${field} must be a boolean`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === 0) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new TypeError(`${field} must be a number`);
  }
  return boundedInteger(value, 1, 100_000, field);
}

function safeLanguageCode(value: string, field: string): string {
  if (!/^[a-z][a-z0-9_-]{0,31}$/iu.test(value)) {
    throw new TypeError(`${field} must be a safe language code`);
  }
  return value;
}

function imdbIdentifier(value: string): string {
  if (!/^tt\d{5,12}$/u.test(value)) {
    throw new TypeError("imdb identifier must use the tt1234567 form");
  }
  return value;
}

function numericIdentifier(value: string, field: string): string {
  if (!/^[1-9]\d{0,15}$/u.test(value)) {
    throw new TypeError(`${field} identifier must be a positive decimal string`);
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
