import { dirname, isAbsolute, resolve } from "node:path";

import type { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { SubdlClient } from "./adapters/subdl.js";
import { ConfigurationError, type SubdlRuntimeConfiguration } from "./config.js";
import { ProviderSearchCache } from "./provider-search-cache.js";
import type { SubdlWindowSource } from "./provider-policy-search.js";

export interface ManagedSubdlSource {
  readonly source: SubdlWindowSource;
  close(): void;
}

export function createConfiguredSubdlSource(options: {
  readonly configuration: SubdlRuntimeConfiguration;
  readonly transport: FetchJsonTransport;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): ManagedSubdlSource {
  const client = new SubdlClient(
    { apiKey: options.configuration.apiKey.reveal() },
    options.transport,
  );
  const configuredPath = optional(options.environment.PEGARR_PROVIDER_CACHE_FILE);
  if (configuredPath === undefined) {
    return { source: client, close: () => undefined };
  }

  const dataDirectory = optional(options.environment.DATA_DIR);
  if (dataDirectory === undefined || !isAbsolute(dataDirectory)) {
    throw new ConfigurationError(
      "DATA_DIR must be an absolute path when PEGARR_PROVIDER_CACHE_FILE is configured",
    );
  }
  if (!isAbsolute(configuredPath)) {
    throw new ConfigurationError("PEGARR_PROVIDER_CACHE_FILE must be an absolute path");
  }
  const resolvedDataDirectory = resolve(dataDirectory);
  const databasePath = resolve(configuredPath);
  if (dirname(databasePath) !== resolvedDataDirectory) {
    throw new ConfigurationError(
      "PEGARR_PROVIDER_CACHE_FILE must be a direct child file inside DATA_DIR",
    );
  }

  const cache = new ProviderSearchCache({
    databasePath,
    source: client,
    ttlMs: parseBoundedInteger(
      options.environment.PEGARR_PROVIDER_CACHE_TTL_SECONDS,
      900,
      1,
      86_400,
      "PEGARR_PROVIDER_CACHE_TTL_SECONDS",
    ) * 1_000,
    maxEntries: parseBoundedInteger(
      options.environment.PEGARR_PROVIDER_CACHE_MAX_ENTRIES,
      5_000,
      1,
      100_000,
      "PEGARR_PROVIDER_CACHE_MAX_ENTRIES",
    ),
  });
  return { source: cache, close: () => cache.close() };
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const normalized = optional(value);
  if (normalized === undefined) return fallback;
  if (!/^\d+$/u.test(normalized)) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
