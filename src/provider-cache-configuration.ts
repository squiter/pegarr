import { dirname, isAbsolute, resolve } from "node:path";

import { ConfigurationError } from "./config.js";

export interface ProviderCacheRuntimeOptions {
  readonly databasePath: string;
  readonly positiveTtlMs: number;
  readonly emptyTtlMs: number;
  readonly maxEntries: number;
}

export function readProviderCacheRuntimeOptions(
  environment: Readonly<Record<string, string | undefined>>,
): ProviderCacheRuntimeOptions | undefined {
  const configuredPath = optional(environment.PEGARR_PROVIDER_CACHE_FILE);
  if (configuredPath === undefined) return undefined;
  const dataDirectory = optional(environment.DATA_DIR);
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

  const legacyTtlSeconds = parseOptionalBoundedInteger(
    environment.PEGARR_PROVIDER_CACHE_TTL_SECONDS,
    1,
    86_400,
    "PEGARR_PROVIDER_CACHE_TTL_SECONDS",
  );
  return {
    databasePath,
    positiveTtlMs: parseBoundedInteger(
      environment.PEGARR_PROVIDER_CACHE_POSITIVE_TTL_SECONDS,
      legacyTtlSeconds ?? 86_400,
      1,
      2_592_000,
      "PEGARR_PROVIDER_CACHE_POSITIVE_TTL_SECONDS",
    ) * 1_000,
    emptyTtlMs: parseBoundedInteger(
      environment.PEGARR_PROVIDER_CACHE_EMPTY_TTL_SECONDS,
      legacyTtlSeconds ?? 900,
      1,
      86_400,
      "PEGARR_PROVIDER_CACHE_EMPTY_TTL_SECONDS",
    ) * 1_000,
    maxEntries: parseBoundedInteger(
      environment.PEGARR_PROVIDER_CACHE_MAX_ENTRIES,
      5_000,
      1,
      100_000,
      "PEGARR_PROVIDER_CACHE_MAX_ENTRIES",
    ),
  };
}

function parseOptionalBoundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  name: string,
): number | undefined {
  return optional(value) === undefined
    ? undefined
    : parseBoundedInteger(value, minimum, minimum, maximum, name);
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
