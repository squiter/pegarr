import { randomBytes } from "node:crypto";

import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { BazarrClient } from "./adapters/bazarr.js";
import {
  RadarrAdapterError,
  RadarrClient,
  type RadarrSystemStatus,
} from "./adapters/radarr.js";
import {
  SonarrAdapterError,
  SonarrClient,
  type SonarrSystemStatus,
} from "./adapters/sonarr.js";
import { createConfiguredSubdlSource } from "./configured-subdl-source.js";
import { createConfiguredOpenSubtitlesSource } from "./configured-opensubtitles-source.js";
import {
  configuredRadarrInstances,
  configuredSonarrInstances,
  type SecretValue,
  type ArrRuntimeConfiguration,
  type RuntimeConfiguration,
} from "./config.js";
import { SonarrEpisodeFeasibilityService } from "./episode-feasibility.js";
import {
  buildMissingInventory,
  type MissingInventoryResult,
} from "./inventory-missing.js";
import {
  ItemFeasibilityService,
  type ItemFeasibilityReadOptions,
  type ItemFeasibilityResult,
  type ItemFeasibilitySelection,
} from "./item-feasibility.js";
import { RadarrMovieFeasibilityService } from "./movie-feasibility.js";
import {
  ControlledGrabService,
  type ExecuteGrabResult,
  type PrepareGrabResult,
  type PublicGrabAuditEntry,
  type ReconcileGrabResult,
} from "./controlled-grab.js";
import type { GrabReconciliationOutcome } from "./grab-audit.js";
import { GrabAuditStore } from "./grab-audit.js";
import type { ControlledGrabSelection } from "./grab-selection.js";
import type { CatalogMediaItem, SonarrSeriesReleaseScopes } from "./domain.js";
import type { ArrCatalogAddOptions, ArrCatalogAddReceipt } from "./domain.js";
import type { MediaIdentity, ProviderSearchResult } from "./domain.js";
import type { FeasibilityReport } from "./domain.js";
import { buildFeasibilityReport } from "./matching.js";
import { searchProviderPolicy } from "./provider-policy-search.js";
import type { ProviderLanguageMapping } from "./provider-policy-search.js";
import {
  ProviderSettingsStore,
  type ConfigurableProviderId,
  type ProviderSettingsInput,
} from "./provider-settings.js";
import {
  SubtitleSettingsStore,
  type SubtitleSettingsInput,
  type SubtitleSettingsSnapshot,
} from "./subtitle-settings.js";

export type ArrIntegrationState =
  | "disabled"
  | "available"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unexpected_status"
  | "invalid_response";

export interface ArrIntegrationStatus<
  Integration extends "sonarr" | "radarr",
  AppName extends "Sonarr" | "Radarr",
> {
  readonly integration: Integration;
  readonly mode: "read_only";
  readonly configured: boolean;
  readonly state: ArrIntegrationState;
  readonly appName?: AppName;
  readonly version?: string;
  readonly isDocker?: boolean;
  readonly retryAfterSeconds?: number;
  readonly transportSecurity?: "https" | "explicit_http";
  readonly latencyMs?: number;
  readonly responseBytes?: number;
  readonly observedAt?: string;
}

export type SonarrIntegrationStatus = ArrIntegrationStatus<"sonarr", "Sonarr">;
export type RadarrIntegrationStatus = ArrIntegrationStatus<"radarr", "Radarr">;
export type ArrInstanceIntegrationStatus =
  | (SonarrIntegrationStatus & { readonly instanceId: string; readonly configured: true })
  | (RadarrIntegrationStatus & { readonly instanceId: string; readonly configured: true });

export interface CatalogSearchResult {
  readonly kind: "catalog-search";
  readonly mode: "read_only";
  readonly status: "available" | "partial" | "disabled" | "unavailable";
  readonly query: string;
  readonly items: readonly CatalogMediaItem[];
  readonly sources: readonly {
    readonly application: "sonarr" | "radarr";
    readonly instanceId: string;
    readonly status: "available" | "unavailable";
  }[];
  readonly capabilities?: { readonly catalogAdd: boolean };
}

export interface SubtitleSettingsView extends SubtitleSettingsSnapshot {
  readonly kind: "subtitle-settings";
  readonly mode: "settings";
  readonly providers: readonly {
    readonly provider: "subdl" | "opensubtitles";
    readonly configured: boolean;
    readonly origin: "ui" | "deployment" | "unconfigured";
    readonly languageMappings: readonly { readonly policyCode: string; readonly providerCode: string }[];
  }[];
}

export interface OnboardingStatus {
  readonly kind: "onboarding-status";
  readonly mode: "read_only";
  readonly status: "ready" | "setup_required";
  readonly requirements: {
    readonly arrCatalog: {
      readonly status: "ready" | "missing";
      readonly sonarrInstances: number;
      readonly radarrInstances: number;
    };
    readonly subtitlePolicy: {
      readonly status: "ready" | "missing";
      readonly languageCount: number;
    };
    readonly subtitleProvider: {
      readonly status: "ready" | "missing";
      readonly providers: readonly ("subdl" | "opensubtitles")[];
    };
  };
  readonly capabilities: {
    readonly catalogSearch: boolean;
    readonly subtitlePreview: boolean;
    readonly catalogAdd: boolean;
    readonly controlledGrab: boolean;
  };
}

export interface CatalogCoverageSelection {
  readonly application: "sonarr" | "radarr";
  readonly instanceId: string;
  readonly providerId: "tvdb" | "tmdb";
  readonly value: string;
}

export type CatalogAddSelection = CatalogCoverageSelection;

export interface CatalogAddInput {
  readonly rootFolderId: number;
  readonly qualityProfileId: number;
  readonly monitored: boolean;
  readonly monitor?: "all" | "future" | "missing" | "existing" | "firstSeason" | "lastSeason" | "pilot" | "recent" | "none";
  readonly minimumAvailability?: "announced" | "inCinemas" | "released";
}

export interface CatalogAddOptionsResult extends ArrCatalogAddOptions {
  readonly kind: "catalog-add-options";
  readonly mode: "catalog_add";
  readonly title: string;
  readonly defaults: {
    readonly monitored: true;
    readonly monitor?: "all";
    readonly minimumAvailability?: "released";
  };
}

export interface CatalogAddResult {
  readonly kind: "catalog-add";
  readonly mode: "catalog_add";
  readonly status: ArrCatalogAddReceipt["status"];
  readonly receipt: ArrCatalogAddReceipt;
  readonly next:
    | { readonly action: "exact_movie_release_analysis"; readonly continuationId: string; readonly expiresAt: string }
    | { readonly action: "choose_series_scope"; readonly continuationId: string; readonly expiresAt: string };
}

export type CatalogContinuationScope =
  | { readonly kind: "season"; readonly seasonNumber: number }
  | { readonly kind: "episode"; readonly episodeId: number };

export interface CatalogContinuationScopesResult {
  readonly kind: "catalog-continuation-scopes";
  readonly mode: "read_only";
  readonly status: "ready";
  readonly title: string;
  readonly seasons: readonly { readonly seasonNumber: number; readonly label: string; readonly episodeCount: number }[];
  readonly episodes: readonly { readonly episodeId: number; readonly seasonNumber: number; readonly episodeNumber: number; readonly title: string }[];
}

type CatalogContinuationSelection =
  | { readonly application: "radarr"; readonly instanceId: string; readonly kind: "movie"; readonly itemId: number }
  | { readonly application: "sonarr"; readonly instanceId: string; readonly kind: "season"; readonly itemId: number; readonly seasonNumber: number }
  | { readonly application: "sonarr"; readonly instanceId: string; readonly kind: "episode"; readonly itemId: number; readonly parentId: number };

