import type { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { OpenSubtitlesClient } from "./adapters/opensubtitles.js";
import type { OpenSubtitlesRuntimeConfiguration } from "./config.js";
import { readProviderCacheRuntimeOptions } from "./provider-cache-configuration.js";
import { ProviderSearchCache } from "./provider-search-cache.js";
import type { SubtitleWindowSource } from "./provider-policy-search.js";

export interface ManagedOpenSubtitlesSource {
  readonly source: SubtitleWindowSource;
  close(): void;
}

export function createConfiguredOpenSubtitlesSource(options: {
  readonly configuration: OpenSubtitlesRuntimeConfiguration;
  readonly transport: FetchJsonTransport;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): ManagedOpenSubtitlesSource {
  const client = new OpenSubtitlesClient(
    { apiKey: options.configuration.apiKey.reveal() },
    options.transport,
  );
  const cacheOptions = readProviderCacheRuntimeOptions(options.environment);
  if (cacheOptions === undefined) {
    return { source: client, close: () => undefined };
  }
  const cache = new ProviderSearchCache({
    ...cacheOptions,
    provider: "opensubtitles",
    source: client,
  });
  return { source: cache, close: () => cache.close() };
}
