import { pathToFileURL } from "node:url";

import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { RadarrAdapterError, RadarrClient } from "./adapters/radarr.js";
import { SonarrAdapterError, SonarrClient } from "./adapters/sonarr.js";
import { loadRuntimeConfiguration, type ServiceRuntimeConfiguration } from "./config.js";
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

type InventorySource =
  | {
      readonly integration: "sonarr" | "radarr";
      readonly status: "disabled";
    }
  | {
      readonly integration: "sonarr" | "radarr";
      readonly status: "ready";
      readonly page: MissingItemPage;
    }
  | {
      readonly integration: "sonarr" | "radarr";
      readonly status: "integration_failure";
      readonly state: InventoryFailureState;
      readonly retryAfterSeconds?: number;
    };

export async function runMissingInventory(options: MissingInventoryOptions): Promise<number> {
  try {
    const pageSize = parsePageSize(options.environment.PEGARR_MISSING_PAGE_SIZE);
    const configuration = await loadRuntimeConfiguration(options.environment);
    if (configuration.sonarr === undefined && configuration.radarr === undefined) {
      writeState(options, "disabled");
      return 2;
    }
    const now = options.now ?? Date.now;
    const startedAt = now();
    const [sonarr, radarr] = await Promise.all([
      readSonarr(configuration.sonarr, pageSize, options.fetchImplementation),
      readRadarr(configuration.radarr, pageSize, options.fetchImplementation),
    ]);
    const readyCount = [sonarr, radarr].filter((source) => source.status === "ready").length;
    const failureCount = [sonarr, radarr].filter(
      (source) => source.status === "integration_failure",
    ).length;
    const status = readyCount === 0
      ? "integration_failure"
      : failureCount === 0
        ? "ready"
        : "partial";
    const output = {
      kind: "missing-item-inventory",
      mode: "read_only",
      status,
      sources: [sonarr, radarr],
      metrics: {
        requestCount: [sonarr, radarr].filter((source) => source.status !== "disabled").length,
        itemCount: [sonarr, radarr].reduce(
          (count, source) => count + (source.status === "ready" ? source.page.items.length : 0),
          0,
        ),
        elapsedMs: safeElapsed(startedAt, now()),
      },
    };
    options.write(`${JSON.stringify(output)}\n`);
    return status === "integration_failure" ? 1 : 0;
  } catch {
    writeState(options, "invalid_configuration");
    return 2;
  }
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
    return { integration: "sonarr", status: "ready", page };
  } catch (error) {
    return failure("sonarr", error);
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
    return { integration: "radarr", status: "ready", page };
  } catch (error) {
    return failure("radarr", error);
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

function failure(integration: "sonarr" | "radarr", error: unknown): InventorySource {
  const adapterError = error instanceof SonarrAdapterError || error instanceof RadarrAdapterError
    ? error
    : undefined;
  return {
    integration,
    status: "integration_failure",
    state: adapterError?.code ?? "unavailable",
    ...(adapterError?.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: adapterError.retryAfterSeconds }),
  };
}

function parsePageSize(value: string | undefined): number {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === "") return 50;
  if (!/^\d{1,3}$/u.test(normalized)) throw new TypeError("Invalid missing inventory page size");
  const pageSize = Number(normalized);
  if (pageSize < 1 || pageSize > 100) throw new TypeError("Invalid missing inventory page size");
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