interface CatalogContinuationMetrics {
  readonly radarrRequests?: 1;
  readonly sonarrRequests?: 1;
  readonly bazarrRequests: 0;
  readonly providerRequests: number;
  readonly elapsedMs: number;
}

export type CatalogContinuationAnalysisResult =
  | {
      readonly kind: "item-feasibility";
      readonly mode: "read_only";
      readonly status: "ready";
      readonly selection: CatalogContinuationSelection;
      readonly report: FeasibilityReport;
      readonly metrics: CatalogContinuationMetrics;
      readonly analysis: { readonly source: "computed"; readonly generatedAt: string; readonly expiresAt: string; readonly staleUntil: string };
      readonly capabilities: { readonly controlledGrab: boolean };
    }
  | {
      readonly kind: "item-feasibility";
      readonly mode: "read_only";
      readonly status: "policy_unresolved";
      readonly reason: "explicit_default_unconfigured";
      readonly selection: CatalogContinuationSelection;
    }
  | {
      readonly kind: "item-feasibility";
      readonly mode: "read_only";
      readonly status: "disabled";
      readonly selection: CatalogContinuationSelection;
      readonly missingIntegrations: readonly ["subdl"];
    }
  | {
      readonly kind: "item-feasibility";
      readonly mode: "read_only";
      readonly status: "integration_failure";
      readonly selection: CatalogContinuationSelection;
      readonly failures: readonly [{ readonly integration: "sonarr" | "radarr"; readonly operation: "release_search"; readonly state: ArrIntegrationState; readonly retryAfterSeconds?: number }];
      readonly releases: readonly [];
      readonly metrics: CatalogContinuationMetrics;
    }
  | { readonly kind: "catalog-continuation"; readonly mode: "read_only"; readonly status: "not_found" | "scope_required" | "scope_not_found" };

export type CatalogCoverageResult =
  | {
      readonly kind: "catalog-subtitle-coverage";
      readonly mode: "read_only";
      readonly status: "ready";
      readonly item: CatalogMediaItem;
      readonly policy: SubtitleSettingsSnapshot["policy"];
      readonly languages: readonly {
        readonly code: string;
        readonly state: "available" | "no_match_found" | "unknown" | "unsupported";
        readonly subtitleCount: number;
      }[];
      readonly providers: readonly Pick<ProviderSearchResult, "provider" | "status" | "searchedLanguages" | "quota" | "cache">[];
      readonly providerRequests: number;
    }
  | {
      readonly kind: "catalog-subtitle-coverage";
      readonly mode: "read_only";
      readonly status: "policy_unresolved" | "item_not_found" | "provider_unconfigured";
    };

export interface RuntimeServices {
  readSonarrStatus(): Promise<SonarrIntegrationStatus>;
  readRadarrStatus(): Promise<RadarrIntegrationStatus>;
  readonly readArrInstanceStatuses?: () => Promise<readonly ArrInstanceIntegrationStatus[]>;
  searchCatalog(query: string, application?: "sonarr" | "radarr"): Promise<CatalogSearchResult>;
  readSubtitleSettings(): Promise<SubtitleSettingsView>;
  readonly readOnboardingStatus?: () => Promise<OnboardingStatus>;
  updateSubtitleSettings(input: SubtitleSettingsInput): Promise<SubtitleSettingsView>;
  updateProviderSettings(provider: ConfigurableProviderId, input: ProviderSettingsInput): Promise<SubtitleSettingsView>;
  previewCatalogCoverage(selection: CatalogCoverageSelection): Promise<CatalogCoverageResult>;
  readonly catalogAdd?: {
    readOptions(selection: CatalogAddSelection): Promise<CatalogAddOptionsResult>;
    add(selection: CatalogAddSelection, input: CatalogAddInput): Promise<CatalogAddResult>;
  };
  readonly catalogContinuation?: {
    scopes(continuationId: string): Promise<CatalogContinuationScopesResult | { readonly kind: "catalog-continuation"; readonly mode: "read_only"; readonly status: "not_found" | "scope_required" }>;
    analyze(continuationId: string, scope?: CatalogContinuationScope): Promise<CatalogContinuationAnalysisResult>;
    prepareGrab(continuationId: string, releaseId: string, scope?: CatalogContinuationScope): Promise<PrepareGrabResult>;
    executeGrab(continuationId: string, challengeId: string, confirmation: string, idempotencyKey: string, scope?: CatalogContinuationScope): Promise<ExecuteGrabResult>;
  };
  readMissingInventory(): Promise<MissingInventoryResult>;
  readItemFeasibility(
    selection: ItemFeasibilitySelection,
    options?: ItemFeasibilityReadOptions,
  ): Promise<ItemFeasibilityResult>;
  readonly controlledGrab?: {
    prepare(selection: ItemFeasibilitySelection, releaseId: string): Promise<PrepareGrabResult>;
    execute(selection: ItemFeasibilitySelection, challengeId: string, confirmation: string, idempotencyKey: string): Promise<ExecuteGrabResult>;
    history(limit?: number): readonly PublicGrabAuditEntry[];
    reconcile(eventId: string, outcome: GrabReconciliationOutcome, confirmation: string): ReconcileGrabResult;
  };
  close(): void;
}

export interface RuntimeServicesOptions {
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly sonarrStatusTtlMs?: number;
  readonly radarrStatusTtlMs?: number;
  readonly missingInventoryTtlMs?: number;
  readonly missingInventoryPageSize?: number;
  readonly itemFeasibilityTtlMs?: number;
  readonly itemFeasibilityStaleTtlMs?: number;
  readonly itemFeasibilityMaxEntries?: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly dataDirectory?: string;
}

interface CatalogContinuationEntry {
  readonly application: "sonarr" | "radarr";
  readonly instanceId: string;
  readonly itemId: number;
  readonly item: MediaIdentity;
  readonly expiresAtEpochMs: number;
  scopes?: Promise<SonarrSeriesReleaseScopes>;
  readonly analyses: Map<string, Promise<CatalogContinuationAnalysisResult>>;
}

const catalogContinuationTtlMs = 10 * 60 * 1_000;
const catalogContinuationMaxEntries = 100;

interface AdapterErrorShape {
  readonly code: Exclude<ArrIntegrationState, "disabled" | "available">;
  readonly retryAfterSeconds: number | undefined;
}

interface StatusClient<Status> {
  readSystemStatus(): Promise<Status>;
}

interface StatusReaderSpec<
  Integration extends "sonarr" | "radarr",
  AppName extends "Sonarr" | "Radarr",
  Status extends {
    readonly appName: AppName;
    readonly version: string;
    readonly isDocker?: boolean;
    readonly responseBytes?: number;
  },
> {
  readonly integration: Integration;
  readonly configuration: ArrRuntimeConfiguration | undefined;
  readonly createClient: (transport: FetchJsonTransport) => StatusClient<Status>;
  readonly isAdapterError: (error: unknown) => error is AdapterErrorShape;
  readonly fetchImplementation: FetchImplementation | undefined;
  readonly now: () => number;
  readonly ttlMs: number;
}

const defaultStatusTtlMs = 30_000;

