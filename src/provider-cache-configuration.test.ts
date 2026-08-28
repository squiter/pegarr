import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigurationError } from "./config.js";
import { readProviderCacheRuntimeOptions } from "./provider-cache-configuration.js";

test("PEG-CONFIG-012 provider cache TTLs are bounded, asymmetric, and legacy-compatible", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-cache-configuration-"));
  try {
    const databasePath = join(directory, "provider.sqlite");
    assert.deepEqual(readProviderCacheRuntimeOptions({
      DATA_DIR: directory,
      PEGARR_PROVIDER_CACHE_FILE: databasePath,
    }), {
      databasePath,
      positiveTtlMs: 86_400_000,
      emptyTtlMs: 900_000,
      maxEntries: 5_000,
    });
    assert.deepEqual(readProviderCacheRuntimeOptions({
      DATA_DIR: directory,
      PEGARR_PROVIDER_CACHE_FILE: databasePath,
      PEGARR_PROVIDER_CACHE_POSITIVE_TTL_SECONDS: "604800",
      PEGARR_PROVIDER_CACHE_EMPTY_TTL_SECONDS: "300",
      PEGARR_PROVIDER_CACHE_MAX_ENTRIES: "9000",
    }), {
      databasePath,
      positiveTtlMs: 604_800_000,
      emptyTtlMs: 300_000,
      maxEntries: 9_000,
    });
    assert.deepEqual(readProviderCacheRuntimeOptions({
      DATA_DIR: directory,
      PEGARR_PROVIDER_CACHE_FILE: databasePath,
      PEGARR_PROVIDER_CACHE_TTL_SECONDS: "1200",
    }), {
      databasePath,
      positiveTtlMs: 1_200_000,
      emptyTtlMs: 1_200_000,
      maxEntries: 5_000,
    });

    for (const environment of [
      { PEGARR_PROVIDER_CACHE_POSITIVE_TTL_SECONDS: "2592001" },
      { PEGARR_PROVIDER_CACHE_EMPTY_TTL_SECONDS: "0" },
    ]) {
      assert.throws(
        () => readProviderCacheRuntimeOptions({
          DATA_DIR: directory,
          PEGARR_PROVIDER_CACHE_FILE: databasePath,
          ...environment,
        }),
        (error: unknown) => error instanceof ConfigurationError,
      );
    }
  } finally {
    await rm(directory, { recursive: true });
  }
});
