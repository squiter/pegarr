import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { SonarrAdapterError, SonarrClient } from "./adapters/sonarr.js";
import type { RuntimeConfiguration } from "./config.js";

export type SonarrIntegrationState =
  | "disabled"
  | "available"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unexpected_status"
  | "invalid_response";

export interface SonarrIntegrationStatus {
  readonly integration: "sonarr";
  readonly mode: "read_only";
  readonly configured: boolean;
  readonly state: SonarrIntegrationState;
  readonly appName?: "Sonarr";
  readonly version?: string;
  readonly isDocker?: boolean;
  readonly retryAfterSeconds?: number;
  readonly transportSecurity?: "https" | "explicit_http";
  readonly latencyMs?: number;
  readonly responseBytes?: number;
  readonly observedAt?: string;
}

export interface RuntimeServices {
  readSonarrStatus(): Promise<SonarrIntegrationStatus>;
}

export interface RuntimeServicesOptions {
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly sonarrStatusTtlMs?: number;
}

const defaultSonarrStatusTtlMs = 30_000;

export function createRuntimeServices(
  configuration: RuntimeConfiguration,
  options: RuntimeServicesOptions = {},
): RuntimeServices {
  const sonarrConfiguration = configuration.sonarr;
  if (sonarrConfiguration === undefined) {
    return {
      async readSonarrStatus() {
        return {
          integration: "sonarr",
          mode: "read_only",
          configured: false,
          state: "disabled",
        };
      },
    };
  }

  const transport = new FetchJsonTransport({
    baseUrl: sonarrConfiguration.baseUrl,
    allowedHosts: sonarrConfiguration.allowedHosts,
    allowInsecureHttp: sonarrConfiguration.allowInsecureHttp,
    ...(options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation }),
  });
  const client = new SonarrClient(
    {
      instanceId: sonarrConfiguration.instanceId,
      apiKey: sonarrConfiguration.apiKey.reveal(),
    },
    transport,
  );
  const now = options.now ?? Date.now;
  const statusTtlMs = boundedCacheTtl(options.sonarrStatusTtlMs ?? defaultSonarrStatusTtlMs);
  const transportSecurity =
    new URL(sonarrConfiguration.baseUrl).protocol === "https:" ? "https" : "explicit_http";
  let cachedStatus:
    | { readonly value: SonarrIntegrationStatus; readonly expiresAt: number }
    | undefined;
  let inFlight: Promise<SonarrIntegrationStatus> | undefined;

  const probeStatus = async (startedAt: number): Promise<SonarrIntegrationStatus> => {
    let value: SonarrIntegrationStatus;
    try {
      const status = await client.readSystemStatus();
      value = {
        integration: "sonarr",
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
      if (error instanceof SonarrAdapterError) {
        value = {
          integration: "sonarr",
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
          integration: "sonarr",
          mode: "read_only",
          configured: true,
          state: "unavailable",
          transportSecurity,
        };
      }
    }
    const completedAt = now();
    const latencyMs = safeElapsedMilliseconds(startedAt, completedAt);
    const measured = { ...value, latencyMs, observedAt: safeTimestamp(completedAt) };
    cachedStatus = { value: measured, expiresAt: completedAt + statusTtlMs };
    return measured;
  };

  return {
    async readSonarrStatus() {
      const requestedAt = now();
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
    },
  };
}

function boundedCacheTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 5 * 60_000) {
    throw new TypeError("sonarrStatusTtlMs must be an integer between 0 and 300000");
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
