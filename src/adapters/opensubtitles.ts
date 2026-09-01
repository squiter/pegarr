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
} from "./http.js";

export type OpenSubtitlesErrorCode = "unauthorized" | "unexpected_status" | "invalid_response";

export class OpenSubtitlesAdapterError extends Error {
  readonly code: OpenSubtitlesErrorCode;
  readonly status: number | undefined;

  constructor(
    code: OpenSubtitlesErrorCode,
    message: string,
    options: { readonly status?: number } = {},
  ) {
    super(message);
    this.name = "OpenSubtitlesAdapterError";
    this.code = code;
    this.status = options.status;
  }
}

export interface OpenSubtitlesSearchWindow {
  readonly item: MediaIdentity;
  readonly language: { readonly policyCode: string; readonly providerCode: string };
}

export interface OpenSubtitlesClientOptions {
  readonly apiKey: string;
  readonly userAgent: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly cacheTtlMs?: number;
  readonly maxCachedWindows?: number;
  readonly now?: () => number;
}

interface NormalizedWindow {
  readonly item: MediaIdentity;
  readonly mediaIds: Readonly<Record<string, string>>;
  readonly policyCode: string;
  readonly providerCode: string;
  readonly query: Readonly<Record<string, string>>;
  readonly key: string;
}

interface CachedSearch {
  readonly expiresAt: number;
  readonly result: Promise<ProviderSearchResult>;
}

const defaultTimeoutMs = 15_000;
const defaultMaxResponseBytes = 2 * 1024 * 1024;
const defaultCacheTtlMs = 15 * 60 * 1_000;
const defaultMaxCachedWindows = 256;

export class OpenSubtitlesClient {
  readonly #apiKey: string;
  readonly #userAgent: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #cacheTtlMs: number;
  readonly #maxCachedWindows: number;
  readonly #now: () => number;
  readonly #transport: JsonTransport;
  readonly #cache = new Map<string, CachedSearch>();

  constructor(options: OpenSubtitlesClientOptions, transport: JsonTransport) {
    this.#apiKey = safeHeader(options.apiKey, "apiKey");
    this.#userAgent = safeHeader(options.userAgent, "userAgent");
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
      24 * 60 * 60 * 1_000,
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

  async search(searchWindow: OpenSubtitlesSearchWindow): Promise<ProviderSearchResult> {
    const window = normalizeWindow(searchWindow);
    const now = this.#now();
    const cached = this.#cache.get(window.key);
    if (cached !== undefined && cached.expiresAt > now) {
      const result = await cached.result;
      return result.cache?.status === "miss"
        ? { ...result, cache: { ...result.cache, status: "hit" } }
        : result;
    }
    if (cached !== undefined) this.#cache.delete(window.key);
    while (this.#cache.size >= this.#maxCachedWindows) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }

    const expiresAt = now + this.#cacheTtlMs;
    const result = this.#searchOnce(window).then((value) => {
      if (value.status !== "success") {
        if (this.#cache.get(window.key)?.result === result) this.#cache.delete(window.key);
        return value;
      }
      return {
        ...value,
        cache: {
          status: "miss" as const,
          storedAt: new Date(now).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
        },
      };
    });
    this.#cache.set(window.key, { expiresAt, result });
    return result;
  }

  async #searchOnce(window: NormalizedWindow): Promise<ProviderSearchResult> {
    let response: JsonResponse;
    try {
      response = await this.#transport.requestJson({
        method: "GET",
        path: "/subtitles",
        query: window.query,
        headers: {
          accept: "application/json",
          "api-key": this.#apiKey,
          "user-agent": this.#userAgent,
        },
        timeoutMs: this.#timeoutMs,
        maxResponseBytes: this.#maxResponseBytes,
      });
    } catch (error) {
      if (error instanceof JsonTransportError && error.code === "timeout") {
        return failure("timeout", "OpenSubtitles search timed out", window.policyCode);
      }
      if (
        error instanceof JsonTransportError &&
        (error.code === "invalid_json" || error.code === "response_too_large")
      ) {
        throw new OpenSubtitlesAdapterError(
          "invalid_response",
          "OpenSubtitles returned an invalid response",
        );
      }
      return failure("unavailable", "OpenSubtitles search transport failed", window.policyCode);
    }

    if (response.status === 401 || response.status === 403) {
      throw new OpenSubtitlesAdapterError(
        "unauthorized",
        "OpenSubtitles rejected the configured credentials",
        { status: response.status },
      );
    }
    if (response.status === 429) {
      const retryAfter = numericHeader(response.headers, "retry-after");
      return failure(
        "rate_limited",
        retryAfter === undefined
          ? "OpenSubtitles search rate limit was reached"
          : `OpenSubtitles search rate limit was reached; retry after ${retryAfter} seconds`,
        window.policyCode,
        quotaEvidence(response.headers),
      );
    }
    if (response.status >= 500) {
      return failure(
        "unavailable",
        `OpenSubtitles search is unavailable (HTTP ${response.status})`,
        window.policyCode,
      );
    }
    if (response.status !== 200) {
      throw new OpenSubtitlesAdapterError(
        "unexpected_status",
        "OpenSubtitles rejected the search request",
        { status: response.status },
      );
    }

    try {
      return {
        provider: "opensubtitles",
        status: "success",
        searchedLanguages: [window.policyCode],
        subtitles: mapOpenSubtitlesResponse(response.body, window),
        ...optionalQuota(response.headers),
      };
    } catch {
      throw new OpenSubtitlesAdapterError(
        "invalid_response",
        "OpenSubtitles returned an invalid search response",
        { status: response.status },
      );
    }
  }
}