export function createRuntimeServices(
  configuration: RuntimeConfiguration,
  options: RuntimeServicesOptions = {},
): RuntimeServices {
  const {
    accessToken: _accessToken,
    login: _login,
    controlledGrab: _controlledGrab,
    catalogAdd: _catalogAdd,
    ...inventoryConfiguration
  } = configuration;
  const now = options.now ?? Date.now;
  const subtitleSettings = new SubtitleSettingsStore(
    options.dataDirectory ?? options.environment?.DATA_DIR ?? "./data",
  );
  const providerSettings = new ProviderSettingsStore(
    options.dataDirectory ?? options.environment?.DATA_DIR ?? "./data",
  );
  const sonarrConfigurations = configuredSonarrInstances(configuration);
  const radarrConfigurations = configuredRadarrInstances(configuration);
  const primarySonarrConfiguration = sonarrConfigurations[0];
  const primaryRadarrConfiguration = radarrConfigurations[0];
  const createSonarrStatusReader = (arrConfiguration: ArrRuntimeConfiguration | undefined) => createStatusReader<"sonarr", "Sonarr", SonarrSystemStatus>({
    integration: "sonarr",
    configuration: arrConfiguration,
    createClient: (transport) =>
      new SonarrClient(
        {
          instanceId: arrConfiguration?.instanceId ?? "sonarr",
          apiKey: arrConfiguration?.apiKey.reveal() ?? "unreachable-disabled-key",
        },
        transport,
      ),
    isAdapterError: (error): error is SonarrAdapterError => error instanceof SonarrAdapterError,
    fetchImplementation: options.fetchImplementation,
    now,
    ttlMs: boundedCacheTtl(
      options.sonarrStatusTtlMs ?? defaultStatusTtlMs,
      "sonarrStatusTtlMs",
    ),
  });
  const createRadarrStatusReader = (arrConfiguration: ArrRuntimeConfiguration | undefined) => createStatusReader<"radarr", "Radarr", RadarrSystemStatus>({
    integration: "radarr",
    configuration: arrConfiguration,
    createClient: (transport) =>
      new RadarrClient(
        {
          instanceId: arrConfiguration?.instanceId ?? "radarr",
          apiKey: arrConfiguration?.apiKey.reveal() ?? "unreachable-disabled-key",
        },
        transport,
      ),
    isAdapterError: (error): error is RadarrAdapterError => error instanceof RadarrAdapterError,
    fetchImplementation: options.fetchImplementation,
    now,
    ttlMs: boundedCacheTtl(
      options.radarrStatusTtlMs ?? defaultStatusTtlMs,
      "radarrStatusTtlMs",
    ),
  });
  const readSonarrStatus = createSonarrStatusReader(primarySonarrConfiguration);
  const readRadarrStatus = createRadarrStatusReader(primaryRadarrConfiguration);
  const sonarrInstanceStatusReaders = sonarrConfigurations.map((arrConfiguration, index) => ({
    instanceId: arrConfiguration.instanceId,
    read: index === 0 ? readSonarrStatus : createSonarrStatusReader(arrConfiguration),
  }));
  const radarrInstanceStatusReaders = radarrConfigurations.map((arrConfiguration, index) => ({
    instanceId: arrConfiguration.instanceId,
    read: index === 0 ? readRadarrStatus : createRadarrStatusReader(arrConfiguration),
  }));
  const readMissingInventory = createMissingInventoryReader(inventoryConfiguration, {
    fetchImplementation: options.fetchImplementation,
    now,
    ttlMs: boundedCacheTtl(
      options.missingInventoryTtlMs ?? defaultStatusTtlMs,
      "missingInventoryTtlMs",
    ),
    pageSize: options.missingInventoryPageSize ?? inventoryConfiguration.missingPageSize ?? 50,
  });

  const fetchOption = options.fetchImplementation === undefined
    ? {}
    : { fetchImplementation: options.fetchImplementation };
  const sonarrClients = new Map(sonarrConfigurations.map((arrConfiguration) => [
    arrConfiguration.instanceId,
    new SonarrClient(
        {
          instanceId: arrConfiguration.instanceId,
          apiKey: arrConfiguration.apiKey.reveal(),
          timeoutMs: 60_000,
        },
        new FetchJsonTransport({
          baseUrl: arrConfiguration.baseUrl,
          allowedHosts: arrConfiguration.allowedHosts,
          allowInsecureHttp: arrConfiguration.allowInsecureHttp,
          ...fetchOption,
        }),
      ),
  ]));
  const radarrClients = new Map(radarrConfigurations.map((arrConfiguration) => [
    arrConfiguration.instanceId,
    new RadarrClient(
        {
          instanceId: arrConfiguration.instanceId,
          apiKey: arrConfiguration.apiKey.reveal(),
          timeoutMs: 60_000,
        },
        new FetchJsonTransport({
          baseUrl: arrConfiguration.baseUrl,
          allowedHosts: arrConfiguration.allowedHosts,
          allowInsecureHttp: arrConfiguration.allowInsecureHttp,
          ...fetchOption,
        }),
      ),
  ]));
  const bazarrClient = configuration.bazarr === undefined
    ? undefined
    : new BazarrClient(
        {
          instanceId: configuration.bazarr.instanceId,
          apiKey: configuration.bazarr.apiKey.reveal(),
        },
        new FetchJsonTransport({
          baseUrl: configuration.bazarr.baseUrl,
          allowedHosts: configuration.bazarr.allowedHosts,
          allowInsecureHttp: configuration.bazarr.allowInsecureHttp,
          ...fetchOption,
        }),
      );
  const managedSubdl = configuration.subdl === undefined
    ? undefined
    : createConfiguredSubdlSource({
        configuration: configuration.subdl,
        transport: new FetchJsonTransport({
          baseUrl: configuration.subdl.baseUrl,
          allowedHosts: configuration.subdl.allowedHosts,
          allowInsecureHttp: configuration.subdl.allowInsecureHttp,
          ...fetchOption,
        }),
        environment: options.environment ?? {},
      });
  const managedOpenSubtitles = configuration.opensubtitles === undefined
    ? undefined
    : createConfiguredOpenSubtitlesSource({
        configuration: configuration.opensubtitles,
        transport: new FetchJsonTransport({
          baseUrl: configuration.opensubtitles.baseUrl,
          allowedHosts: configuration.opensubtitles.allowedHosts,
          allowInsecureHttp: configuration.opensubtitles.allowInsecureHttp,
          ...fetchOption,
        }),
        environment: options.environment ?? {},
      });
  let uiManagedSubdl: ReturnType<typeof createConfiguredSubdlSource> | undefined;
  let uiManagedOpenSubtitles: ReturnType<typeof createConfiguredOpenSubtitlesSource> | undefined;
  let uiProviderRevision = -1;

  const resetUiProviders = (): void => {
    uiManagedSubdl?.close();
    uiManagedOpenSubtitles?.close();
    uiManagedSubdl = undefined;
    uiManagedOpenSubtitles = undefined;
    uiProviderRevision = -1;
  };

  const resolveCatalogProviders = async (kind: CatalogMediaItem["kind"] | "episode"): Promise<readonly {
    readonly provider: "subdl" | "opensubtitles";
    readonly tier: "preferred" | "fallback";
    readonly mappings: readonly ProviderLanguageMapping[];
    readonly source: import("./provider-policy-search.js").SubdlWindowSource;
  }[]> => {
    const settings = await providerSettings.read();
    if (settings.revision !== uiProviderRevision) {
      resetUiProviders();
      const subdlCredential = await providerSettings.readCredential("subdl");
      if (subdlCredential !== undefined) {
        uiManagedSubdl = createUiSubdlSource(subdlCredential, fetchOption, options.environment ?? {});
      }
      const openSubtitlesCredential = await providerSettings.readCredential("opensubtitles");
      if (openSubtitlesCredential !== undefined) {
        uiManagedOpenSubtitles = createUiOpenSubtitlesSource(openSubtitlesCredential, fetchOption, options.environment ?? {});
      }
      uiProviderRevision = settings.revision;
    }
    const subdlSettings = settings.providers.find(({ provider }) => provider === "subdl");
    const openSubtitlesSettings = settings.providers.find(({ provider }) => provider === "opensubtitles");
    const effectiveSubdl = uiManagedSubdl ?? managedSubdl;
    const effectiveOpenSubtitles = uiManagedOpenSubtitles ?? managedOpenSubtitles;
    return [
      ...(effectiveSubdl === undefined ? [] : [{
        provider: "subdl" as const,
        tier: "preferred" as const,
        mappings: subdlSettings?.settingsConfigured === true
          ? subdlSettings.languageMappings
          : configuration.subdlLanguageMappings ?? [],
        source: effectiveSubdl.source,
      }]),
      ...(effectiveOpenSubtitles === undefined || kind === "series" ? [] : [{
        provider: "opensubtitles" as const,
        tier: "fallback" as const,
        mappings: openSubtitlesSettings?.settingsConfigured === true
          ? openSubtitlesSettings.languageMappings
          : configuration.opensubtitlesLanguageMappings ?? [],
        source: effectiveOpenSubtitles.source,
      }]),
    ];
  };
  let itemFeasibility: ItemFeasibilityService | undefined;
  let itemFeasibilityProviderRevision = -1;
  const resolveItemFeasibility = async (): Promise<ItemFeasibilityService> => {
    const providers = await resolveCatalogProviders("episode");
    if (
      itemFeasibility !== undefined
      && itemFeasibilityProviderRevision === uiProviderRevision
    ) {
      return itemFeasibility;
    }
    const subdl = providers.find(({ provider }) => provider === "subdl");
    const opensubtitles = providers.find(({ provider }) => provider === "opensubtitles");
    const providerMissing = providers.length === 0;
    const missingIntegrations = {
      episode: [
        ...(sonarrClients.size === 0 ? ["sonarr" as const] : []),
        ...(bazarrClient === undefined ? ["bazarr" as const] : []),
        ...(providerMissing ? ["subdl" as const] : []),
      ],
      movie: [
        ...(radarrClients.size === 0 ? ["radarr" as const] : []),
        ...(bazarrClient === undefined ? ["bazarr" as const] : []),
        ...(providerMissing ? ["subdl" as const] : []),
      ],
    };
    itemFeasibility = new ItemFeasibilityService({
      readInventory: readMissingInventory,
      ...(sonarrClients.size === 0 || bazarrClient === undefined || providerMissing
        ? {}
        : {
            episodeForInstance: (instanceId: string) => {
              const sonarr = sonarrClients.get(instanceId);
              return sonarr === undefined ? undefined : new SonarrEpisodeFeasibilityService({
                sonarr,
                bazarr: bazarrClient,
                providers,
                now,
              });
            },
          }),
      ...(radarrClients.size === 0 || bazarrClient === undefined || providerMissing
        ? {}
        : {
            movieForInstance: (instanceId: string) => {
              const radarr = radarrClients.get(instanceId);
              return radarr === undefined ? undefined : new RadarrMovieFeasibilityService({
                radarr,
                bazarr: bazarrClient,
                providers,
                now,
              });
            },
          }),
      subdlLanguages: subdl?.mappings ?? [],
      opensubtitlesLanguages: opensubtitles?.mappings ?? [],
      missingIntegrations,
      now,
      ttlMs: boundedCacheTtl(
        options.itemFeasibilityTtlMs ?? defaultStatusTtlMs,
        "itemFeasibilityTtlMs",
      ),
      ...(options.itemFeasibilityStaleTtlMs === undefined
        ? {}
        : { staleTtlMs: options.itemFeasibilityStaleTtlMs }),
      maxEntries: options.itemFeasibilityMaxEntries ?? 100,
    });
    itemFeasibilityProviderRevision = uiProviderRevision;
    return itemFeasibility;
  };

  const controlledGrab = configuration.controlledGrab === undefined
    ? undefined
    : new ControlledGrabService({
        readInventory: readMissingInventory,
        ...(sonarrClients.size === 0
          ? {}
          : {
              sonarr: {
                revalidate: (selection: ControlledGrabSelection, releaseId: string) => {
                  if (selection.application !== "sonarr") {
                    throw new TypeError("Sonarr Grab selection is inconsistent");
                  }
                  const client = selection.instanceId === undefined ? undefined : sonarrClients.get(selection.instanceId);
                  if (client === undefined) throw new TypeError("Sonarr Grab instance is inconsistent");
                  return selection.kind === "season"
                    ? client.revalidateSeasonRelease(selection.itemId, selection.seasonNumber, releaseId)
                    : client.revalidateEpisodeRelease(selection.itemId, releaseId);
                },
                grab: (handle, selection) => {
                  const client = selection.instanceId === undefined ? undefined : sonarrClients.get(selection.instanceId);
                  if (client === undefined) throw new TypeError("Sonarr Grab instance is inconsistent");
                  return client.grabRelease(handle);
                },
              },
            }),
        ...(radarrClients.size === 0
          ? {}
          : {
              radarr: {
                revalidate: (selection: ItemFeasibilitySelection, releaseId: string) => {
                  if (selection.application !== "radarr" || selection.kind !== "movie") {
                    throw new TypeError("Radarr Grab selection is inconsistent");
                  }
                  const client = selection.instanceId === undefined ? undefined : radarrClients.get(selection.instanceId);
                  if (client === undefined) throw new TypeError("Radarr Grab instance is inconsistent");
                  return client.revalidateMovieRelease(selection.itemId, releaseId);
                },
                grab: (handle, selection) => {
                  const client = selection.instanceId === undefined ? undefined : radarrClients.get(selection.instanceId);
                  if (client === undefined) throw new TypeError("Radarr Grab instance is inconsistent");
                  return client.grabRelease(handle);
                },
              },
            }),
        audit: new GrabAuditStore(configuration.controlledGrab.auditFile, now),
        now,
      });

  const subtitleSettingsView = async (): Promise<SubtitleSettingsView> => {
    const storedProviders = await providerSettings.read();
    const providerView = (provider: ConfigurableProviderId): SubtitleSettingsView["providers"][number] => {
      const stored = storedProviders.providers.find((entry) => entry.provider === provider);
      const deploymentConfigured = provider === "subdl" ? managedSubdl !== undefined : managedOpenSubtitles !== undefined;
      const uiConfigured = stored?.credentialConfigured === true;
      return {
        provider,
        configured: uiConfigured || deploymentConfigured,
        origin: uiConfigured ? "ui" : deploymentConfigured ? "deployment" : "unconfigured",
        languageMappings: stored?.settingsConfigured === true
          ? stored.languageMappings
          : provider === "subdl"
            ? configuration.subdlLanguageMappings ?? []
            : configuration.opensubtitlesLanguageMappings ?? [],
      };
    };
    return {
      kind: "subtitle-settings",
      mode: "settings",
      ...(await subtitleSettings.read()),
      providers: [providerView("subdl"), providerView("opensubtitles")],
    };
  };

  const catalogContinuations = new Map<string, CatalogContinuationEntry>();
  const pruneCatalogContinuations = (): void => {
    const currentTime = now();
    for (const [id, entry] of catalogContinuations) {
      if (entry.expiresAtEpochMs <= currentTime) catalogContinuations.delete(id);
    }
    while (catalogContinuations.size >= catalogContinuationMaxEntries) {
      const oldest = catalogContinuations.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      catalogContinuations.delete(oldest);
    }
  };
  const createCatalogContinuation = (
    receipt: ArrCatalogAddReceipt,
    item: CatalogMediaItem,
  ): { readonly continuationId: string; readonly expiresAt: string } => {
    pruneCatalogContinuations();
    let continuationId: string;
    do continuationId = randomBytes(24).toString("base64url"); while (catalogContinuations.has(continuationId));
    const expiresAtEpochMs = now() + catalogContinuationTtlMs;
    catalogContinuations.set(continuationId, {
      application: receipt.application,
      instanceId: receipt.instanceId,
      itemId: receipt.itemId,
      item: {
        kind: item.kind,
        title: item.title,
        ...(item.year === undefined ? {} : { year: item.year }),
        ids: item.ids,
      },
      expiresAtEpochMs,
      analyses: new Map(),
    });
    return { continuationId, expiresAt: new Date(expiresAtEpochMs).toISOString() };
  };
  const buildRadarrContinuation = async (entry: CatalogContinuationEntry): Promise<CatalogContinuationAnalysisResult> => {
    const selection = { application: "radarr" as const, instanceId: entry.instanceId, kind: "movie" as const, itemId: entry.itemId };
    const settings = await subtitleSettings.read();
    if (settings.status !== "configured") {
      return { kind: "item-feasibility", mode: "read_only", status: "policy_unresolved", reason: "explicit_default_unconfigured", selection };
    }
    const providers = await resolveCatalogProviders("movie");
    if (providers.length === 0) {
      return { kind: "item-feasibility", mode: "read_only", status: "disabled", selection, missingIntegrations: ["subdl"] };
    }
    const client = radarrClients.get(entry.instanceId);
    if (client === undefined) return { kind: "catalog-continuation", mode: "read_only", status: "not_found" };
    const startedAt = now();
    let releases: Awaited<ReturnType<RadarrClient["searchMovieReleases"]>>;
    try {
      releases = await client.searchMovieReleases(entry.itemId);
    } catch (error) {
      const adapterError = error instanceof RadarrAdapterError ? error : undefined;
      return {
        kind: "item-feasibility", mode: "read_only", status: "integration_failure", selection,
        failures: [{
          integration: "radarr", operation: "release_search", state: adapterError?.code ?? "unavailable",
          ...(adapterError?.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: adapterError.retryAfterSeconds }),
        }],
        releases: [],
        metrics: { radarrRequests: 1, bazarrRequests: 0, providerRequests: 0, elapsedMs: boundedElapsed(startedAt, now()) },
      };
    }
    const searched = await searchProviderPolicy({ item: entry.item, policy: settings.policy, releases, providers });
    const generatedAt = now();
    return {
      kind: "item-feasibility",
      mode: "read_only",
      status: "ready",
      selection,
      report: buildFeasibilityReport({
        fixture: "catalog-continuation-radarr-movie-v1",
        item: entry.item,
        policy: settings.policy,
        releases,
        providerResults: searched.results,
      }),
      metrics: { radarrRequests: 1, bazarrRequests: 0, providerRequests: searched.requestCount, elapsedMs: boundedElapsed(startedAt, generatedAt) },
      analysis: {
        source: "computed",
        generatedAt: new Date(generatedAt).toISOString(),
        expiresAt: new Date(entry.expiresAtEpochMs).toISOString(),
        staleUntil: new Date(entry.expiresAtEpochMs).toISOString(),
      },
      capabilities: { controlledGrab: controlledGrab !== undefined },
    };
  };
  const readSonarrContinuationScopes = async (entry: CatalogContinuationEntry): Promise<SonarrSeriesReleaseScopes> => {
    const client = sonarrClients.get(entry.instanceId);
    if (client === undefined) throw new TypeError("Catalog continuation instance is unavailable");
    entry.scopes ??= client.readSeriesReleaseScopes(entry.itemId).catch((error) => {
      delete entry.scopes;
      throw error;
    });
    const scopes = await entry.scopes;
    if (scopes.seasons.length === 0 && scopes.episodes.length === 0) delete entry.scopes;
    return scopes;
  };
  const buildSonarrContinuation = async (
    entry: CatalogContinuationEntry,
    scope: CatalogContinuationScope,
    scopes: SonarrSeriesReleaseScopes,
  ): Promise<CatalogContinuationAnalysisResult> => {
    const selectedSeason = scope.kind === "season"
      ? scopes.seasons.find(({ seasonNumber }) => seasonNumber === scope.seasonNumber)
      : undefined;
    const selectedEpisode = scope.kind === "episode"
      ? scopes.episodes.find(({ episodeId }) => episodeId === scope.episodeId)
      : undefined;
    if (selectedSeason === undefined && selectedEpisode === undefined) {
      return { kind: "catalog-continuation", mode: "read_only", status: "scope_not_found" };
    }
    const selection: CatalogContinuationSelection = selectedEpisode === undefined
      ? { application: "sonarr", instanceId: entry.instanceId, kind: "season", itemId: entry.itemId, seasonNumber: selectedSeason?.seasonNumber ?? 0 }
      : { application: "sonarr", instanceId: entry.instanceId, kind: "episode", itemId: selectedEpisode.episodeId, parentId: entry.itemId };
    const item: MediaIdentity = selectedEpisode === undefined
      ? {
          ...entry.item,
          kind: "season",
          season: selectedSeason?.seasonNumber ?? 0,
        }
      : {
          ...entry.item,
          kind: "episode",
          season: selectedEpisode.seasonNumber,
          episode: selectedEpisode.episodeNumber,
        };
    const settings = await subtitleSettings.read();
    if (settings.status !== "configured") {
      return { kind: "item-feasibility", mode: "read_only", status: "policy_unresolved", reason: "explicit_default_unconfigured", selection };
    }
    const providers = await resolveCatalogProviders(selectedEpisode === undefined ? "series" : "episode");
    if (providers.length === 0) {
      return { kind: "item-feasibility", mode: "read_only", status: "disabled", selection, missingIntegrations: ["subdl"] };
    }
    const client = sonarrClients.get(entry.instanceId);
    if (client === undefined) return { kind: "catalog-continuation", mode: "read_only", status: "not_found" };
    const startedAt = now();
    let releases: Awaited<ReturnType<SonarrClient["searchEpisodeReleases"]>>;
    try {
      releases = selectedEpisode === undefined
        ? await client.searchSeasonReleases(entry.itemId, selectedSeason?.seasonNumber ?? 0)
        : await client.searchEpisodeReleases(selectedEpisode.episodeId);
    } catch (error) {
      const adapterError = error instanceof SonarrAdapterError ? error : undefined;
      return {
        kind: "item-feasibility", mode: "read_only", status: "integration_failure", selection,
        failures: [{
          integration: "sonarr", operation: "release_search", state: adapterError?.code ?? "unavailable",
          ...(adapterError?.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: adapterError.retryAfterSeconds }),
        }],
        releases: [],
        metrics: { sonarrRequests: 1, bazarrRequests: 0, providerRequests: 0, elapsedMs: boundedElapsed(startedAt, now()) },
      };
    }
    const searched = await searchProviderPolicy({ item, policy: settings.policy, releases, providers });
    const generatedAt = now();
    return {
      kind: "item-feasibility",
      mode: "read_only",
      status: "ready",
      selection,
      report: buildFeasibilityReport({
        fixture: selectedEpisode === undefined ? "catalog-continuation-sonarr-season-v1" : "catalog-continuation-sonarr-episode-v1",
        item,
        policy: settings.policy,
        releases,
        providerResults: searched.results,
      }),
      metrics: { sonarrRequests: 1, bazarrRequests: 0, providerRequests: searched.requestCount, elapsedMs: boundedElapsed(startedAt, generatedAt) },
      analysis: {
        source: "computed",
        generatedAt: new Date(generatedAt).toISOString(),
        expiresAt: new Date(entry.expiresAtEpochMs).toISOString(),
        staleUntil: new Date(entry.expiresAtEpochMs).toISOString(),
      },
      capabilities: { controlledGrab: controlledGrab !== undefined },
    };
  };
  const readCatalogContinuationEntry = (continuationId: string): CatalogContinuationEntry | undefined => {
    if (!/^[A-Za-z0-9_-]{32}$/u.test(continuationId)) throw new TypeError("Catalog continuation ID is invalid");
    pruneCatalogContinuations();
    return catalogContinuations.get(continuationId);
  };
  const catalogGrabTarget = async (
    entry: CatalogContinuationEntry,
    scope?: CatalogContinuationScope,
  ): Promise<{ readonly selection: ControlledGrabSelection; readonly targetLabel: string } | undefined> => {
    if (entry.application === "radarr") {
      if (scope !== undefined) return undefined;
      return {
        selection: { application: "radarr", instanceId: entry.instanceId, kind: "movie", itemId: entry.itemId },
        targetLabel: `${entry.item.title}${entry.item.year === undefined ? "" : ` (${entry.item.year})`}`,
      };
    }
    if (scope === undefined) return undefined;
    const scopes = await readSonarrContinuationScopes(entry);
    if (scope.kind === "season") {
      const season = scopes.seasons.find(({ seasonNumber }) => seasonNumber === scope.seasonNumber);
      if (season === undefined) return undefined;
      return {
        selection: { application: "sonarr", instanceId: entry.instanceId, kind: "season", itemId: entry.itemId, seasonNumber: season.seasonNumber },
        targetLabel: `${entry.item.title} ${season.label}`,
      };
    }
    const episode = scopes.episodes.find(({ episodeId }) => episodeId === scope.episodeId);
    if (episode === undefined) return undefined;
    return {
      selection: { application: "sonarr", instanceId: entry.instanceId, kind: "episode", itemId: episode.episodeId },
      targetLabel: `${entry.item.title} S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")} · ${episode.title}`,
    };
  };
  const catalogContinuation = configuration.catalogAdd === undefined
    ? undefined
    : {
        scopes: async (continuationId: string): Promise<CatalogContinuationScopesResult | { readonly kind: "catalog-continuation"; readonly mode: "read_only"; readonly status: "not_found" | "scope_required" }> => {
          const entry = readCatalogContinuationEntry(continuationId);
          if (entry === undefined) return { kind: "catalog-continuation", mode: "read_only", status: "not_found" };
          if (entry.application !== "sonarr") return { kind: "catalog-continuation", mode: "read_only", status: "scope_required" };
          const scopes = await readSonarrContinuationScopes(entry);
          return { kind: "catalog-continuation-scopes", mode: "read_only", status: "ready", title: entry.item.title, ...scopes };
        },
        analyze: async (continuationId: string, scope?: CatalogContinuationScope): Promise<CatalogContinuationAnalysisResult> => {
          const entry = readCatalogContinuationEntry(continuationId);
          if (entry === undefined) return { kind: "catalog-continuation", mode: "read_only", status: "not_found" };
          if (entry.application === "sonarr" && scope === undefined) return { kind: "catalog-continuation", mode: "read_only", status: "scope_required" };
          if (entry.application === "radarr" && scope !== undefined) throw new TypeError("Radarr continuation does not accept a series scope");
          const key = scope === undefined ? "movie" : `${scope.kind}:${scope.kind === "season" ? scope.seasonNumber : scope.episodeId}`;
          let analysis = entry.analyses.get(key);
          if (analysis === undefined) {
            analysis = scope === undefined
              ? buildRadarrContinuation(entry)
              : readSonarrContinuationScopes(entry).then((scopes) => buildSonarrContinuation(entry, scope, scopes));
            analysis = analysis.catch((error) => {
              entry.analyses.delete(key);
              throw error;
            });
            entry.analyses.set(key, analysis);
          }
          return analysis;
        },
        prepareGrab: async (continuationId: string, releaseId: string, scope?: CatalogContinuationScope): Promise<PrepareGrabResult> => {
          if (controlledGrab === undefined) return { status: "item_unavailable", mode: "controlled_grab", detailCode: "integration_disabled" };
          const entry = readCatalogContinuationEntry(continuationId);
          if (entry === undefined) return { status: "item_unavailable", mode: "controlled_grab", detailCode: "continuation_missing_or_expired" };
          const target = await catalogGrabTarget(entry, scope);
          if (target === undefined) return { status: "item_unavailable", mode: "controlled_grab", detailCode: "scope_not_grabbable" };
          return controlledGrab.prepareTarget(target, releaseId);
        },
        executeGrab: async (
          continuationId: string,
          challengeId: string,
          confirmation: string,
          idempotencyKey: string,
          scope?: CatalogContinuationScope,
        ): Promise<ExecuteGrabResult> => {
          if (controlledGrab === undefined) return { status: "challenge_expired", mode: "controlled_grab", detailCode: "integration_disabled" };
          const entry = readCatalogContinuationEntry(continuationId);
          if (entry === undefined) return { status: "challenge_expired", mode: "controlled_grab", detailCode: "continuation_missing_or_expired" };
          const target = await catalogGrabTarget(entry, scope);
          if (target === undefined) return { status: "confirmation_mismatch", mode: "controlled_grab", detailCode: "challenge_target_mismatch" };
          return controlledGrab.execute(target.selection, challengeId, confirmation, idempotencyKey);
        },
      };

  const catalogAdd = configuration.catalogAdd === undefined
    ? undefined
    : {
        readOptions: async (selection: CatalogAddSelection): Promise<CatalogAddOptionsResult> => {
          const item = await resolveCatalogCoverageItem(selection, sonarrClients, radarrClients);
          if (item === undefined) throw new TypeError("Catalog item is no longer available");
          const client = selection.application === "sonarr"
            ? sonarrClients.get(selection.instanceId)
            : radarrClients.get(selection.instanceId);
          if (client === undefined) throw new TypeError("Catalog instance is unavailable");
          const options = await client.readCatalogAddOptions();
          return {
            kind: "catalog-add-options",
            mode: "catalog_add",
            title: item.title,
            ...options,
            defaults: selection.application === "sonarr"
              ? { monitored: true, monitor: "all" }
              : { monitored: true, minimumAvailability: "released" },
          };
        },
        add: async (selection: CatalogAddSelection, input: CatalogAddInput): Promise<CatalogAddResult> => {
          const item = await resolveCatalogCoverageItem(selection, sonarrClients, radarrClients);
          if (item === undefined) throw new TypeError("Catalog item is no longer available");
          const receipt = selection.application === "sonarr"
            ? await requireClient(sonarrClients.get(selection.instanceId)).addCatalogSeries({
                tvdbId: Number(selection.value),
                rootFolderId: input.rootFolderId,
                qualityProfileId: input.qualityProfileId,
                monitored: input.monitored,
                monitor: input.monitor ?? "all",
              })
            : await requireClient(radarrClients.get(selection.instanceId)).addCatalogMovie({
                tmdbId: Number(selection.value),
                rootFolderId: input.rootFolderId,
                qualityProfileId: input.qualityProfileId,
                monitored: input.monitored,
                minimumAvailability: input.minimumAvailability ?? "released",
              });
          const continuation = createCatalogContinuation(receipt, item);
          return {
            kind: "catalog-add",
            mode: "catalog_add",
            status: receipt.status,
            receipt,
            next: receipt.application === "radarr"
              ? { action: "exact_movie_release_analysis", ...continuation }
              : { action: "choose_series_scope", ...continuation },
          };
        },
      };

  return {
    readSonarrStatus,
    readRadarrStatus,
    readArrInstanceStatuses: async () => Promise.all([
      ...sonarrInstanceStatusReaders.map(async ({ instanceId, read }) => ({ ...(await read()), instanceId, configured: true as const })),
      ...radarrInstanceStatusReaders.map(async ({ instanceId, read }) => ({ ...(await read()), instanceId, configured: true as const })),
    ]),
    searchCatalog: async (query, application) => {
      const normalizedQuery = boundedCatalogQuery(query);
      const sources = [
        ...(application === "radarr" ? [] : [...sonarrClients].map(([instanceId, client]) => ({
          application: "sonarr" as const,
          instanceId,
          read: () => client.lookupSeries(normalizedQuery),
        }))),
        ...(application === "sonarr" ? [] : [...radarrClients].map(([instanceId, client]) => ({
          application: "radarr" as const,
          instanceId,
          read: () => client.lookupMovies(normalizedQuery),
        }))),
      ];
      if (sources.length === 0) {
        return { kind: "catalog-search", mode: "read_only", status: "disabled", query: normalizedQuery, items: [], sources: [], capabilities: { catalogAdd: catalogAdd !== undefined } };
      }
      const settled = await Promise.allSettled(sources.map(({ read }) => read()));
      const sourceStatus = sources.map(({ application: sourceApplication, instanceId }, index) => ({
        application: sourceApplication,
        instanceId,
        status: settled[index]?.status === "fulfilled" ? "available" as const : "unavailable" as const,
      }));
      const items = settled.flatMap((result) => result.status === "fulfilled" ? [...result.value] : []);
      const availableCount = sourceStatus.filter(({ status }) => status === "available").length;
      return {
        kind: "catalog-search",
        mode: "read_only",
        status: availableCount === sources.length ? "available" : availableCount === 0 ? "unavailable" : "partial",
        query: normalizedQuery,
        items,
        sources: sourceStatus,
        capabilities: { catalogAdd: catalogAdd !== undefined },
      };
    },
    readSubtitleSettings: subtitleSettingsView,
    readOnboardingStatus: async () => {
      const settings = await subtitleSettingsView();
      const providers = settings.providers
        .filter(({ configured }) => configured)
        .map(({ provider }) => provider);
      const arrReady = sonarrClients.size + radarrClients.size > 0;
      const policyReady = settings.status === "configured";
      const providerReady = providers.length > 0;
      return {
        kind: "onboarding-status",
        mode: "read_only",
        status: arrReady && policyReady && providerReady ? "ready" : "setup_required",
        requirements: {
          arrCatalog: {
            status: arrReady ? "ready" : "missing",
            sonarrInstances: sonarrClients.size,
            radarrInstances: radarrClients.size,
          },
          subtitlePolicy: {
            status: policyReady ? "ready" : "missing",
            languageCount: settings.policy.languages.length,
          },
          subtitleProvider: {
            status: providerReady ? "ready" : "missing",
            providers,
          },
        },
        capabilities: {
          catalogSearch: arrReady,
          subtitlePreview: arrReady && policyReady && providerReady,
          catalogAdd: catalogAdd !== undefined,
          controlledGrab: controlledGrab !== undefined,
        },
      };
    },
    updateSubtitleSettings: async (input) => {
      await subtitleSettings.update(input);
      return subtitleSettingsView();
    },
    updateProviderSettings: async (provider, input) => {
      await providerSettings.update(provider, input);
      resetUiProviders();
      return subtitleSettingsView();
    },
    previewCatalogCoverage: async (selection) => {
      const settings = await subtitleSettings.read();
      if (settings.status !== "configured") {
        return { kind: "catalog-subtitle-coverage", mode: "read_only", status: "policy_unresolved" };
      }
      const catalogItem = await resolveCatalogCoverageItem(selection, sonarrClients, radarrClients);
      if (catalogItem === undefined) {
        return { kind: "catalog-subtitle-coverage", mode: "read_only", status: "item_not_found" };
      }
      const providers = await resolveCatalogProviders(catalogItem.kind);
      if (providers.length === 0) {
        return { kind: "catalog-subtitle-coverage", mode: "read_only", status: "provider_unconfigured" };
      }
      const item: MediaIdentity = {
        kind: catalogItem.kind,
        title: catalogItem.title,
        ...(catalogItem.year === undefined ? {} : { year: catalogItem.year }),
        ids: catalogItem.ids,
      };
      const searched = await searchProviderPolicy({ item, policy: settings.policy, releases: [], providers });
      return {
        kind: "catalog-subtitle-coverage",
        mode: "read_only",
        status: "ready",
        item: catalogItem,
        policy: settings.policy,
        languages: settings.policy.languages.map(({ code }) => summarizeCatalogLanguage(code, searched.results)),
        providers: searched.results.map(({ provider, status, searchedLanguages, quota, cache }) => ({
          provider,
          status,
          ...(searchedLanguages === undefined ? {} : { searchedLanguages }),
          ...(quota === undefined ? {} : { quota }),
          ...(cache === undefined ? {} : { cache }),
        })),
        providerRequests: searched.requestCount,
      };
    },
    ...(catalogAdd === undefined ? {} : { catalogAdd }),
    ...(catalogContinuation === undefined ? {} : { catalogContinuation }),
    readMissingInventory,
    readItemFeasibility: async (selection, readOptions) =>
      (await resolveItemFeasibility()).read(selection, readOptions),
    ...(controlledGrab === undefined
      ? {}
      : {
          controlledGrab: {
            prepare: (selection, releaseId) => controlledGrab.prepare(selection, releaseId),
            execute: (selection, challengeId, confirmation, idempotencyKey) => controlledGrab.execute(selection, challengeId, confirmation, idempotencyKey),
            history: (limit) => controlledGrab.history(limit),
            reconcile: (eventId, outcome, confirmation) => controlledGrab.reconcile(eventId, outcome, confirmation),
          },
        }),
    close: () => {
      controlledGrab?.close();
      managedSubdl?.close();
      managedOpenSubtitles?.close();
      resetUiProviders();
    },
  };
}

