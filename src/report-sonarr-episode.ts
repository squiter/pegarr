import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { BazarrClient } from "./adapters/bazarr.js";
import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { SonarrClient } from "./adapters/sonarr.js";
import { SubdlClient } from "./adapters/subdl.js";
import { loadRuntimeConfiguration } from "./config.js";
import {
  SonarrEpisodeFeasibilityService,
  type ProviderLanguageMapping,
  type SonarrEpisodeFeasibilityRequest,
} from "./episode-feasibility.js";

export interface SonarrEpisodeReportOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly write: (value: string) => void;
}

const maximumRequestBytes = 64 * 1024;

export async function runSonarrEpisodeReport(
  options: SonarrEpisodeReportOptions,
): Promise<number> {
  try {
    const configuration = await loadRuntimeConfiguration(options.environment);
    if (
      configuration.sonarr === undefined ||
      configuration.bazarr === undefined ||
      configuration.subdl === undefined
    ) {
      writeState(options, "disabled");
      return 2;
    }
    const request = await readRequestFile(options.environment.PEGARR_EPISODE_REPORT_REQUEST_FILE);
    const fetchOption = options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation };
    const sonarrTransport = new FetchJsonTransport({
      baseUrl: configuration.sonarr.baseUrl,
      allowedHosts: configuration.sonarr.allowedHosts,
      allowInsecureHttp: configuration.sonarr.allowInsecureHttp,
      ...fetchOption,
    });
    const bazarrTransport = new FetchJsonTransport({
      baseUrl: configuration.bazarr.baseUrl,
      allowedHosts: configuration.bazarr.allowedHosts,
      allowInsecureHttp: configuration.bazarr.allowInsecureHttp,
      ...fetchOption,
    });
    const subdlTransport = new FetchJsonTransport({
      baseUrl: configuration.subdl.baseUrl,
      allowedHosts: configuration.subdl.allowedHosts,
      allowInsecureHttp: configuration.subdl.allowInsecureHttp,
      ...fetchOption,
    });
    const service = new SonarrEpisodeFeasibilityService({
      sonarr: new SonarrClient(
        {
          instanceId: configuration.sonarr.instanceId,
          apiKey: configuration.sonarr.apiKey.reveal(),
          timeoutMs: 60_000,
        },
        sonarrTransport,
      ),
      bazarr: new BazarrClient(
        {
          instanceId: configuration.bazarr.instanceId,
          apiKey: configuration.bazarr.apiKey.reveal(),
        },
        bazarrTransport,
      ),
      subdl: new SubdlClient(
        { apiKey: configuration.subdl.apiKey.reveal() },
        subdlTransport,
      ),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const outcome = await service.build(request);
    options.write(`${JSON.stringify({ kind: "sonarr-episode-feasibility", ...outcome })}\n`);
    return outcome.status === "ready" ? 0 : 1;
  } catch {
    writeState(options, "invalid_configuration");
    return 2;
  }
}

async function readRequestFile(
  pathValue: string | undefined,
): Promise<SonarrEpisodeFeasibilityRequest> {
  const path = pathValue?.trim();
  if (path === undefined || !isAbsolute(path)) {
    throw new TypeError("PEGARR_EPISODE_REPORT_REQUEST_FILE must be an absolute path");
  }
  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(maximumRequestBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead === 0 || bytesRead > maximumRequestBytes) {
      throw new TypeError("Episode report request file must be non-empty and bounded");
    }
    return parseRequest(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")) as unknown);
  } finally {
    await handle?.close();
  }
}

function parseRequest(value: unknown): SonarrEpisodeFeasibilityRequest {
  const request = record(value);
  const item = record(request.item);
  const ids = record(item.ids);
  if (!Array.isArray(request.subdlLanguages)) {
    throw new TypeError("subdlLanguages must be an array");
  }
  const languageMappings = request.subdlLanguages.map((mapping) => {
    const row = record(mapping);
    return {
      policyCode: string(row.policyCode),
      providerCode: string(row.providerCode),
    } satisfies ProviderLanguageMapping;
  });
  const mediaIds = Object.fromEntries(
    Object.entries(ids).map(([name, identifier]) => [name, string(identifier)]),
  );

  return {
    episodeId: number(request.episodeId),
    sonarrSeriesId: number(request.sonarrSeriesId),
    item: {
      kind: item.kind === "episode" ? "episode" : invalidKind(),
      title: string(item.title),
      season: number(item.season),
      episode: number(item.episode),
      ids: mediaIds,
    },
    subdlLanguages: languageMappings,
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Episode report request contains an invalid object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    throw new TypeError("Episode report request contains an invalid string");
  }
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Episode report request contains an invalid number");
  }
  return value;
}

function invalidKind(): never {
  throw new TypeError("Episode report request kind must be episode");
}

function writeState(
  options: SonarrEpisodeReportOptions,
  status: "disabled" | "invalid_configuration",
): void {
  options.write(`${JSON.stringify({
    kind: "sonarr-episode-feasibility",
    mode: "read_only",
    status,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runSonarrEpisodeReport({
    environment: process.env,
    write: (value) => process.stdout.write(value),
  });
}
