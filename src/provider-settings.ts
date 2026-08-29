import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { SecretValue } from "./config.js";
import {
  validateLanguageMappings,
  type ProviderLanguageMapping,
} from "./provider-policy-search.js";

export type ConfigurableProviderId = "subdl" | "opensubtitles";

export interface ProviderSettingsInput {
  readonly apiKey?: string;
  readonly languageMappings: readonly ProviderLanguageMapping[];
}

export interface ProviderSettingsEntry {
  readonly provider: ConfigurableProviderId;
  readonly settingsConfigured: boolean;
  readonly credentialConfigured: boolean;
  readonly languageMappings: readonly ProviderLanguageMapping[];
}

export interface ProviderSettingsSnapshot {
  readonly revision: number;
  readonly providers: readonly ProviderSettingsEntry[];
}

interface StoredProviderSettings {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly providers: Partial<Readonly<Record<ConfigurableProviderId, {
    readonly languageMappings: readonly ProviderLanguageMapping[];
  }>>>;
}

const providerIds = ["subdl", "opensubtitles"] as const;
const maximumSettingsBytes = 64 * 1024;
const maximumSecretBytes = 4_096;
const validApiKey = /^[a-z0-9._~+/=-]{16,4096}$/iu;

export class ProviderSettingsStore {
  readonly #path: string;
  readonly #secretsDirectory: string;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.#path = resolve(dataDirectory, "provider-settings.json");
    this.#secretsDirectory = resolve(dataDirectory, "provider-secrets");
  }

  async read(): Promise<ProviderSettingsSnapshot> {
    const stored = await this.#readStored();
    const providers = await Promise.all(providerIds.map(async (provider) => ({
      provider,
      settingsConfigured: stored?.providers[provider] !== undefined,
      credentialConfigured: (await this.readCredential(provider)) !== undefined,
      languageMappings: stored?.providers[provider]?.languageMappings ?? [],
    })));
    return { revision: stored?.revision ?? 0, providers };
  }

  async readCredential(provider: ConfigurableProviderId): Promise<SecretValue | undefined> {
    let handle;
    try {
      handle = await open(this.#secretPath(provider), "r");
      const buffer = Buffer.alloc(maximumSecretBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      if (bytesRead > maximumSecretBytes) throw new TypeError("Provider credential exceeds the size limit");
      const value = buffer.subarray(0, bytesRead).toString("utf8").trim();
      if (!validApiKey.test(value)) throw new TypeError("Provider credential is invalid");
      return new SecretValue(value);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error instanceof TypeError ? error : new TypeError("Provider credential could not be read");
    } finally {
      await handle?.close();
    }
  }

  async update(provider: ConfigurableProviderId, input: ProviderSettingsInput): Promise<ProviderSettingsSnapshot> {
    const languageMappings = validateMappings(input.languageMappings);
    const apiKey = input.apiKey === undefined ? undefined : validateApiKey(input.apiKey);
    let result: ProviderSettingsSnapshot | undefined;
    const operation = this.#writeChain.then(async () => {
      const current = await this.#readStored();
      if (apiKey !== undefined) await this.#writeCredential(provider, apiKey);
      const stored: StoredProviderSettings = {
        schemaVersion: 1,
        revision: (current?.revision ?? 0) + 1,
        providers: {
          ...current?.providers,
          [provider]: { languageMappings },
        },
      };
      await this.#writeStored(stored);
      result = await this.read();
    });
    this.#writeChain = operation.catch(() => undefined);
    await operation;
    if (result === undefined) throw new Error("Provider settings update did not complete");
    return result;
  }

  async #readStored(): Promise<StoredProviderSettings | undefined> {
    let handle;
    try {
      handle = await open(this.#path, "r");
      const buffer = Buffer.alloc(maximumSettingsBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      if (bytesRead > maximumSettingsBytes) throw new TypeError("Provider settings exceed the size limit");
      return parseStored(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error instanceof TypeError ? error : new TypeError("Provider settings could not be read");
    } finally {
      await handle?.close();
    }
  }

  async #writeStored(value: StoredProviderSettings): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    await atomicPrivateWrite(this.#path, `${JSON.stringify(value)}\n`);
  }

  async #writeCredential(provider: ConfigurableProviderId, value: string): Promise<void> {
    await mkdir(this.#secretsDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.#secretsDirectory, 0o700);
    await atomicPrivateWrite(this.#secretPath(provider), `${value}\n`);
  }

  #secretPath(provider: ConfigurableProviderId): string {
    return resolve(this.#secretsDirectory, `${provider}-api-key`);
  }
}

async function atomicPrivateWrite(path: string, value: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function validateApiKey(value: string): string {
  const normalized = value.trim();
  if (!validApiKey.test(normalized)) throw new TypeError("Provider API key is invalid");
  return normalized;
}

function validateMappings(value: readonly ProviderLanguageMapping[]): readonly ProviderLanguageMapping[] {
  if (!Array.isArray(value) || value.length > 64) throw new TypeError("Provider language mappings are invalid");
  const mappings = value.map((mapping) => ({
    policyCode: mapping?.policyCode,
    providerCode: mapping?.providerCode,
  }));
  validateLanguageMappings(mappings);
  return mappings;
}

function parseStored(value: unknown): StoredProviderSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Provider settings are invalid");
  const record = value as Readonly<Record<string, unknown>>;
  if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || (record.revision as number) < 1) {
    throw new TypeError("Provider settings are invalid");
  }
  if (typeof record.providers !== "object" || record.providers === null || Array.isArray(record.providers)) {
    throw new TypeError("Provider settings are invalid");
  }
  const providerRecord = record.providers as Readonly<Record<string, unknown>>;
  if (Object.keys(providerRecord).some((provider) => !providerIds.includes(provider as ConfigurableProviderId))) {
    throw new TypeError("Provider settings are invalid");
  }
  const providers: Partial<Record<ConfigurableProviderId, { readonly languageMappings: readonly ProviderLanguageMapping[] }>> = {};
  for (const provider of providerIds) {
    const entry = providerRecord[provider];
    if (entry === undefined) continue;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new TypeError("Provider settings are invalid");
    const entryRecord = entry as Readonly<Record<string, unknown>>;
    if (Object.keys(entryRecord).length !== 1 || !Array.isArray(entryRecord.languageMappings)) throw new TypeError("Provider settings are invalid");
    providers[provider] = { languageMappings: validateMappings(entryRecord.languageMappings as ProviderLanguageMapping[]) };
  }
  return { schemaVersion: 1, revision: record.revision as number, providers };
}