function createUiSubdlSource(
  apiKey: SecretValue,
  fetchOption: { readonly fetchImplementation?: FetchImplementation },
  environment: Readonly<Record<string, string | undefined>>,
): ReturnType<typeof createConfiguredSubdlSource> {
  const configuration = {
    instanceId: "subdl",
    baseUrl: "https://api.subdl.com",
    allowedHosts: ["api.subdl.com"],
    allowInsecureHttp: false,
    apiKey,
  };
  return createConfiguredSubdlSource({
    configuration,
    transport: new FetchJsonTransport({
      baseUrl: configuration.baseUrl,
      allowedHosts: configuration.allowedHosts,
      allowInsecureHttp: false,
      ...fetchOption,
    }),
    environment,
  });
}

function createUiOpenSubtitlesSource(
  apiKey: SecretValue,
  fetchOption: { readonly fetchImplementation?: FetchImplementation },
  environment: Readonly<Record<string, string | undefined>>,
): ReturnType<typeof createConfiguredOpenSubtitlesSource> {
  const configuration = {
    instanceId: "opensubtitles",
    baseUrl: "https://api.opensubtitles.com/api/v1",
    allowedHosts: ["api.opensubtitles.com"],
    allowInsecureHttp: false,
    apiKey,
  };
  return createConfiguredOpenSubtitlesSource({
    configuration,
    transport: new FetchJsonTransport({
      baseUrl: configuration.baseUrl,
      allowedHosts: configuration.allowedHosts,
      allowInsecureHttp: false,
      ...fetchOption,
    }),
    environment,
  });
}

