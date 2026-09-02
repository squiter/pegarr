import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { ProviderLanguageMapping } from "./provider-policy-search.js";

const maximumRequestBytes = 64 * 1024;

export async function readBoundedJsonRequest(
  pathValue: string | undefined,
  variableName: string,
): Promise<unknown> {
  const path = pathValue?.trim();
  if (path === undefined || !isAbsolute(path)) {
    throw new TypeError(`${variableName} must be an absolute path`);
  }
  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(maximumRequestBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead === 0 || bytesRead > maximumRequestBytes) {
      throw new TypeError("Report request file must be non-empty and bounded");
    }
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")) as unknown;
  } finally {
    await handle?.close();
  }
}

export function requestRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Report request contains an invalid object");
  }
  return value as Readonly<Record<string, unknown>>;
}

export function requestString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    throw new TypeError("Report request contains an invalid string");
  }
  return value;
}

export function requestPositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Report request contains an invalid number");
  }
  return value;
}

export function requestSeasonNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100_000) {
    throw new TypeError("Request season number must be a non-negative bounded integer");
  }
  return value as number;
}

export function requestMediaIds(value: unknown): Readonly<Record<string, string>> {
  const ids = requestRecord(value);
  const imdb = ids.imdb === undefined ? undefined : requestString(ids.imdb);
  const tmdb = ids.tmdb === undefined ? undefined : requestString(ids.tmdb);
  if (imdb === undefined && tmdb === undefined) {
    throw new TypeError("Report request requires an IMDb or TMDB identifier");
  }
  if (imdb !== undefined && !/^tt\d{5,12}$/u.test(imdb)) {
    throw new TypeError("Report request contains an invalid IMDb identifier");
  }
  if (tmdb !== undefined && !/^[1-9]\d{0,15}$/u.test(tmdb)) {
    throw new TypeError("Report request contains an invalid TMDB identifier");
  }
  return {
    ...(imdb === undefined ? {} : { imdb }),
    ...(tmdb === undefined ? {} : { tmdb }),
  };
}

export function requestLanguageMappings(value: unknown): readonly ProviderLanguageMapping[] {
  if (!Array.isArray(value)) {
    throw new TypeError("subdlLanguages must be an array");
  }
  return value.map((mapping) => {
    const row = requestRecord(mapping);
    return {
      policyCode: requestString(row.policyCode),
      providerCode: requestString(row.providerCode),
    } satisfies ProviderLanguageMapping;
  });
}
