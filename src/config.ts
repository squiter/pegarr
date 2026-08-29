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
export type OpenSubtitlesRuntimeConfiguration = ServiceRuntimeConfiguration;

export interface ControlledGrabRuntimeConfiguration {
  readonly enabled: true;
  readonly adminToken: SecretValue;
  readonly auditFile: string;
}

export interface LoginRuntimeConfiguration {
  readonly username: string;
  readonly password: SecretValue;
}

export interface RuntimeConfiguration {
  readonly sonarr?: SonarrRuntimeConfiguration;
  readonly radarr?: RadarrRuntimeConfiguration;
  readonly sonarrInstances?: readonly SonarrRuntimeConfiguration[];
  readonly radarrInstances?: readonly RadarrRuntimeConfiguration[];
  readonly bazarr?: BazarrRuntimeConfiguration;
  readonly subdl?: SubdlRuntimeConfiguration;
  readonly opensubtitles?: OpenSubtitlesRuntimeConfiguration;
  readonly accessToken?: SecretValue;
  readonly login?: LoginRuntimeConfiguration;
  readonly controlledGrab?: ControlledGrabRuntimeConfiguration;
  readonly missingPageSize?: number;
  readonly subdlLanguageMappings?: readonly ProviderLanguageMapping[];
  readonly opensubtitlesLanguageMappings?: readonly ProviderLanguageMapping[];
}

const maximumSecretBytes = 4_096;
const maximumApplicationConfigBytes = 1_048_576;
const maximumInstancesFileBytes = 65_536;
const maximumArrInstances = 16;

interface IntegrationConfigurationSpec {
  readonly displayName: "Sonarr" | "Radarr" | "Bazarr" | "SubDL" | "OpenSubtitles";
  readonly prefix: "PEGARR_SONARR" | "PEGARR_RADARR" | "PEGARR_BAZARR" | "PEGARR_SUBDL" | "PEGARR_OPENSUBTITLES";
  readonly defaultInstanceId: "sonarr" | "radarr" | "bazarr" | "subdl" | "opensubtitles";
  readonly secretFormat: "arr" | "bearer";
  readonly applicationConfigFormat?: "arr_xml" | "bazarr_yaml";
}