function boundedElapsed(startedAt: number, completedAt: number): number {
  return Number.isFinite(startedAt) && Number.isFinite(completedAt)
    ? Math.max(0, Math.min(180_000, Math.round(completedAt - startedAt)))
    : 0;
}

function requireClient<Client>(client: Client | undefined): Client {
  if (client === undefined) throw new TypeError("Catalog instance is unavailable");
  return client;
}

async function resolveCatalogCoverageItem(
  selection: CatalogCoverageSelection,
  sonarrClients: ReadonlyMap<string, SonarrClient>,
  radarrClients: ReadonlyMap<string, RadarrClient>,
): Promise<CatalogMediaItem | undefined> {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(selection.instanceId) || !/^\d{1,16}$/u.test(selection.value)) {
    throw new TypeError("Catalog coverage selection is invalid");
  }
  if (selection.application === "sonarr") {
    if (selection.providerId !== "tvdb") throw new TypeError("Sonarr catalog coverage requires a TVDB ID");
    const client = sonarrClients.get(selection.instanceId);
    if (client === undefined) return undefined;
    return (await client.lookupSeries(`tvdb:${selection.value}`)).find(({ ids }) => ids.tvdb === selection.value);
  }
  if (selection.providerId !== "tmdb") throw new TypeError("Radarr catalog coverage requires a TMDB ID");
  const client = radarrClients.get(selection.instanceId);
  if (client === undefined) return undefined;
  return (await client.lookupMovies(`tmdb:${selection.value}`)).find(({ ids }) => ids.tmdb === selection.value);
}

