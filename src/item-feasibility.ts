import type {
  MissingMediaItem,
} from "./domain.js";
import type {
  SonarrEpisodeFeasibilityOutcome,
  SonarrEpisodeFeasibilityRequest,
} from "./episode-feasibility.js";
import type { MissingInventoryResult } from "./inventory-missing.js";
import type {
  RadarrMovieFeasibilityOutcome,
  RadarrMovieFeasibilityRequest,
} from "./movie-feasibility.js";
import type { ProviderLanguageMapping } from "./provider-policy-search.js";

export type ItemFeasibilitySelection =
  | { readonly application: "sonarr"; readonly kind: "episode"; readonly itemId: number }
  | { readonly application: "radarr"; readonly kind: "movie"; readonly itemId: number };

type IntegrationName = "sonarr" | "radarr" | "bazarr" | "subdl";

export interface ItemAnalysisCacheEvidence {
  readonly source: "computed" | "memory_cache" | "stale_cache";
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly staleUntil: string;
  readonly refreshFailure?: "inventory_unavailable" | "integration_failure" | "unexpected_failure";
  readonly unavailableIntegrations?: readonly IntegrationName[];
}

export interface ItemFeasibilityReadOptions {
  readonly refresh?: boolean;
}

type ItemOutcome<Selection extends ItemFeasibilitySelection, Outcome> = {
  readonly kind: "item-feasibility";
  readonly selection: Selection;
} & Outcome;

type ItemFeasibilityBuildResult =
  | ItemOutcome<Extract<ItemFeasibilitySelection, { readonly kind: "episode" }>, SonarrEpisodeFeasibilityOutcome>
  | ItemOutcome<Extract<ItemFeasibilitySelection, { readonly kind: "movie" }>, RadarrMovieFeasibilityOutcome>
  | {
      readonly kind: "item-feasibility";
      readonly mode: "read_only";
      readonly status: "disabled";
      readonly selection: ItemFeasibilitySelection;
      readonly missingIntegrations: readonly ("sonarr" | "radarr" | "bazarr" | "subdl")[];
    }
  | {
      readonly kind: "item-feasibility";
      readonly mode: "read_only";
      readonly status: "inventory_unavailable";
      readonly selection: ItemFeasibilitySelection;
      readonly state: "unauthorized" | "rate_limited" | "unavailable" | "unexpected_status" | "invalid_response";
      readonly retryAfterSeconds?: number;
    }
  | {
      readonly kind: "item-feasibility";
      readonly mode: "read_only";
      readonly status: "not_found";
      readonly selection: ItemFeasibilitySelection;
    };

type WithAnalysisEvidence<Result> = Result extends { readonly status: "ready" }
  ? Result & { readonly analysis: ItemAnalysisCacheEvidence }
  : Result;

export type ItemFeasibilityResult = WithAnalysisEvidence<ItemFeasibilityBuildResult>;
type ReadyItemFeasibilityResult = Extract<ItemFeasibilityResult, { readonly status: "ready" }>;
type RefreshFailure = "inventory_unavailable" | "integration_failure" | "unexpected_failure";

interface ReadyCacheEntry {
  readonly value: ReadyItemFeasibilityResult;
  readonly expiresAt: number;
  readonly staleUntil: number;
  readonly retryAfter?: number;
  readonly refreshFailure?: RefreshFailure;
  readonly unavailableIntegrations?: readonly IntegrationName[];
}

export interface EpisodeFeasibilityBuilder {
  build(request: SonarrEpisodeFeasibilityRequest): Promise<SonarrEpisodeFeasibilityOutcome>;
}

export interface MovieFeasibilityBuilder {
  build(request: RadarrMovieFeasibilityRequest): Promise<RadarrMovieFeasibilityOutcome>;
}

export interface ItemFeasibilityServiceOptions {
  readonly readInventory: () => Promise<MissingInventoryResult>;
  readonly episode?: EpisodeFeasibilityBuilder;
  readonly movie?: MovieFeasibilityBuilder;
  readonly subdlLanguages: readonly ProviderLanguageMapping[];
  readonly missingIntegrations: Readonly<{
    episode: readonly ("sonarr" | "bazarr" | "subdl")[];
    movie: readonly ("radarr" | "bazarr" | "subdl")[];
  }>;
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly staleTtlMs?: number;
  readonly maxEntries?: number;
}

