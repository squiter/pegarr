import type { ArrCatalogAddOptions } from "../domain.js";

export interface ArrRootFolderRecord {
  readonly id: number;
  readonly path: string;
  readonly accessible: boolean;
}

export interface ArrQualityProfileRecord {
  readonly id: number;
  readonly name: string;
}

export function parseArrRootFolders(body: unknown): readonly ArrRootFolderRecord[] {
  if (!Array.isArray(body) || body.length > 64) throw new TypeError("Arr root folders must be a bounded array");
  const seen = new Set<number>();
  return body.map((entry, index) => {
    const record = objectRecord(entry, `root folder[${index}]`);
    const id = positiveInteger(record.id, `root folder[${index}].id`);
    const path = safePath(record.path, `root folder[${index}].path`);
    const accessible = requiredBoolean(record.accessible, `root folder[${index}].accessible`);
    if (seen.has(id)) throw new TypeError("Arr root folder IDs must be unique");
    seen.add(id);
    return { id, path, accessible };
  });
}

export function parseArrQualityProfiles(body: unknown): readonly ArrQualityProfileRecord[] {
  if (!Array.isArray(body) || body.length > 128) throw new TypeError("Arr quality profiles must be a bounded array");
  const seen = new Set<number>();
  return body.map((entry, index) => {
    const record = objectRecord(entry, `quality profile[${index}]`);
    const id = positiveInteger(record.id, `quality profile[${index}].id`);
    const name = safeLabel(record.name, `quality profile[${index}].name`);
    if (seen.has(id)) throw new TypeError("Arr quality profile IDs must be unique");
    seen.add(id);
    return { id, name };
  });
}

export function publicArrAddOptions(
  rootFolders: readonly ArrRootFolderRecord[],
  qualityProfiles: readonly ArrQualityProfileRecord[],
): ArrCatalogAddOptions {
  return {
    rootFolders: rootFolders.map(({ id, path, accessible }) => ({
      id,
      label: rootFolderLabel(path, id),
      accessible,
    })),
    qualityProfiles,
  };
}

export function selectedRootFolder(
  rootFolders: readonly ArrRootFolderRecord[],
  id: number,
): ArrRootFolderRecord {
  positiveInteger(id, "rootFolderId");
  const selected = rootFolders.find((entry) => entry.id === id);
  if (selected === undefined || !selected.accessible) throw new TypeError("Selected root folder is unavailable");
  return selected;
}

export function selectedQualityProfile(
  profiles: readonly ArrQualityProfileRecord[],
  id: number,
): ArrQualityProfileRecord {
  positiveInteger(id, "qualityProfileId");
  const selected = profiles.find((entry) => entry.id === id);
  if (selected === undefined) throw new TypeError("Selected quality profile is unavailable");
  return selected;
}

export function exactLookupRecord(
  body: unknown,
  identifierField: "tvdbId" | "tmdbId",
  identifier: number,
): Readonly<Record<string, unknown>> | undefined {
  if (!Array.isArray(body) || body.length > 20) throw new TypeError("Arr catalog lookup must be a bounded array");
  return body.map((entry, index) => objectRecord(entry, `catalog lookup[${index}]`))
    .find((entry) => entry[identifierField] === identifier);
}

export function safeCatalogTitle(record: Readonly<Record<string, unknown>>): string {
  return safeLabel(record.title, "catalog title", 1_024);
}

export function existingArrId(record: Readonly<Record<string, unknown>>): number | undefined {
  if (record.id === undefined || record.id === null || record.id === 0) return undefined;
  return positiveInteger(record.id, "catalog id");
}

export function addedArrId(body: unknown): number {
  return positiveInteger(objectRecord(body, "add response").id, "add response.id");
}

export function verifiedAddedRecord(
  body: unknown,
  itemId: number,
  identifierField: "tvdbId" | "tmdbId",
  identifier: number,
): Readonly<Record<string, unknown>> {
  const record = objectRecord(body, "added item verification");
  if (positiveInteger(record.id, "added item verification.id") !== positiveInteger(itemId, "itemId")) {
    throw new TypeError("Added item verification returned a different Arr ID");
  }
  if (positiveInteger(record[identifierField], `added item verification.${identifierField}`) !== positiveInteger(identifier, identifierField)) {
    throw new TypeError("Added item verification returned a different catalog identity");
  }
  safeCatalogTitle(record);
  return record;
}

export function catalogTemplate(
  record: Readonly<Record<string, unknown>>,
  allowedFields: readonly string[],
): Readonly<Record<string, unknown>> {
  const allowed = new Set(allowedFields);
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowed.has(key)));
}

export function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
}

function objectRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean`);
  return value;
}

function safePath(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function safeLabel(value: unknown, field: string, maximum = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${field} is invalid`);
  }
  return value.trim();
}

function rootFolderLabel(path: string, id: number): string {
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);
  const candidate = segments.at(-1);
  if (candidate === undefined) return `Root folder ${id}`;
  try {
    return safeLabel(candidate, "root folder label", 80);
  } catch {
    return `Root folder ${id}`;
  }
}
