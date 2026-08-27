import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { SubdlSearchWindow } from "./adapters/subdl.js";
import type { ProviderSearchResult } from "./domain.js";
import type { SubdlWindowSource } from "./provider-policy-search.js";

export interface ProviderSearchCacheOptions {
  readonly databasePath: string;
  readonly source: SubdlWindowSource;
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

const defaultTtlMs = 15 * 60_000;
const defaultMaxEntries = 5_000;
const maximumPayloadBytes = 5 * 1024 * 1024;

export class ProviderSearchCache implements SubdlWindowSource {
  readonly #database: DatabaseSync;
  readonly #source: SubdlWindowSource;
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #inFlight = new Map<string, Promise<ProviderSearchResult>>();

  constructor(options: ProviderSearchCacheOptions) {
    if (!isAbsolute(options.databasePath)) {
      throw new TypeError("Provider cache database path must be absolute");
    }
    this.#source = options.source;
    this.#ttlMs = boundedInteger(options.ttlMs ?? defaultTtlMs, 1_000, 24 * 60 * 60_000, "ttlMs");
    this.#maxEntries = boundedInteger(options.maxEntries ?? defaultMaxEntries, 1, 100_000, "maxEntries");
    this.#now = options.now ?? Date.now;
    this.#database = new DatabaseSync(options.databasePath);
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS provider_search_cache (
        cache_key TEXT PRIMARY KEY,
        stored_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS provider_search_cache_expiry
        ON provider_search_cache(expires_at_ms);
    `);
  }

  async search(window: SubdlSearchWindow): Promise<ProviderSearchResult> {
    const key = cacheKey(window);
    const now = safeNow(this.#now());
    const cached = this.#read(key, now);
    if (cached !== undefined) return cached;

    const shared = this.#inFlight.get(key);
    if (shared !== undefined) {
      const result = await shared;
      return result.cache?.status === "miss"
        ? { ...result, cache: { ...result.cache, status: "hit" } }
        : result;
    }

    const pending = this.#searchAndStore(key, window);
    this.#inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.#inFlight.get(key) === pending) this.#inFlight.delete(key);
    }
  }

  close(): void {
    this.#database.close();
  }

  async #searchAndStore(
    key: string,
    window: SubdlSearchWindow,
  ): Promise<ProviderSearchResult> {
    const result = await this.#source.search(window);
    if (result.status !== "success") return result;

    const storedAt = safeNow(this.#now());
    const expiresAt = Math.min(8.64e15, storedAt + this.#ttlMs);
    const payload = JSON.stringify(withoutCache(result));
    if (Buffer.byteLength(payload, "utf8") > maximumPayloadBytes) {
      return result;
    }
    this.#database.prepare(`
      INSERT INTO provider_search_cache(cache_key, stored_at_ms, expires_at_ms, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        stored_at_ms = excluded.stored_at_ms,
        expires_at_ms = excluded.expires_at_ms,
        payload_json = excluded.payload_json
    `).run(key, storedAt, expiresAt, payload);
    this.#prune(storedAt);
    return {
      ...result,
      cache: {
        status: "miss",
        storedAt: timestamp(storedAt),
        expiresAt: timestamp(expiresAt),
      },
    };
  }

  #read(key: string, now: number): ProviderSearchResult | undefined {
    const row = this.#database.prepare(`
      SELECT stored_at_ms, expires_at_ms, payload_json
      FROM provider_search_cache
      WHERE cache_key = ?
    `).get(key) as { stored_at_ms: number; expires_at_ms: number; payload_json: string } | undefined;
    if (row === undefined) return undefined;
    if (row.expires_at_ms <= now) {
      this.#database.prepare("DELETE FROM provider_search_cache WHERE cache_key = ?").run(key);
      return undefined;
    }
    try {
      const result = parseCachedResult(row.payload_json);
      return {
        ...result,
        cache: {
          status: "hit",
          storedAt: timestamp(row.stored_at_ms),
          expiresAt: timestamp(row.expires_at_ms),
        },
      };
    } catch {
      this.#database.prepare("DELETE FROM provider_search_cache WHERE cache_key = ?").run(key);
      return undefined;
    }
  }

  #prune(now: number): void {
    this.#database.prepare("DELETE FROM provider_search_cache WHERE expires_at_ms <= ?").run(now);
    this.#database.prepare(`
      DELETE FROM provider_search_cache
      WHERE cache_key IN (
        SELECT cache_key FROM provider_search_cache
        ORDER BY stored_at_ms ASC, cache_key ASC
        LIMIT MAX(0, (SELECT COUNT(*) FROM provider_search_cache) - ?)
      )
    `).run(this.#maxEntries);
  }
}

function cacheKey(window: SubdlSearchWindow): string {
  const ids = Object.fromEntries(Object.entries(window.item.ids).sort(([left], [right]) =>
    left.localeCompare(right),
  ));
  const stable = JSON.stringify({
    provider: "subdl",
    kind: window.item.kind,
    ids,
    season: window.item.season,
    episode: window.item.episode,
    policyCode: window.language.policyCode.toLowerCase(),
    providerCode: window.language.providerCode.toLowerCase(),
  });
  return createHash("sha256").update(stable).digest("hex");
}

function withoutCache(result: ProviderSearchResult): ProviderSearchResult {
  const { cache: _cache, ...persisted } = result;
  return persisted;
}

function parseCachedResult(payload: string): ProviderSearchResult {
  if (Buffer.byteLength(payload, "utf8") > maximumPayloadBytes) {
    throw new TypeError("Cached provider result is too large");
  }
  const value = JSON.parse(payload) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Cached provider result must be an object");
  }
  const result = value as Partial<ProviderSearchResult>;
  if (
    result.provider !== "subdl" ||
    result.status !== "success" ||
    !Array.isArray(result.subtitles) ||
    (result.searchedLanguages !== undefined &&
      (!Array.isArray(result.searchedLanguages) ||
        result.searchedLanguages.some((language) => typeof language !== "string")))
  ) {
    throw new TypeError("Cached provider result is invalid");
  }
  return result as ProviderSearchResult;
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function safeNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8.64e15) {
    throw new TypeError("Provider cache clock returned an invalid timestamp");
  }
  return value;
}

function timestamp(value: number): string {
  return new Date(value).toISOString();
}
