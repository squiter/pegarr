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

export interface SonarrRuntimeConfiguration {
  readonly instanceId: string;
  readonly baseUrl: string;
  readonly allowedHosts: readonly string[];
  readonly allowInsecureHttp: boolean;
  readonly apiKey: SecretValue;
}

export interface RuntimeConfiguration {
  readonly sonarr?: SonarrRuntimeConfiguration;
}

const maximumSecretBytes = 4_096;

export async function loadRuntimeConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<RuntimeConfiguration> {
  if (present(environment.PEGARR_SONARR_API_KEY)) {
    throw new ConfigurationError(
      "Direct Sonarr API key environment variables are not supported; use PEGARR_SONARR_API_KEY_FILE",
    );
  }

  const baseUrl = optional(environment.PEGARR_SONARR_URL);
  const allowedHostsValue = optional(environment.PEGARR_SONARR_ALLOWED_HOSTS);
  const apiKeyFile = optional(environment.PEGARR_SONARR_API_KEY_FILE);
  const configuredValues = [baseUrl, allowedHostsValue, apiKeyFile].filter(
    (value) => value !== undefined,
  );

  if (configuredValues.length === 0) {
    return {};
  }
  if (configuredValues.length !== 3) {
    throw new ConfigurationError(
      "Sonarr configuration requires PEGARR_SONARR_URL, PEGARR_SONARR_ALLOWED_HOSTS, and PEGARR_SONARR_API_KEY_FILE",
    );
  }

  const instanceId = optional(environment.PEGARR_SONARR_INSTANCE_ID) ?? "sonarr";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(instanceId)) {
    throw new ConfigurationError("PEGARR_SONARR_INSTANCE_ID must be a safe label");
  }
  const allowedHosts = parseAllowedHosts(allowedHostsValue as string);
  const allowInsecureHttp = parseBoolean(
    environment.PEGARR_SONARR_ALLOW_INSECURE_HTTP,
    "PEGARR_SONARR_ALLOW_INSECURE_HTTP",
  );
  const apiKey = await readSecret(apiKeyFile as string);

  return {
    sonarr: {
      instanceId,
      baseUrl: baseUrl as string,
      allowedHosts,
      allowInsecureHttp,
      apiKey,
    },
  };
}

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseAllowedHosts(value: string): readonly string[] {
  const hosts = value
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  if (hosts.length === 0 || new Set(hosts.map((host) => host.toLowerCase())).size !== hosts.length) {
    throw new ConfigurationError(
      "PEGARR_SONARR_ALLOWED_HOSTS must contain unique comma-separated hostnames",
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

async function readSecret(path: string): Promise<SecretValue> {
  if (!isAbsolute(path)) {
    throw new ConfigurationError("PEGARR_SONARR_API_KEY_FILE must be an absolute path");
  }

  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(maximumSecretBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead > maximumSecretBytes) {
      throw new ConfigurationError("Sonarr API key file exceeds the 4096-byte limit");
    }
    const value = buffer.subarray(0, bytesRead).toString("utf8").trim();
    if (!/^[a-z0-9_-]{16,256}$/iu.test(value)) {
      throw new ConfigurationError("Sonarr API key file does not contain one valid API key");
    }
    return new SecretValue(value);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError("Sonarr API key file could not be read");
  } finally {
    await handle?.close();
  }
}
