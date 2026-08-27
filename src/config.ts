import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { validateLanguageMappings, type ProviderLanguageMapping } from "./provider-policy-search.js";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return "[redacted]";
  }

  toString(): string {
    return "[redacted]";
  }
}

export interface ServiceRuntimeConfiguration {
  readonly instanceId: string;
  readonly baseUrl: string;
  readonly allowedHosts: readonly string[];
  readonly allowInsecureHttp: boolean;
  readonly apiKey: SecretValue;
}

export type ArrRuntimeConfiguration = ServiceRuntimeConfiguration;
export type SonarrRuntimeConfiguration = ServiceRuntimeConfiguration;
export type RadarrRuntimeConfiguration = ServiceRuntimeConfiguration;
export type BazarrRuntimeConfiguration = ServiceRuntimeConfiguration;
export type SubdlRuntimeConfiguration = ServiceRuntimeConfiguration;

export interface RuntimeConfiguration {
  readonly sonarr?: SonarrRuntimeConfiguration;
  readonly radarr?: RadarrRuntimeConfiguration;
  readonly bazarr?: BazarrRuntimeConfiguration;
  readonly subdl?: SubdlRuntimeConfiguration;
  readonly accessToken?: SecretValue;
  readonly missingPageSize?: number;
  readonly subdlLanguageMappings?: readonly ProviderLanguageMapping[];
}

const maximumSecretBytes = 4_096;

interface IntegrationConfigurationSpec {
  readonly displayName: "Sonarr" | "Radarr" | "Bazarr" | "SubDL";
  readonly prefix: "PEGARR_SONARR" | "PEGARR_RADARR" | "PEGARR_BAZARR" | "PEGARR_SUBDL";
  readonly defaultInstanceId: "sonarr" | "radarr" | "bazarr" | "subdl";
  readonly secretFormat: "arr" | "bearer";
}

export async function loadRuntimeConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<RuntimeConfiguration> {
  const sonarr = await loadIntegrationConfiguration(environment, {
    displayName: "Sonarr",
    prefix: "PEGARR_SONARR",
    defaultInstanceId: "sonarr",
    secretFormat: "arr",
  });
  const radarr = await loadIntegrationConfiguration(environment, {
    displayName: "Radarr",
    prefix: "PEGARR_RADARR",
    defaultInstanceId: "radarr",
    secretFormat: "arr",
  });
  const bazarr = await loadIntegrationConfiguration(environment, {
    displayName: "Bazarr",
    prefix: "PEGARR_BAZARR",
    defaultInstanceId: "bazarr",
    secretFormat: "arr",
  });
  const subdl = await loadIntegrationConfiguration(environment, {
    displayName: "SubDL",
    prefix: "PEGARR_SUBDL",
    defaultInstanceId: "subdl",
    secretFormat: "bearer",
  });
  const accessToken = await loadAccessToken(environment);
  const missingPageSize = parseOptionalBoundedInteger(
    environment.PEGARR_MISSING_PAGE_SIZE,
    1,
    100,
    "PEGARR_MISSING_PAGE_SIZE",
  );
  const subdlLanguageMappings = parseSubdlLanguageMappings(
    environment.PEGARR_SUBDL_LANGUAGE_MAPPINGS,
  );

  return {
    ...(sonarr === undefined ? {} : { sonarr }),
    ...(radarr === undefined ? {} : { radarr }),
    ...(bazarr === undefined ? {} : { bazarr }),
    ...(subdl === undefined ? {} : { subdl }),
    ...(accessToken === undefined ? {} : { accessToken }),
    ...(missingPageSize === undefined ? {} : { missingPageSize }),
    ...(subdlLanguageMappings === undefined ? {} : { subdlLanguageMappings }),
  };
}

function parseSubdlLanguageMappings(
  value: string | undefined,
): readonly ProviderLanguageMapping[] | undefined {
  const normalized = optional(value);
  if (normalized === undefined) return undefined;
  const mappings = normalized.split(",").map((entry) => {
    const parts = entry.split(":").map((part) => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new ConfigurationError(
        "PEGARR_SUBDL_LANGUAGE_MAPPINGS must use policy:provider comma-separated pairs",
      );
    }
    return { policyCode: parts[0], providerCode: parts[1] };
  });
  if (mappings.length > 64) {
    throw new ConfigurationError("PEGARR_SUBDL_LANGUAGE_MAPPINGS may contain at most 64 pairs");
  }
  try {
    validateLanguageMappings(mappings);
  } catch {
    throw new ConfigurationError("PEGARR_SUBDL_LANGUAGE_MAPPINGS contains an invalid or duplicate pair");
  }
  return mappings;
}

