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
import type { CatalogMediaItem } from "./domain.js";
import type { MediaIdentity, ProviderSearchResult } from "./domain.js";
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

export interface CatalogCoverageSelection {
  readonly application: "sonarr" | "radarr";
  readonly instanceId: string;
  readonly providerId: "tvdb" | "tmdb";
  readonly value: string;
}

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
  updateSubtitleSettings(input: SubtitleSettingsInput): Promise<SubtitleSettingsView>;
  updateProviderSettings(provider: ConfigurableProviderId, input: ProviderSettingsInput): Promise<SubtitleSettingsView>;
  previewCatalogCoverage(selection: CatalogCoverageSelection): Promise<CatalogCoverageResult>;
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

  const resolveCatalogProviders = async (kind: CatalogMediaItem["kind"]): Promise<readonly {
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
  const missingIntegrations = {
    episode: [
      ...(sonarrClients.size === 0 ? ["sonarr" as const] : []),
      ...(bazarrClient === undefined ? ["bazarr" as const] : []),
      ...(managedSubdl === undefined ? ["subdl" as const] : []),
    ],
    movie: [
      ...(radarrClients.size === 0 ? ["radarr" as const] : []),
      ...(bazarrClient === undefined ? ["bazarr" as const] : []),
      ...(managedSubdl === undefined ? ["subdl" as const] : []),
    ],
  };
  const itemFeasibility = new ItemFeasibilityService({
    readInventory: readMissingInventory,
    ...(sonarrClients.size === 0 || bazarrClient === undefined || managedSubdl === undefined
      ? {}
      : {
          episodeForInstance: (instanceId: string) => {
            const sonarr = sonarrClients.get(instanceId);
            return sonarr === undefined ? undefined : new SonarrEpisodeFeasibilityService({
              sonarr,
              bazarr: bazarrClient,
              subdl: managedSubdl.source,
              ...(managedOpenSubtitles === undefined
                ? {}
                : { opensubtitles: managedOpenSubtitles.source }),
              now,
            });
          },
        }),
    ...(radarrClients.size === 0 || bazarrClient === undefined || managedSubdl === undefined
      ? {}
      : {
          movieForInstance: (instanceId: string) => {
            const radarr = radarrClients.get(instanceId);
            return radarr === undefined ? undefined : new RadarrMovieFeasibilityService({
              radarr,
              bazarr: bazarrClient,
              subdl: managedSubdl.source,
              ...(managedOpenSubtitles === undefined
                ? {}
                : { opensubtitles: managedOpenSubtitles.source }),
              now,
            });
          },
        }),
    subdlLanguages: configuration.subdlLanguageMappings ?? [],
    opensubtitlesLanguages: configuration.opensubtitlesLanguageMappings ?? [],
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

  const controlledGrab = configuration.controlledGrab === undefined
    ? undefined
    : new ControlledGrabService({
        readInventory: readMissingInventory,
        ...(sonarrClients.size === 0
          ? {}
          : {
              sonarr: {
                revalidate: (selection: ItemFeasibilitySelection, releaseId: string) => {
                  if (selection.application !== "sonarr" || selection.kind !== "episode") {
                    throw new TypeError("Sonarr Grab selection is inconsistent");
                  }
                  const client = selection.instanceId === undefined ? undefined : sonarrClients.get(selection.instanceId);
                  if (client === undefined) throw new TypeError("Sonarr Grab instance is inconsistent");
                  return client.revalidateEpisodeRelease(selection.itemId, releaseId);
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
        return { kind: "catalog-search", mode: "read_only", status: "disabled", query: normalizedQuery, items: [], sources: [] };
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
      };
    },
    readSubtitleSettings: subtitleSettingsView,
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
    readMissingInventory,
    readItemFeasibility: (selection, readOptions) => itemFeasibility.read(selection, readOptions),
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
