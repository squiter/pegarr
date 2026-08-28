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

export interface ControlledGrabRuntimeConfiguration {
  readonly enabled: true;
  readonly adminToken: SecretValue;
  readonly auditFile: string;
}

export interface RuntimeConfiguration {
  readonly sonarr?: SonarrRuntimeConfiguration;
  readonly radarr?: RadarrRuntimeConfiguration;
  readonly sonarrInstances?: readonly SonarrRuntimeConfiguration[];
  readonly radarrInstances?: readonly RadarrRuntimeConfiguration[];
  readonly bazarr?: BazarrRuntimeConfiguration;
  readonly subdl?: SubdlRuntimeConfiguration;
  readonly accessToken?: SecretValue;
  readonly controlledGrab?: ControlledGrabRuntimeConfiguration;
  readonly missingPageSize?: number;
  readonly subdlLanguageMappings?: readonly ProviderLanguageMapping[];
}

const maximumSecretBytes = 4_096;
const maximumInstancesFileBytes = 65_536;
const maximumArrInstances = 16;

interface IntegrationConfigurationSpec {
  readonly displayName: "Sonarr" | "Radarr" | "Bazarr" | "SubDL";
  readonly prefix: "PEGARR_SONARR" | "PEGARR_RADARR" | "PEGARR_BAZARR" | "PEGARR_SUBDL";
  readonly defaultInstanceId: "sonarr" | "radarr" | "bazarr" | "subdl";
  readonly secretFormat: "arr" | "bearer";
}

export async function loadRuntimeConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<RuntimeConfiguration> {
  const sonarrSpec = {
    displayName: "Sonarr",
    prefix: "PEGARR_SONARR",
    defaultInstanceId: "sonarr",
    secretFormat: "arr",
  } as const;
  const radarrSpec = {
    displayName: "Radarr",
    prefix: "PEGARR_RADARR",
    defaultInstanceId: "radarr",
    secretFormat: "arr",
  } as const;
  const sonarrInstances = await loadArrInstancesConfiguration(environment, sonarrSpec);
  const radarrInstances = await loadArrInstancesConfiguration(environment, radarrSpec);
  const sonarr = sonarrInstances === undefined ? await loadIntegrationConfiguration(environment, sonarrSpec) : undefined;
  const radarr = radarrInstances === undefined ? await loadIntegrationConfiguration(environment, radarrSpec) : undefined;
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
  const controlledGrab = await loadControlledGrabConfiguration(environment);
  if (controlledGrab !== undefined && accessToken === undefined) {
    throw new ConfigurationError(
      "Controlled Grab requires PEGARR_ACCESS_TOKEN_FILE for the read-only library boundary",
    );
  }
  if (controlledGrab !== undefined && accessToken?.reveal() === controlledGrab.adminToken.reveal()) {
    throw new ConfigurationError(
      "Controlled Grab administrator and read-only access tokens must be different",
    );
  }
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
    ...(sonarrInstances === undefined ? {} : { sonarrInstances }),
    ...(radarrInstances === undefined ? {} : { radarrInstances }),
    ...(bazarr === undefined ? {} : { bazarr }),
    ...(subdl === undefined ? {} : { subdl }),
    ...(accessToken === undefined ? {} : { accessToken }),
    ...(controlledGrab === undefined ? {} : { controlledGrab }),
    ...(missingPageSize === undefined ? {} : { missingPageSize }),
    ...(subdlLanguageMappings === undefined ? {} : { subdlLanguageMappings }),
  };
}

export function configuredSonarrInstances(configuration: RuntimeConfiguration): readonly SonarrRuntimeConfiguration[] {
  return configuration.sonarrInstances ?? (configuration.sonarr === undefined ? [] : [configuration.sonarr]);
}

export function configuredRadarrInstances(configuration: RuntimeConfiguration): readonly RadarrRuntimeConfiguration[] {
  return configuration.radarrInstances ?? (configuration.radarr === undefined ? [] : [configuration.radarr]);
}