async function loadAccessToken(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<SecretValue | undefined> {
  if (present(environment.PEGARR_ACCESS_TOKEN)) {
    throw new ConfigurationError(
      "Direct access token environment variables are not supported; use PEGARR_ACCESS_TOKEN_FILE",
    );
  }
  const path = optional(environment.PEGARR_ACCESS_TOKEN_FILE);
  if (path === undefined) return undefined;
  return readSecret(path, "Pegarr", "PEGARR_ACCESS_TOKEN_FILE", "access");
}

async function loadIntegrationConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  spec: IntegrationConfigurationSpec,
): Promise<ServiceRuntimeConfiguration | undefined> {
  const directKeyName = `${spec.prefix}_API_KEY`;
  const urlName = `${spec.prefix}_URL`;
  const allowedHostsName = `${spec.prefix}_ALLOWED_HOSTS`;
  const apiKeyFileName = `${spec.prefix}_API_KEY_FILE`;
  const instanceIdName = `${spec.prefix}_INSTANCE_ID`;
  const allowInsecureHttpName = `${spec.prefix}_ALLOW_INSECURE_HTTP`;

  if (present(environment[directKeyName])) {
    throw new ConfigurationError(
      `Direct ${spec.displayName} API key environment variables are not supported; use ${apiKeyFileName}`,
    );
  }

  const baseUrl = optional(environment[urlName]);
  const allowedHostsValue = optional(environment[allowedHostsName]);
  const apiKeyFile = optional(environment[apiKeyFileName]);
  const configuredValues = [baseUrl, allowedHostsValue, apiKeyFile].filter(
    (value) => value !== undefined,
  );

  if (configuredValues.length === 0) {
    return undefined;
  }
  if (configuredValues.length !== 3) {
    throw new ConfigurationError(
      `${spec.displayName} configuration requires ${urlName}, ${allowedHostsName}, and ${apiKeyFileName}`,
    );
  }

  const instanceId = optional(environment[instanceIdName]) ?? spec.defaultInstanceId;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(instanceId)) {
    throw new ConfigurationError(`${instanceIdName} must be a safe label`);
  }
  const allowedHosts = parseAllowedHosts(allowedHostsValue as string, allowedHostsName);
  const allowInsecureHttp = parseBoolean(
    environment[allowInsecureHttpName],
    allowInsecureHttpName,
  );
  const apiKey = await readSecret(
    apiKeyFile as string,
    spec.displayName,
    apiKeyFileName,
    spec.secretFormat,
  );

  return {
    instanceId,
    baseUrl: baseUrl as string,
    allowedHosts,
    allowInsecureHttp,
    apiKey,
  };
}

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseAllowedHosts(value: string, name: string): readonly string[] {
  const hosts = value
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  if (hosts.length === 0 || new Set(hosts.map((host) => host.toLowerCase())).size !== hosts.length) {
    throw new ConfigurationError(
      `${name} must contain unique comma-separated hostnames`,
    );
  }
  return hosts;
}

function parseBoolean(value: string | undefined, name: string): boolean {
  const normalized = optional(value)?.toLowerCase();
  if (normalized === undefined || normalized === "false") {
    return false;
  }
  if (normalized === "true") {
    return true;
  }
  throw new ConfigurationError(`${name} must be true or false`);
}

function parseOptionalBoundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  name: string,
): number | undefined {
  const normalized = optional(value);
  if (normalized === undefined) return undefined;
  if (!/^\d+$/u.test(normalized)) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

async function readSecret(
  path: string,
  displayName: "Sonarr" | "Radarr" | "Bazarr" | "SubDL" | "Pegarr",
  apiKeyFileName: string,
  secretFormat: "arr" | "bearer" | "access",
): Promise<SecretValue> {
  if (!isAbsolute(path)) {
    throw new ConfigurationError(`${apiKeyFileName} must be an absolute path`);
  }

  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(maximumSecretBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead > maximumSecretBytes) {
      throw new ConfigurationError(`${displayName} API key file exceeds the 4096-byte limit`);
    }
    const value = buffer.subarray(0, bytesRead).toString("utf8").trim();
    const valid = secretFormat === "arr"
      ? /^[a-z0-9_-]{16,256}$/iu.test(value)
      : secretFormat === "access"
        ? /^[a-z0-9._~+/=-]{32,4096}$/iu.test(value)
        : /^[a-z0-9._~+/=-]{16,4096}$/iu.test(value);
    if (!valid) {
      throw new ConfigurationError(
        secretFormat === "access"
          ? "Pegarr access token file does not contain one valid token"
          : `${displayName} API key file does not contain one valid API key`,
      );
    }
    return new SecretValue(value);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(
      secretFormat === "access"
        ? "Pegarr access token file could not be read"
        : `${displayName} API key file could not be read`,
    );
  } finally {
    await handle?.close();
  }
}
