import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
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
import type { ArrRuntimeConfiguration, RuntimeConfiguration } from "./config.js";

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
}

export interface RuntimeServicesOptions {
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly sonarrStatusTtlMs?: number;
  readonly radarrStatusTtlMs?: number;
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

  return { readSonarrStatus, readRadarrStatus };
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