export function mapOpenSubtitlesResponse(
  body: unknown,
  window: Pick<NormalizedWindow, "item" | "mediaIds" | "policyCode" | "providerCode">,
): readonly SubtitleCandidate[] {
  const response = record(body, "OpenSubtitles search response");
  if (!Array.isArray(response.data) || response.data.length > 100) {
    throw new TypeError("OpenSubtitles search response.data must be a bounded array");
  }
  const candidates: SubtitleCandidate[] = [];
  for (const [index, value] of response.data.entries()) {
    const result = record(value, `data[${index}]`);
    const attributes = record(result.attributes, `data[${index}].attributes`);
    const providerLanguage = requiredString(attributes.language, `data[${index}].attributes.language`);
    if (providerLanguage.toLowerCase() !== window.providerCode) continue;
    const releaseNames = evidenceNames(attributes, index);
    const hearingImpaired = optionalBoolean(
      attributes.hearing_impaired,
      `data[${index}].attributes.hearing_impaired`,
    );
    const forced = optionalBoolean(
      attributes.foreign_parts_only,
      `data[${index}].attributes.foreign_parts_only`,
    );
    const frameRate = optionalFrameRate(attributes.fps, `data[${index}].attributes.fps`);
    for (const releaseName of releaseNames) {
      candidates.push({
        id: stableId(window, releaseName),
        provider: "opensubtitles",
        language: window.policyCode,
        providerLanguage,
        releaseName,
        mediaIds: window.mediaIds,
        ...(window.item.season === undefined ? {} : { season: window.item.season }),
        ...(window.item.episode === undefined ? {} : { episode: window.item.episode }),
        ...(hearingImpaired === undefined ? {} : { hearingImpaired }),
        ...(forced === undefined ? {} : { forced }),
        ...(frameRate === undefined ? {} : { traits: { frameRate } }),
      });
    }
  }
  return candidates;
}

function normalizeWindow(window: OpenSubtitlesSearchWindow): NormalizedWindow {
  const policyCode = safeLanguage(window.language.policyCode, "policyCode");
  const providerCode = safeLanguage(window.language.providerCode, "providerCode").toLowerCase();
  const imdb = window.item.ids.imdb;
  const tmdb = window.item.ids.tmdb;
  const mediaIds: Record<string, string> = {};
  if (imdb !== undefined) mediaIds.imdb = imdbIdentifier(imdb);
  if (tmdb !== undefined) mediaIds.tmdb = numericIdentifier(tmdb, "tmdb");

  let query: Record<string, string>;
  if (window.item.kind === "movie") {
    const identifier = imdb !== undefined
      ? { imdb_id: imdbIdentifier(imdb).slice(2) }
      : tmdb !== undefined
        ? { tmdb_id: numericIdentifier(tmdb, "tmdb") }
        : undefined;
    if (identifier === undefined) throw new TypeError("OpenSubtitles search requires an IMDb or TMDB identifier");
    query = { ...identifier, languages: providerCode, type: "movie" };
  } else if (window.item.kind === "episode") {
    const season = boundedInteger(window.item.season ?? 0, 1, 100_000, "season");
    const episode = boundedInteger(window.item.episode ?? 0, 1, 100_000, "episode");
    const identifier = imdb !== undefined
      ? { parent_imdb_id: imdbIdentifier(imdb).slice(2) }
      : tmdb !== undefined
        ? { parent_tmdb_id: numericIdentifier(tmdb, "tmdb") }
        : undefined;
    if (identifier === undefined) throw new TypeError("OpenSubtitles search requires an IMDb or TMDB identifier");
    query = {
      episode_number: String(episode),
      languages: providerCode,
      ...identifier,
      season_number: String(season),
      type: "episode",
    };
  } else {
    throw new TypeError("OpenSubtitles season-pack search is not implemented");
  }
  const orderedQuery = Object.fromEntries(Object.entries(query).sort(([left], [right]) => left.localeCompare(right)));
  const key = createHash("sha256")
    .update(JSON.stringify({ kind: window.item.kind, query: orderedQuery, policyCode: policyCode.toLowerCase() }))
    .digest("hex");
  return { item: window.item, mediaIds, policyCode, providerCode, query: orderedQuery, key };
}