export async function loadRuntimeConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<RuntimeConfiguration> {
  const sonarrSpec = {
    displayName: "Sonarr",
    prefix: "PEGARR_SONARR",
    defaultInstanceId: "sonarr",
    secretFormat: "arr",
    applicationConfigFormat: "arr_xml",
  } as const;
  const radarrSpec = {
    displayName: "Radarr",
    prefix: "PEGARR_RADARR",
    defaultInstanceId: "radarr",
    secretFormat: "arr",
    applicationConfigFormat: "arr_xml",
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
    applicationConfigFormat: "bazarr_yaml",
  });
  const subdl = await loadIntegrationConfiguration(environment, {
    displayName: "SubDL",
    prefix: "PEGARR_SUBDL",
    defaultInstanceId: "subdl",
    secretFormat: "bearer",
  });
  const opensubtitles = await loadIntegrationConfiguration(environment, {
    displayName: "OpenSubtitles",
    prefix: "PEGARR_OPENSUBTITLES",
    defaultInstanceId: "opensubtitles",
    secretFormat: "bearer",
  });
  const accessToken = await loadAccessToken(environment);
  const login = await loadLoginConfiguration(environment);
  const controlledGrab = await loadControlledGrabConfiguration(environment);
  if (controlledGrab !== undefined && accessToken === undefined && login === undefined) {
    throw new ConfigurationError(
      "Controlled Grab requires PEGARR_ACCESS_TOKEN_FILE or Pegarr username/password login for the library boundary",
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
  const opensubtitlesLanguageMappings = parseProviderLanguageMappings(
    environment.PEGARR_OPENSUBTITLES_LANGUAGE_MAPPINGS,
    "PEGARR_OPENSUBTITLES_LANGUAGE_MAPPINGS",
  );

  return {
    ...(sonarr === undefined ? {} : { sonarr }),
    ...(radarr === undefined ? {} : { radarr }),
    ...(sonarrInstances === undefined ? {} : { sonarrInstances }),
    ...(radarrInstances === undefined ? {} : { radarrInstances }),
    ...(bazarr === undefined ? {} : { bazarr }),
    ...(subdl === undefined ? {} : { subdl }),
    ...(opensubtitles === undefined ? {} : { opensubtitles }),
    ...(accessToken === undefined ? {} : { accessToken }),
    ...(login === undefined ? {} : { login }),
    ...(controlledGrab === undefined ? {} : { controlledGrab }),
    ...(missingPageSize === undefined ? {} : { missingPageSize }),
    ...(subdlLanguageMappings === undefined ? {} : { subdlLanguageMappings }),
    ...(opensubtitlesLanguageMappings === undefined ? {} : { opensubtitlesLanguageMappings }),
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
    `${spec.prefix}_APP_CONFIG_FILE`,
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
  return parseProviderLanguageMappings(value, "PEGARR_SUBDL_LANGUAGE_MAPPINGS");
}

function parseProviderLanguageMappings(
  value: string | undefined,
  variableName: "PEGARR_SUBDL_LANGUAGE_MAPPINGS" | "PEGARR_OPENSUBTITLES_LANGUAGE_MAPPINGS",
): readonly ProviderLanguageMapping[] | undefined {
  const normalized = optional(value);
  if (normalized === undefined) return undefined;
  const mappings = normalized.split(",").map((entry) => {
    const parts = entry.split(":").map((part) => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new ConfigurationError(
        `${variableName} must use policy:provider comma-separated pairs`,
      );
    }
    return { policyCode: parts[0], providerCode: parts[1] };
  });
  if (mappings.length > 64) {
    throw new ConfigurationError(`${variableName} may contain at most 64 pairs`);
  }
  try {
    validateLanguageMappings(mappings);
  } catch {
    throw new ConfigurationError(`${variableName} contains an invalid or duplicate pair`);
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

async function loadLoginConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<LoginRuntimeConfiguration | undefined> {
  if (present(environment.PEGARR_PASSWORD)) {
    throw new ConfigurationError(
      "Direct Pegarr passwords are not supported; use PEGARR_PASSWORD_FILE",
    );
  }
  const username = optional(environment.PEGARR_USERNAME);
  const passwordFile = optional(environment.PEGARR_PASSWORD_FILE);
  if (username === undefined && passwordFile === undefined) return undefined;
  if (username === undefined || passwordFile === undefined) {
    throw new ConfigurationError(
      "Pegarr login requires PEGARR_USERNAME and PEGARR_PASSWORD_FILE",
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/iu.test(username)) {
    throw new ConfigurationError("PEGARR_USERNAME must be a safe login name");
  }
  const password = await readSecret(passwordFile, "Pegarr", "PEGARR_PASSWORD_FILE", "password");
  return { username, password };
}

async function loadIntegrationConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  spec: IntegrationConfigurationSpec,
): Promise<ServiceRuntimeConfiguration | undefined> {
  const directKeyName = `${spec.prefix}_API_KEY`;
  const urlName = `${spec.prefix}_URL`;
  const allowedHostsName = `${spec.prefix}_ALLOWED_HOSTS`;
  const apiKeyFileName = `${spec.prefix}_API_KEY_FILE`;
  const applicationConfigFileName = `${spec.prefix}_APP_CONFIG_FILE`;
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
  const applicationConfigFile = optional(environment[applicationConfigFileName]);
  if (apiKeyFile !== undefined && applicationConfigFile !== undefined) {
    throw new ConfigurationError(
      `${spec.displayName} configuration must use exactly one of ${apiKeyFileName} or ${applicationConfigFileName}`,
    );
  }
  if (applicationConfigFile !== undefined && spec.applicationConfigFormat === undefined) {
    throw new ConfigurationError(
      `${applicationConfigFileName} is not supported for ${spec.displayName}`,
    );
  }
  const credentialFile = apiKeyFile ?? applicationConfigFile;
  const configuredValues = [baseUrl, allowedHostsValue, credentialFile].filter(
    (value) => value !== undefined,
  );

  if (configuredValues.length === 0) {
    return undefined;
  }
  if (configuredValues.length !== 3) {
    const credentialRequirement = spec.applicationConfigFormat === undefined
      ? apiKeyFileName
      : `exactly one of ${apiKeyFileName} or ${applicationConfigFileName}`;
    throw new ConfigurationError(
      `${spec.displayName} configuration requires ${urlName}, ${allowedHostsName}, and ${credentialRequirement}`,
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
  const apiKey = applicationConfigFile === undefined
    ? await readSecret(
        apiKeyFile as string,
        spec.displayName,
        apiKeyFileName,
        spec.secretFormat,
      )
    : await readApplicationConfigSecret(
        applicationConfigFile,
        spec.displayName,
        applicationConfigFileName,
        spec.applicationConfigFormat as "arr_xml" | "bazarr_yaml",
      );

  return {
    instanceId,
    baseUrl: baseUrl as string,
    allowedHosts,
    allowInsecureHttp,
    apiKey,
  };
}

async function readApplicationConfigSecret(
  path: string,
  displayName: "Sonarr" | "Radarr" | "Bazarr" | "SubDL" | "OpenSubtitles",
  configurationFileName: string,
  format: "arr_xml" | "bazarr_yaml",
): Promise<SecretValue> {
  if (!isAbsolute(path)) {
    throw new ConfigurationError(`${configurationFileName} must be an absolute path`);
  }

  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(maximumApplicationConfigBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead > maximumApplicationConfigBytes) {
      throw new ConfigurationError(
        `${displayName} application configuration exceeds the 1048576-byte limit`,
      );
    }
    const content = buffer.subarray(0, bytesRead).toString("utf8");
    const value = format === "arr_xml"
      ? extractArrXmlApiKey(content)
      : extractBazarrYamlApiKey(content);
    if (value === undefined || !/^[a-z0-9_-]{16,256}$/iu.test(value)) {
      throw new ConfigurationError(
        `${displayName} application configuration does not contain one valid API key`,
      );
    }
    return new SecretValue(value);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(
      `${displayName} application configuration could not be read`,
    );
  } finally {
    await handle?.close();
  }
}

function extractArrXmlApiKey(content: string): string | undefined {
  const matches = [...content.matchAll(/<ApiKey>\s*([a-z0-9_-]{16,256})\s*<\/ApiKey>/giu)];
  return matches.length === 1 ? matches[0]?.[1] : undefined;
}

function extractBazarrYamlApiKey(content: string): string | undefined {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  let inAuthSection = false;
  const matches: string[] = [];

  for (const line of lines) {
    if (/^auth\s*:\s*(?:#.*)?$/iu.test(line)) {
      inAuthSection = true;
      continue;
    }
    if (/^[a-z0-9_-]+\s*:/iu.test(line)) {
      inAuthSection = false;
    }
    if (!inAuthSection) continue;
    const match = /^ +apikey\s*:\s*(.*?)\s*(?:#.*)?$/iu.exec(line);
    if (match?.[1] === undefined) continue;
    const value = unquoteSimpleYamlScalar(match[1].trim());
    if (value !== undefined) matches.push(value);
  }

  return matches.length === 1 ? matches[0] : undefined;
}

function unquoteSimpleYamlScalar(value: string): string | undefined {
  if ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  return value.length > 0 ? value : undefined;
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
  displayName: "Sonarr" | "Radarr" | "Bazarr" | "SubDL" | "OpenSubtitles" | "Pegarr",
  apiKeyFileName: string,
  secretFormat: "arr" | "bearer" | "access" | "admin" | "password",
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
      : secretFormat === "access" || secretFormat === "admin" || secretFormat === "password"
        ? /^[a-z0-9._~+/=-]{32,4096}$/iu.test(value)
        : /^[a-z0-9._~+/=-]{16,4096}$/iu.test(value);
    if (!valid) {
      throw new ConfigurationError(
        secretFormat === "access" || secretFormat === "admin" || secretFormat === "password"
          ? secretFormat === "password"
            ? "Pegarr password file does not contain one valid password of at least 32 characters"
            : `Pegarr ${secretFormat === "admin" ? "administrator" : "access"} token file does not contain one valid token`
          : `${displayName} API key file does not contain one valid API key`,
      );
    }
    return new SecretValue(value);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(
      secretFormat === "access" || secretFormat === "admin" || secretFormat === "password"
        ? secretFormat === "password"
          ? "Pegarr password file could not be read"
          : `Pegarr ${secretFormat === "admin" ? "administrator" : "access"} token file could not be read`
        : `${displayName} API key file could not be read`,
    );
  } finally {
    await handle?.close();
  }
}
