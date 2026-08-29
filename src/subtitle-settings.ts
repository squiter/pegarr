import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { SubtitleLanguageRequirement, SubtitlePolicy } from "./domain.js";
import { normalizeLanguage } from "./normalization.js";

export interface SubtitleSettingsInput {
  readonly languages: readonly SubtitleLanguageRequirement[];
}

export interface SubtitleSettingsSnapshot {
  readonly status: "configured" | "unconfigured";
  readonly revision: number;
  readonly policy: SubtitlePolicy;
}

interface StoredSubtitleSettings {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly languages: readonly SubtitleLanguageRequirement[];
}

const maximumSettingsBytes = 64 * 1024;

export class SubtitleSettingsStore {
  readonly #path: string;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.#path = resolve(dataDirectory, "subtitle-settings.json");
  }

  async read(): Promise<SubtitleSettingsSnapshot> {
    const stored = await this.#readStored();
    return stored === undefined
      ? snapshot(0, [])
      : snapshot(stored.revision, stored.languages);
  }

  async update(input: SubtitleSettingsInput): Promise<SubtitleSettingsSnapshot> {
    const languages = validateLanguages(input.languages);
    let result: SubtitleSettingsSnapshot | undefined;
    const operation = this.#writeChain.then(async () => {
      const current = await this.#readStored();
      const revision = (current?.revision ?? 0) + 1;
      const stored: StoredSubtitleSettings = { schemaVersion: 1, revision, languages };
      await this.#writeStored(stored);
      result = snapshot(revision, languages);
    });
    this.#writeChain = operation.catch(() => undefined);
    await operation;
    if (result === undefined) throw new Error("Subtitle settings update did not complete");
    return result;
  }

  async #readStored(): Promise<StoredSubtitleSettings | undefined> {
    let handle;
    try {
      handle = await open(this.#path, "r");
      const buffer = Buffer.alloc(maximumSettingsBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      if (bytesRead > maximumSettingsBytes) throw new TypeError("Subtitle settings exceed the size limit");
      return parseStored(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error instanceof TypeError ? error : new TypeError("Subtitle settings could not be read");
    } finally {
      await handle?.close();
    }
  }

  async #writeStored(value: StoredSubtitleSettings): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.#path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporaryPath, this.#path);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

function snapshot(revision: number, languages: readonly SubtitleLanguageRequirement[]): SubtitleSettingsSnapshot {
  return {
    status: languages.length === 0 ? "unconfigured" : "configured",
    revision,
    policy: {
      source: "explicit_default",
      profileId: "pegarr-default",
      profileName: "Pegarr default",
      languages,
    },
  };
}

function parseStored(value: unknown): StoredSubtitleSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Subtitle settings are invalid");
  const record = value as Readonly<Record<string, unknown>>;
  if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || (record.revision as number) < 1) {
    throw new TypeError("Subtitle settings are invalid");
  }
  if (!Array.isArray(record.languages)) throw new TypeError("Subtitle settings are invalid");
  return { schemaVersion: 1, revision: record.revision as number, languages: validateLanguages(record.languages) };
}

function validateLanguages(value: readonly unknown[]): readonly SubtitleLanguageRequirement[] {
  if (!Array.isArray(value) || value.length > 16) throw new TypeError("Subtitle settings may contain at most 16 languages");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new TypeError(`Subtitle language ${index + 1} is invalid`);
    const record = entry as Readonly<Record<string, unknown>>;
    const allowed = new Set(["code", "required", "forced", "hearingImpaired"]);
    if (Object.keys(record).some((key) => !allowed.has(key))) throw new TypeError(`Subtitle language ${index + 1} is invalid`);
    if (typeof record.code !== "string" || record.code.length > 32) throw new TypeError(`Subtitle language ${index + 1} is invalid`);
    const code = normalizeLanguage(record.code);
    if (seen.has(code)) throw new TypeError("Subtitle languages must be unique");
    seen.add(code);
    if (typeof record.required !== "boolean" || typeof record.forced !== "boolean") throw new TypeError(`Subtitle language ${index + 1} is invalid`);
    if (record.hearingImpaired !== "required" && record.hearingImpaired !== "prefer" && record.hearingImpaired !== "avoid" && record.hearingImpaired !== "either") {
      throw new TypeError(`Subtitle language ${index + 1} is invalid`);
    }
    return {
      code,
      required: record.required,
      forced: record.forced,
      hearingImpaired: record.hearingImpaired,
    };
  });
}
