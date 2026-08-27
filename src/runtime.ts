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
import type { ArrRuntimeConfiguration, RuntimeConfiguration } from "./config.js";
import { SonarrEpisodeFeasibilityService } from "./episode-feasibility.js";
import {
  buildMissingInventory,
  type MissingInventoryResult,
} from "./inventory-missing.js";
import {
  ItemFeasibilityService,
  type ItemFeasibilityResult,
  type ItemFeasibilitySelection,
} from "./item-feasibility.js";
import { RadarrMovieFeasibilityService } from "./movie-feasibility.js";

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

export interface RuntimeServices {
  readSonarrStatus(): Promise<SonarrIntegrationStatus>;
  readRadarrStatus(): Promise<RadarrIntegrationStatus>;
  readMissingInventory(): Promise<MissingInventoryResult>;
  readItemFeasibility(selection: ItemFeasibilitySelection): Promise<ItemFeasibilityResult>;
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
  readonly itemFeasibilityMaxEntries?: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
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
  const { accessToken: _accessToken, ...inventoryConfiguration } = configuration;
  const now = options.now ?? Date.now;
  const readSonarrStatus = createStatusReader<"sonarr", "Sonarr", SonarrSystemStatus>({
    integration: "sonarr",
    configuration: configuration.sonarr,
    createClient: (transport) =>
      new SonarrClient(
        {
          instanceId: configuration.sonarr?.instanceId ?? "sonarr",
          apiKey: configuration.sonarr?.apiKey.reveal() ?? "unreachable-disabled-key",
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
  const readRadarrStatus = createStatusReader<"radarr", "Radarr", RadarrSystemStatus>({
    integration: "radarr",
    configuration: configuration.radarr,
    createClient: (transport) =>
      new RadarrClient(
        {
          instanceId: configuration.radarr?.instanceId ?? "radarr",
          apiKey: configuration.radarr?.apiKey.reveal() ?? "unreachable-disabled-key",
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
  const sonarrClient = configuration.sonarr === undefined
    ? undefined
    : new SonarrClient(
        {
          instanceId: configuration.sonarr.instanceId,
          apiKey: configuration.sonarr.apiKey.reveal(),
          timeoutMs: 60_000,
        },
        new FetchJsonTransport({
          baseUrl: configuration.sonarr.baseUrl,
          allowedHosts: configuration.sonarr.allowedHosts,
          allowInsecureHttp: configuration.sonarr.allowInsecureHttp,
          ...fetchOption,
        }),
      );
  const radarrClient = configuration.radarr === undefined
    ? undefined
    : new RadarrClient(
        {
          instanceId: configuration.radarr.instanceId,
          apiKey: configuration.radarr.apiKey.reveal(),
          timeoutMs: 60_000,
        },
        new FetchJsonTransport({
          baseUrl: configuration.radarr.baseUrl,
          allowedHosts: configuration.radarr.allowedHosts,
          allowInsecureHttp: configuration.radarr.allowInsecureHttp,
          ...fetchOption,
        }),
      );
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
  const missingIntegrations = {
    episode: [
      ...(sonarrClient === undefined ? ["sonarr" as const] : []),
      ...(bazarrClient === undefined ? ["bazarr" as const] : []),
      ...(managedSubdl === undefined ? ["subdl" as const] : []),
    ],
    movie: [
      ...(radarrClient === undefined ? ["radarr" as const] : []),
      ...(bazarrClient === undefined ? ["bazarr" as const] : []),
      ...(managedSubdl === undefined ? ["subdl" as const] : []),
    ],
  };
  const itemFeasibility = new ItemFeasibilityService({
    readInventory: readMissingInventory,
    ...(sonarrClient === undefined || bazarrClient === undefined || managedSubdl === undefined
      ? {}
      : {
          episode: new SonarrEpisodeFeasibilityService({
            sonarr: sonarrClient,
            bazarr: bazarrClient,
            subdl: managedSubdl.source,
            now,
          }),
        }),
    ...(radarrClient === undefined || bazarrClient === undefined || managedSubdl === undefined
      ? {}
      : {
          movie: new RadarrMovieFeasibilityService({
            radarr: radarrClient,
            bazarr: bazarrClient,
            subdl: managedSubdl.source,
            now,
          }),
        }),
    subdlLanguages: configuration.subdlLanguageMappings ?? [],
    missingIntegrations,
    now,
    ttlMs: boundedCacheTtl(
      options.itemFeasibilityTtlMs ?? defaultStatusTtlMs,
      "itemFeasibilityTtlMs",
    ),
    maxEntries: options.itemFeasibilityMaxEntries ?? 100,
  });

  return {
    readSonarrStatus,
    readRadarrStatus,
    readMissingInventory,
    readItemFeasibility: (selection) => itemFeasibility.read(selection),
    close: () => managedSubdl?.close(),
  };
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
