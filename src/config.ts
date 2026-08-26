import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";

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

export interface ArrRuntimeConfiguration {
  readonly instanceId: string;
  readonly baseUrl: string;
  readonly allowedHosts: readonly string[];
  readonly allowInsecureHttp: boolean;
  readonly apiKey: SecretValue;
}

export type SonarrRuntimeConfiguration = ArrRuntimeConfiguration;
export type RadarrRuntimeConfiguration = ArrRuntimeConfiguration;

export interface RuntimeConfiguration {
  readonly sonarr?: SonarrRuntimeConfiguration;
  readonly radarr?: RadarrRuntimeConfiguration;
}

const maximumSecretBytes = 4_096;

interface IntegrationConfigurationSpec {
  readonly displayName: "Sonarr" | "Radarr";
  readonly prefix: "PEGARR_SONARR" | "PEGARR_RADARR";
  readonly defaultInstanceId: "sonarr" | "radarr";
}

export async function loadRuntimeConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<RuntimeConfiguration> {
  const sonarr = await loadIntegrationConfiguration(environment, {
    displayName: "Sonarr",
    prefix: "PEGARR_SONARR",
    defaultInstanceId: "sonarr",
  });
  const radarr = await loadIntegrationConfiguration(environment, {
    displayName: "Radarr",
    prefix: "PEGARR_RADARR",
    defaultInstanceId: "radarr",
  });

  return {
    ...(sonarr === undefined ? {} : { sonarr }),
    ...(radarr === undefined ? {} : { radarr }),
  };
}

async function loadIntegrationConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  spec: IntegrationConfigurationSpec,
): Promise<ArrRuntimeConfiguration | undefined> {
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
  const apiKey = await readSecret(apiKeyFile as string, spec.displayName, apiKeyFileName);

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

async function readSecret(
  path: string,
  displayName: "Sonarr" | "Radarr",
  apiKeyFileName: string,
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
    if (!/^[a-z0-9_-]{16,256}$/iu.test(value)) {
      throw new ConfigurationError(`${displayName} API key file does not contain one valid API key`);
    }
    return new SecretValue(value);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(`${displayName} API key file could not be read`);
  } finally {
    await handle?.close();
  }
}
