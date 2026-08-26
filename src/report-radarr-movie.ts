import { pathToFileURL } from "node:url";

import { BazarrClient } from "./adapters/bazarr.js";
import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { RadarrClient } from "./adapters/radarr.js";
import { SubdlClient } from "./adapters/subdl.js";
import { loadRuntimeConfiguration } from "./config.js";
import {
  RadarrMovieFeasibilityService,
  type RadarrMovieFeasibilityRequest,
} from "./movie-feasibility.js";
import {
  readBoundedJsonRequest,
  requestLanguageMappings,
  requestMediaIds,
  requestPositiveInteger,
  requestRecord,
  requestString,
} from "./report-request.js";

export interface RadarrMovieReportOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly write: (value: string) => void;
}

export async function runRadarrMovieReport(options: RadarrMovieReportOptions): Promise<number> {
  try {
    const configuration = await loadRuntimeConfiguration(options.environment);
    if (
      configuration.radarr === undefined ||
      configuration.bazarr === undefined ||
      configuration.subdl === undefined
    ) {
      writeState(options, "disabled");
      return 2;
    }
    const request = parseRequest(await readBoundedJsonRequest(
      options.environment.PEGARR_MOVIE_REPORT_REQUEST_FILE,
      "PEGARR_MOVIE_REPORT_REQUEST_FILE",
    ));
    const fetchOption = options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation };
    const radarrTransport = new FetchJsonTransport({
      baseUrl: configuration.radarr.baseUrl,
      allowedHosts: configuration.radarr.allowedHosts,
      allowInsecureHttp: configuration.radarr.allowInsecureHttp,
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
    const service = new RadarrMovieFeasibilityService({
      radarr: new RadarrClient(
        {
          instanceId: configuration.radarr.instanceId,
          apiKey: configuration.radarr.apiKey.reveal(),
          timeoutMs: 60_000,
        },
        radarrTransport,
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
    options.write(`${JSON.stringify({ kind: "radarr-movie-feasibility", ...outcome })}\n`);
    return outcome.status === "ready" ? 0 : 1;
  } catch {
    writeState(options, "invalid_configuration");
    return 2;
  }
}

function parseRequest(value: unknown): RadarrMovieFeasibilityRequest {
  const request = requestRecord(value);
  const item = requestRecord(request.item);

  return {
    movieId: requestPositiveInteger(request.movieId),
    item: {
      kind: item.kind === "movie" ? "movie" : invalidKind(),
      title: requestString(item.title),
      ...(item.year === undefined ? {} : { year: requestPositiveInteger(item.year) }),
      ids: requestMediaIds(item.ids),
    },
    subdlLanguages: requestLanguageMappings(request.subdlLanguages),
  };
}

function invalidKind(): never {
  throw new TypeError("Movie report request kind must be movie");
}

function writeState(
  options: RadarrMovieReportOptions,
  status: "disabled" | "invalid_configuration",
): void {
  options.write(`${JSON.stringify({
    kind: "radarr-movie-feasibility",
    mode: "read_only",
    status,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runRadarrMovieReport({
    environment: process.env,
    write: (value) => process.stdout.write(value),
  });
}