function summarizeCatalogLanguage(
  code: string,
  results: readonly ProviderSearchResult[],
): { readonly code: string; readonly state: "available" | "no_match_found" | "unknown" | "unsupported"; readonly subtitleCount: number } {
  const relevant = results.filter(({ searchedLanguages }) => searchedLanguages?.includes(code) === true);
  const subtitleCount = relevant.reduce((total, { subtitles }) => total + subtitles.length, 0);
  if (subtitleCount > 0) return { code, state: "available", subtitleCount };
  if (relevant.some(({ status }) => status !== "success" && status !== "unsupported")) return { code, state: "unknown", subtitleCount: 0 };
  if (relevant.some(({ status }) => status === "success")) return { code, state: "no_match_found", subtitleCount: 0 };
  return { code, state: "unsupported", subtitleCount: 0 };
}

function boundedCatalogQuery(value: string): string {
  const query = value.trim();
  if (query.length < 2 || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query)) {
    throw new TypeError("catalog query must contain 2 through 200 safe characters");
  }
  return query;
}

function createMissingInventoryReader(
  configuration: RuntimeConfiguration,
  options: {
    readonly fetchImplementation: FetchImplementation | undefined;
    readonly now: () => number;
    readonly ttlMs: number;
    readonly pageSize: number;
  },
): () => Promise<MissingInventoryResult> {
  let cached: { readonly value: MissingInventoryResult; readonly expiresAt: number } | undefined;
  let inFlight: Promise<MissingInventoryResult> | undefined;
  const read = async (): Promise<MissingInventoryResult> => {
    const value = await buildMissingInventory({
      configuration,
      pageSize: options.pageSize,
      ...(options.fetchImplementation === undefined
        ? {}
        : { fetchImplementation: options.fetchImplementation }),
      now: options.now,
    });
    cached = { value, expiresAt: options.now() + options.ttlMs };
    return value;
  };

  return async () => {
    const requestedAt = options.now();
    if (cached !== undefined && requestedAt < cached.expiresAt) return cached.value;
    if (inFlight !== undefined) return inFlight;
    const current = read();
    inFlight = current;
    try {
      return await current;
    } finally {
      if (inFlight === current) inFlight = undefined;
    }
  };
}