function evidenceNames(attributes: Readonly<Record<string, unknown>>, index: number): readonly string[] {
  const names: string[] = [];
  const release = optionalString(attributes.release);
  if (release !== undefined) names.push(release);
  if (!Array.isArray(attributes.files) || attributes.files.length > 20) {
    throw new TypeError(`data[${index}].attributes.files must be a bounded array`);
  }
  for (const [fileIndex, value] of attributes.files.entries()) {
    const file = record(value, `data[${index}].attributes.files[${fileIndex}]`);
    const name = optionalString(file.file_name);
    if (name !== undefined) names.push(name.replace(/\.(?:srt|ass|ssa|vtt|sub)$/iu, ""));
  }
  const unique = [...new Set(names)];
  if (unique.length === 0) throw new TypeError(`data[${index}] must include release evidence`);
  return unique;
}

function stableId(
  window: Pick<NormalizedWindow, "item" | "mediaIds" | "providerCode">,
  releaseName: string,
): string {
  const digest = createHash("sha256")
    .update(`${window.item.kind}\0${JSON.stringify(window.mediaIds)}\0${window.providerCode}\0${releaseName}`)
    .digest("hex")
    .slice(0, 24);
  return `opensubtitles-${digest}`;
}

function failure(
  status: "rate_limited" | "timeout" | "unavailable",
  detail: string,
  language: string,
  quota?: ProviderQuotaEvidence,
): ProviderSearchResult {
  return {
    provider: "opensubtitles",
    status,
    searchedLanguages: [language],
    subtitles: [],
    detail,
    ...(quota === undefined ? {} : { quota }),
  };
}

function quotaEvidence(headers: Readonly<Record<string, string>>): ProviderQuotaEvidence | undefined {
  const limit = numericHeader(headers, "x-ratelimit-limit-second")
    ?? numericHeader(headers, "ratelimit-limit")
    ?? numericHeader(headers, "x-ratelimit-limit");
  const remaining = numericHeader(headers, "x-ratelimit-remaining-second")
    ?? numericHeader(headers, "ratelimit-remaining")
    ?? numericHeader(headers, "x-ratelimit-remaining");
  if (limit === undefined && remaining === undefined) return undefined;
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    windowSeconds: 1,
  };
}

function optionalQuota(headers: Readonly<Record<string, string>>): { readonly quota?: ProviderQuotaEvidence } {
  const quota = quotaEvidence(headers);
  return quota === undefined ? {} : { quota };
}

function numericHeader(headers: Readonly<Record<string, string>>, wanted: string): number | undefined {
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === wanted)?.[1];
  if (value === undefined || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (normalized === undefined) throw new TypeError(`${field} must be a non-empty bounded string`);
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024 ? value : undefined;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean`);
  return value;
}

function optionalFrameRate(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === 0 || value === "0") return undefined;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 1 || parsed > 240) {
    throw new TypeError(`${field} must be a frame rate between 1 and 240`);
  }
  return parsed;
}

function safeHeader(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 4_096 || /[\r\n]/u.test(normalized)) {
    throw new TypeError(`OpenSubtitles ${field} must be a non-empty bounded header value`);
  }
  return normalized;
}

function safeLanguage(value: string, field: string): string {
  if (!/^[a-z][a-z0-9_-]{0,31}$/iu.test(value)) throw new TypeError(`${field} must be a safe language code`);
  return value;
}

function imdbIdentifier(value: string): string {
  if (!/^tt\d{5,12}$/u.test(value)) throw new TypeError("imdb identifier must use the tt1234567 form");
  return value;
}

function numericIdentifier(value: string, field: string): string {
  if (!/^[1-9]\d{0,15}$/u.test(value)) throw new TypeError(`${field} identifier must be a positive decimal string`);
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
