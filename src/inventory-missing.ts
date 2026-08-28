import { pathToFileURL } from "node:url";

import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { RadarrAdapterError, RadarrClient } from "./adapters/radarr.js";
import { SonarrAdapterError, SonarrClient } from "./adapters/sonarr.js";
import {
  configuredRadarrInstances,
  configuredSonarrInstances,
  loadRuntimeConfiguration,
  type RuntimeConfiguration,
  type ServiceRuntimeConfiguration,
} from "./config.js";
import type { MissingItemPage } from "./domain.js";

export interface MissingInventoryOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly write: (value: string) => void;
}

type InventoryFailureState =
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unexpected_status"
  | "invalid_response";

export type InventorySource =
  | {
      readonly integration: "sonarr" | "radarr";
      readonly status: "disabled";
    }
  | {
      readonly integration: "sonarr" | "radarr";
      readonly instanceId?: string;
      readonly status: "ready";
      readonly page: MissingItemPage;
    }
  | {
      readonly integration: "sonarr" | "radarr";
      readonly instanceId?: string;
      readonly status: "integration_failure";
      readonly state: InventoryFailureState;
      readonly retryAfterSeconds?: number;
    };

export type MissingInventoryResult =
  | {
      readonly kind: "missing-item-inventory";
      readonly mode: "read_only";
      readonly status: "disabled";
    }
  | {
      readonly kind: "missing-item-inventory";
      readonly mode: "read_only";
      readonly status: "ready" | "partial" | "integration_failure";
      readonly sources: readonly InventorySource[];
      readonly metrics: {
        readonly requestCount: number;
        readonly itemCount: number;
        readonly elapsedMs: number;
      };
    };

export interface MissingInventoryBuildOptions {
  readonly configuration: RuntimeConfiguration;
  readonly pageSize?: number;
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
}

export async function runMissingInventory(options: MissingInventoryOptions): Promise<number> {
  try {
    const configuration = await loadRuntimeConfiguration(options.environment);
    const output = await buildMissingInventory({
      configuration,
      pageSize: configuration.missingPageSize ?? 50,
      ...(options.fetchImplementation === undefined
        ? {}
        : { fetchImplementation: options.fetchImplementation }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    options.write(`${JSON.stringify(output)}\n`);
    return output.status === "disabled" ? 2 : output.status === "integration_failure" ? 1 : 0;
  } catch {
    writeState(options, "invalid_configuration");
    return 2;
  }
}

export async function buildMissingInventory(
  options: MissingInventoryBuildOptions,
): Promise<MissingInventoryResult> {
  const pageSize = boundedPageSize(options.pageSize ?? 50);
  const sonarrConfigurations = configuredSonarrInstances(options.configuration);
  const radarrConfigurations = configuredRadarrInstances(options.configuration);
  if (sonarrConfigurations.length === 0 && radarrConfigurations.length === 0) {
    return { kind: "missing-item-inventory", mode: "read_only", status: "disabled" };
  }
  const now = options.now ?? Date.now;
  const startedAt = now();
  const sources = await Promise.all([
    ...(sonarrConfigurations.length === 0
      ? [Promise.resolve({ integration: "sonarr", status: "disabled" } as const)]
      : sonarrConfigurations.map((configuration) => readSonarr(configuration, pageSize, options.fetchImplementation))),
    ...(radarrConfigurations.length === 0
      ? [Promise.resolve({ integration: "radarr", status: "disabled" } as const)]
      : radarrConfigurations.map((configuration) => readRadarr(configuration, pageSize, options.fetchImplementation))),
  ]);
  const readyCount = sources.filter((source) => source.status === "ready").length;
  const failureCount = sources.filter((source) => source.status === "integration_failure").length;
  const status = readyCount === 0
    ? "integration_failure"
    : failureCount === 0
      ? "ready"
      : "partial";
  return {
    kind: "missing-item-inventory",
    mode: "read_only",
    status,
    sources,
    metrics: {
      requestCount: sources.filter((source) => source.status !== "disabled").length,
      itemCount: sources.reduce(
        (count, source) => count + (source.status === "ready" ? source.page.items.length : 0),
        0,
      ),
      elapsedMs: safeElapsed(startedAt, now()),
    },
  };
}

async function readSonarr(
  configuration: ServiceRuntimeConfiguration | undefined,
  pageSize: number,
  fetchImplementation: FetchImplementation | undefined,
): Promise<InventorySource> {
  if (configuration === undefined) return { integration: "sonarr", status: "disabled" };
  try {
    const transport = transportFor(configuration, fetchImplementation);
    const page = await new SonarrClient({
      instanceId: configuration.instanceId,
      apiKey: configuration.apiKey.reveal(),
      timeoutMs: 30_000,
    }, transport).listMissingEpisodes({ page: 1, pageSize });
    return { integration: "sonarr", instanceId: configuration.instanceId, status: "ready", page };
  } catch (error) {
    return failure("sonarr", configuration.instanceId, error);
  }
}

async function readRadarr(
  configuration: ServiceRuntimeConfiguration | undefined,
  pageSize: number,
  fetchImplementation: FetchImplementation | undefined,
): Promise<InventorySource> {
  if (configuration === undefined) return { integration: "radarr", status: "disabled" };
  try {
    const transport = transportFor(configuration, fetchImplementation);
    const page = await new RadarrClient({
      instanceId: configuration.instanceId,
      apiKey: configuration.apiKey.reveal(),
      timeoutMs: 30_000,
    }, transport).listMissingMovies({ page: 1, pageSize });
    return { integration: "radarr", instanceId: configuration.instanceId, status: "ready", page };
  } catch (error) {
    return failure("radarr", configuration.instanceId, error);
  }
}

function transportFor(
  configuration: ServiceRuntimeConfiguration,
  fetchImplementation: FetchImplementation | undefined,
): FetchJsonTransport {
  return new FetchJsonTransport({
    baseUrl: configuration.baseUrl,
    allowedHosts: configuration.allowedHosts,
    allowInsecureHttp: configuration.allowInsecureHttp,
    ...(fetchImplementation === undefined ? {} : { fetchImplementation }),
  });
}

function failure(integration: "sonarr" | "radarr", instanceId: string, error: unknown): InventorySource {
  const adapterError = error instanceof SonarrAdapterError || error instanceof RadarrAdapterError
    ? error
    : undefined;
  return {
    integration,
    instanceId,
    status: "integration_failure",
    state: adapterError?.code ?? "unavailable",
    ...(adapterError?.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: adapterError.retryAfterSeconds }),
  };
}

function boundedPageSize(pageSize: number): number {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new TypeError("Invalid missing inventory page size");
  }
  return pageSize;
}

function safeElapsed(startedAt: number, completedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) return 0;
  return Math.max(0, Math.min(60_000, Math.round(completedAt - startedAt)));
}

function writeState(
  options: MissingInventoryOptions,
  status: "disabled" | "invalid_configuration",
): void {
  options.write(`${JSON.stringify({
    kind: "missing-item-inventory",
    mode: "read_only",
    status,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runMissingInventory({
    environment: process.env,
    write: (value) => process.stdout.write(value),
  });
}