function createStatusReader<
  Integration extends "sonarr" | "radarr",
  AppName extends "Sonarr" | "Radarr",
  Status extends {
    readonly appName: AppName;
    readonly version: string;
    readonly isDocker?: boolean;
    readonly responseBytes?: number;
  },
>(
  spec: StatusReaderSpec<Integration, AppName, Status>,
): () => Promise<ArrIntegrationStatus<Integration, AppName>> {
  const integrationConfiguration = spec.configuration;
  if (integrationConfiguration === undefined) {
    const disabled: ArrIntegrationStatus<Integration, AppName> = {
      integration: spec.integration,
      mode: "read_only",
      configured: false,
      state: "disabled",
    };
    return async () => disabled;
  }

  const transport = new FetchJsonTransport({
    baseUrl: integrationConfiguration.baseUrl,
    allowedHosts: integrationConfiguration.allowedHosts,
    allowInsecureHttp: integrationConfiguration.allowInsecureHttp,
    ...(spec.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: spec.fetchImplementation }),
  });
  const client = spec.createClient(transport);
  const transportSecurity =
    new URL(integrationConfiguration.baseUrl).protocol === "https:" ? "https" : "explicit_http";
  let cachedStatus:
    | {
        readonly value: ArrIntegrationStatus<Integration, AppName>;
        readonly expiresAt: number;
      }
    | undefined;
  let inFlight: Promise<ArrIntegrationStatus<Integration, AppName>> | undefined;

  const probeStatus = async (
    startedAt: number,
  ): Promise<ArrIntegrationStatus<Integration, AppName>> => {
    let value: ArrIntegrationStatus<Integration, AppName>;
    try {
      const status = await client.readSystemStatus();
      value = {
        integration: spec.integration,
        mode: "read_only",
        configured: true,
        state: "available",
        appName: status.appName,
        version: status.version,
        transportSecurity,
        ...(status.isDocker === undefined ? {} : { isDocker: status.isDocker }),
        ...(status.responseBytes === undefined ? {} : { responseBytes: status.responseBytes }),
      };
    } catch (error) {
      if (spec.isAdapterError(error)) {
        value = {
          integration: spec.integration,
          mode: "read_only",
          configured: true,
          state: error.code,
          transportSecurity,
          ...(error.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: error.retryAfterSeconds }),
        };
      } else {
        value = {
          integration: spec.integration,
          mode: "read_only",
          configured: true,
          state: "unavailable",
          transportSecurity,
        };
      }
    }
    const completedAt = spec.now();
    const measured = {
      ...value,
      latencyMs: safeElapsedMilliseconds(startedAt, completedAt),
      observedAt: safeTimestamp(completedAt),
    };
    cachedStatus = { value: measured, expiresAt: completedAt + spec.ttlMs };
    return measured;
  };

  return async () => {
    const requestedAt = spec.now();
    if (cachedStatus !== undefined && requestedAt < cachedStatus.expiresAt) {
      return cachedStatus.value;
    }
    if (inFlight !== undefined) {
      return inFlight;
    }
    const currentProbe = probeStatus(requestedAt);
    inFlight = currentProbe;
    try {
      return await currentProbe;
    } finally {
      if (inFlight === currentProbe) {
        inFlight = undefined;
      }
    }
  };
}

function boundedCacheTtl(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 5 * 60_000) {
    throw new TypeError(`${name} must be an integer between 0 and 300000`);
  }
  return value;
}

function safeElapsedMilliseconds(startedAt: number, completedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) {
    return 0;
  }
  return Math.max(0, Math.min(60_000, Math.round(completedAt - startedAt)));
}

function safeTimestamp(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 8.64e15) {
    return new Date(0).toISOString();
  }
  return new Date(value).toISOString();
}