async function loadArrInstancesConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  spec: IntegrationConfigurationSpec,
): Promise<readonly ServiceRuntimeConfiguration[] | undefined> {
  const fileName = `${spec.prefix}_INSTANCES_FILE`;
  const path = optional(environment[fileName]);
  if (path === undefined) return undefined;
  const legacyNames = [
    `${spec.prefix}_URL`, `${spec.prefix}_ALLOWED_HOSTS`, `${spec.prefix}_API_KEY_FILE`,
    `${spec.prefix}_INSTANCE_ID`, `${spec.prefix}_ALLOW_INSECURE_HTTP`, `${spec.prefix}_API_KEY`,
  ];
  if (legacyNames.some((name) => present(environment[name]))) {
    throw new ConfigurationError(`${fileName} cannot be combined with single-instance ${spec.displayName} settings`);
  }
  if (!isAbsolute(path)) throw new ConfigurationError(`${fileName} must be an absolute path`);
  let parsed: unknown;
  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(maximumInstancesFileBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead > maximumInstancesFileBytes) throw new ConfigurationError(`${fileName} exceeds the 65536-byte limit`);
    parsed = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(`${fileName} could not be read as valid JSON`);
  } finally {
    await handle?.close();
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > maximumArrInstances) {
    throw new ConfigurationError(`${fileName} must contain between 1 and ${maximumArrInstances} instances`);
  }
  const configurations: ServiceRuntimeConfiguration[] = [];
  const instanceIds = new Set<string>();
  for (const [index, value] of parsed.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ConfigurationError(`${fileName} entry ${index + 1} is invalid`);
    }
    const record = value as Record<string, unknown>;
    const allowedKeys = new Set(["instanceId", "baseUrl", "allowedHosts", "allowInsecureHttp", "apiKeyFile"]);
    if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
      throw new ConfigurationError(`${fileName} entry ${index + 1} contains unsupported fields`);
    }
    const instanceId = typeof record.instanceId === "string" ? record.instanceId.trim() : "";
    const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl.trim() : "";
    const apiKeyFile = typeof record.apiKeyFile === "string" ? record.apiKeyFile.trim() : "";
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(instanceId) || instanceIds.has(instanceId.toLowerCase())) {
      throw new ConfigurationError(`${fileName} instance IDs must be unique safe labels`);
    }
    if (!baseUrl || baseUrl.length > 2_048 || !apiKeyFile) {
      throw new ConfigurationError(`${fileName} entry ${index + 1} is incomplete`);
    }
    if (!Array.isArray(record.allowedHosts) || record.allowedHosts.some((host) => typeof host !== "string")) {
      throw new ConfigurationError(`${fileName} entry ${index + 1} has invalid allowedHosts`);
    }
    if (record.allowInsecureHttp !== undefined && typeof record.allowInsecureHttp !== "boolean") {
      throw new ConfigurationError(`${fileName} entry ${index + 1} has invalid allowInsecureHttp`);
    }
    const allowedHosts = parseAllowedHosts((record.allowedHosts as string[]).join(","), `${fileName} allowedHosts`);
    const apiKey = await readSecret(apiKeyFile, spec.displayName, `${fileName} apiKeyFile`, "arr");
    instanceIds.add(instanceId.toLowerCase());
    configurations.push({
      instanceId,
      baseUrl,
      allowedHosts,
      allowInsecureHttp: record.allowInsecureHttp === true,
      apiKey,
    });
  }
  return configurations;
}

async function loadControlledGrabConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<ControlledGrabRuntimeConfiguration | undefined> {
  if (present(environment.PEGARR_ADMIN_TOKEN)) {
    throw new ConfigurationError(
      "Direct administrator tokens are not supported; use PEGARR_ADMIN_TOKEN_FILE",
    );
  }
  const enabled = parseBoolean(environment.PEGARR_GRAB_ENABLED, "PEGARR_GRAB_ENABLED");
  const tokenFile = optional(environment.PEGARR_ADMIN_TOKEN_FILE);
  const auditFile = optional(environment.PEGARR_GRAB_AUDIT_FILE);
  if (!enabled) {
    if (tokenFile !== undefined || auditFile !== undefined) {
      throw new ConfigurationError(
        "Administrator token and Grab audit configuration require PEGARR_GRAB_ENABLED=true",
      );
    }
    return undefined;
  }
  if (tokenFile === undefined || auditFile === undefined) {
    throw new ConfigurationError(
      "Controlled Grab requires PEGARR_ADMIN_TOKEN_FILE and PEGARR_GRAB_AUDIT_FILE",
    );
  }
  if (!isAbsolute(auditFile)) {
    throw new ConfigurationError("PEGARR_GRAB_AUDIT_FILE must be an absolute path");
  }
  const adminToken = await readSecret(
    tokenFile,
    "Pegarr",
    "PEGARR_ADMIN_TOKEN_FILE",
    "admin",
  );
  return { enabled: true, adminToken, auditFile };
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
  secretFormat: "arr" | "bearer" | "access" | "admin",
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
      : secretFormat === "access" || secretFormat === "admin"
        ? /^[a-z0-9._~+/=-]{32,4096}$/iu.test(value)
        : /^[a-z0-9._~+/=-]{16,4096}$/iu.test(value);
    if (!valid) {
      throw new ConfigurationError(
        secretFormat === "access" || secretFormat === "admin"
          ? `Pegarr ${secretFormat === "admin" ? "administrator" : "access"} token file does not contain one valid token`
          : `${displayName} API key file does not contain one valid API key`,
      );
    }
    return new SecretValue(value);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(
      secretFormat === "access" || secretFormat === "admin"
        ? `Pegarr ${secretFormat === "admin" ? "administrator" : "access"} token file could not be read`
        : `${displayName} API key file could not be read`,
    );
  } finally {
    await handle?.close();
  }
}