export class ItemFeasibilityService {
  readonly #options: ItemFeasibilityServiceOptions;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #staleTtlMs: number;
  readonly #maxEntries: number;
  readonly #cache = new Map<string, ReadyCacheEntry>();
  readonly #inFlight = new Map<string, Promise<ItemFeasibilityResult>>();

  constructor(options: ItemFeasibilityServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#ttlMs = boundedInteger(options.ttlMs ?? 30_000, 0, 300_000, "ttlMs");
    this.#staleTtlMs = boundedInteger(
      options.staleTtlMs ?? 6 * 60 * 60 * 1_000,
      0,
      7 * 24 * 60 * 60 * 1_000,
      "staleTtlMs",
    );
    this.#maxEntries = boundedInteger(options.maxEntries ?? 100, 1, 1_000, "maxEntries");
  }

  async read(
    selection: ItemFeasibilitySelection,
    options: ItemFeasibilityReadOptions = {},
  ): Promise<ItemFeasibilityResult> {
    const validated = validateSelection(selection);
    const key = `${validated.application}:${validated.kind}:${validated.itemId}`;
    const requestedAt = this.#now();
    let cached = this.#cache.get(key);
    if (
      options.refresh !== true &&
      cached?.refreshFailure !== undefined &&
      cached.retryAfter !== undefined &&
      requestedAt < cached.retryAfter &&
      requestedAt < cached.staleUntil
    ) {
      return staleResult(
        cached,
        cached.refreshFailure,
        cached.unavailableIntegrations ?? [],
      );
    }
    if (options.refresh !== true && cached !== undefined && requestedAt < cached.expiresAt) {
      return {
        ...cached.value,
        analysis: { ...cached.value.analysis, source: "memory_cache" },
      };
    }
    if (cached !== undefined && requestedAt >= cached.staleUntil) {
      this.#cache.delete(key);
      cached = undefined;
    }
    const active = this.#inFlight.get(key);
    if (active !== undefined) return active;

    const current = this.#buildAndCache(validated, key, cached);
    this.#inFlight.set(key, current);
    try {
      return await current;
    } finally {
      if (this.#inFlight.get(key) === current) this.#inFlight.delete(key);
    }
  }

  async #buildAndCache(
    selection: ItemFeasibilitySelection,
    key: string,
    stale: ReadyCacheEntry | undefined,
  ): Promise<ItemFeasibilityResult> {
    let built: ItemFeasibilityBuildResult;
    try {
      built = await this.#build(selection);
    } catch (error) {
      if (stale !== undefined) return this.#recordStaleFailure(key, stale, "unexpected_failure", []);
      throw error;
    }
    if (built.status !== "ready") {
      const failure = staleFailure(built);
      if (stale !== undefined && failure !== undefined) {
        return this.#recordStaleFailure(key, stale, failure.reason, failure.integrations);
      }
      this.#cache.delete(key);
      return built;
    }
    const generatedAt = this.#now();
    const expiresAt = generatedAt + this.#ttlMs;
    const staleUntil = expiresAt + this.#staleTtlMs;
    const value: ReadyItemFeasibilityResult = {
      ...built,
      analysis: {
        source: "computed",
        generatedAt: new Date(generatedAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        staleUntil: new Date(staleUntil).toISOString(),
      },
    };
    while (this.#cache.size >= this.#maxEntries) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    this.#cache.set(key, { value, expiresAt, staleUntil });
    return value;
  }

  #recordStaleFailure(
    key: string,
    stale: ReadyCacheEntry,
    refreshFailure: RefreshFailure,
    unavailableIntegrations: readonly IntegrationName[],
  ): ReadyItemFeasibilityResult {
    const failed: ReadyCacheEntry = {
      ...stale,
      retryAfter: Math.min(stale.staleUntil, this.#now() + this.#ttlMs),
      refreshFailure,
      unavailableIntegrations,
    };
    this.#cache.set(key, failed);
    return staleResult(failed, refreshFailure, unavailableIntegrations);
  }

  async #build(selection: ItemFeasibilitySelection): Promise<ItemFeasibilityBuildResult> {
    const inventory = await this.#options.readInventory();
    const source = inventory.status === "disabled"
      ? undefined
      : inventory.sources.find(({ integration }) => integration === selection.application);
    if (source === undefined || source.status === "disabled") {
      return disabled(selection, this.#missing(selection));
    }
    if (source.status === "integration_failure") {
      return {
        kind: "item-feasibility",
        mode: "read_only",
        status: "inventory_unavailable",
        selection,
        state: source.state,
        ...(source.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: source.retryAfterSeconds }),
      };
    }
    const item = source.page.items.find((candidate) =>
      candidate.application === selection.application &&
      candidate.kind === selection.kind &&
      candidate.itemId === selection.itemId
    );
    if (item === undefined) {
      return { kind: "item-feasibility", mode: "read_only", status: "not_found", selection };
    }
    const missing = this.#missing(selection);
    if (missing.length > 0) return disabled(selection, missing);

    if (selection.kind === "episode") {
      const builder = this.#options.episode;
      if (builder === undefined) return disabled(selection, ["sonarr", "bazarr", "subdl"]);
      const outcome = await builder.build(episodeRequest(item, this.#options.subdlLanguages));
      return { kind: "item-feasibility", selection, ...outcome };
    }
    const builder = this.#options.movie;
    if (builder === undefined) return disabled(selection, ["radarr", "bazarr", "subdl"]);
    const outcome = await builder.build(movieRequest(item, this.#options.subdlLanguages));
    return { kind: "item-feasibility", selection, ...outcome };
  }

  #missing(selection: ItemFeasibilitySelection) {
    return selection.kind === "episode"
      ? this.#options.missingIntegrations.episode
      : this.#options.missingIntegrations.movie;
  }
}

function staleFailure(result: ItemFeasibilityBuildResult): {
  readonly reason: "inventory_unavailable" | "integration_failure";
  readonly integrations: readonly IntegrationName[];
} | undefined {
  if (result.status === "inventory_unavailable") {
    return { reason: "inventory_unavailable", integrations: [result.selection.application] };
  }
  if (result.status !== "integration_failure") return undefined;
  return {
    reason: "integration_failure",
    integrations: [...new Set(result.failures.map(({ integration }) => integration))],
  };
}

function staleResult(
  cached: {
    readonly value: ReadyItemFeasibilityResult;
    readonly staleUntil: number;
  },
  refreshFailure: RefreshFailure,
  unavailableIntegrations: readonly IntegrationName[],
): ReadyItemFeasibilityResult {
  return {
    ...cached.value,
    analysis: {
      ...cached.value.analysis,
      source: "stale_cache",
      refreshFailure,
      unavailableIntegrations,
      staleUntil: new Date(cached.staleUntil).toISOString(),
    },
  };
}

function episodeRequest(
  item: MissingMediaItem,
  subdlLanguages: readonly ProviderLanguageMapping[],
): SonarrEpisodeFeasibilityRequest {
  if (item.kind !== "episode" || item.parentId === undefined || item.season === undefined || item.episode === undefined) {
    throw new TypeError("Missing episode inventory evidence is incomplete");
  }
  return {
    episodeId: item.itemId,
    sonarrSeriesId: item.parentId,
    item: {
      kind: "episode",
      title: item.parentTitle ?? item.title,
      season: item.season,
      episode: item.episode,
      ids: item.ids,
    },
    subdlLanguages,
  };
}

function movieRequest(
  item: MissingMediaItem,
  subdlLanguages: readonly ProviderLanguageMapping[],
): RadarrMovieFeasibilityRequest {
  if (item.kind !== "movie") throw new TypeError("Missing movie inventory evidence is incomplete");
  return {
    movieId: item.itemId,
    item: {
      kind: "movie",
      title: item.title,
      ...(item.year === undefined ? {} : { year: item.year }),
      ids: item.ids,
    },
    subdlLanguages,
  };
}

function validateSelection(selection: ItemFeasibilitySelection): ItemFeasibilitySelection {
  if (!Number.isSafeInteger(selection.itemId) || selection.itemId < 1) {
    throw new TypeError("itemId must be a positive integer");
  }
  if (
    (selection.application !== "sonarr" || selection.kind !== "episode") &&
    (selection.application !== "radarr" || selection.kind !== "movie")
  ) {
    throw new TypeError("Unsupported item feasibility selection");
  }
  return selection;
}

function disabled(
  selection: ItemFeasibilitySelection,
  missingIntegrations: readonly ("sonarr" | "radarr" | "bazarr" | "subdl")[],
): ItemFeasibilityResult {
  return { kind: "item-feasibility", mode: "read_only", status: "disabled", selection, missingIntegrations };
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
