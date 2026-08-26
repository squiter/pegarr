import { pathToFileURL } from "node:url";

import { BazarrClient } from "./adapters/bazarr.js";
import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { SonarrClient } from "./adapters/sonarr.js";
import { SubdlClient } from "./adapters/subdl.js";
import { loadRuntimeConfiguration } from "./config.js";
import {
  readBoundedJsonRequest,
  requestLanguageMappings,
  requestMediaIds,
  requestPositiveInteger,
  requestRecord,
  requestString,
} from "./report-request.js";
import {
  SonarrSeasonFeasibilityService,
  type SonarrSeasonFeasibilityRequest,
} from "./season-feasibility.js";

export interface SonarrSeasonReportOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly write: (value: string) => void;
}

export async function runSonarrSeasonReport(options: SonarrSeasonReportOptions): Promise<number> {
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
    const request = parseRequest(await readBoundedJsonRequest(
      options.environment.PEGARR_SEASON_REPORT_REQUEST_FILE,
      "PEGARR_SEASON_REPORT_REQUEST_FILE",
    ));
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
    const service = new SonarrSeasonFeasibilityService({
      sonarr: new SonarrClient({
        instanceId: configuration.sonarr.instanceId,
        apiKey: configuration.sonarr.apiKey.reveal(),
        timeoutMs: 60_000,
      }, sonarrTransport),
      bazarr: new BazarrClient({
        instanceId: configuration.bazarr.instanceId,
        apiKey: configuration.bazarr.apiKey.reveal(),
      }, bazarrTransport),
      subdl: new SubdlClient(
        { apiKey: configuration.subdl.apiKey.reveal() },
        subdlTransport,
      ),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const outcome = await service.build(request);
    options.write(`${JSON.stringify({ kind: "sonarr-season-feasibility", ...outcome })}\n`);
    return outcome.status === "ready" ? 0 : 1;
  } catch {
    writeState(options, "invalid_configuration");
    return 2;
  }
}

function parseRequest(value: unknown): SonarrSeasonFeasibilityRequest {
  const request = requestRecord(value);
  const item = requestRecord(request.item);
  return {
    sonarrSeriesId: requestPositiveInteger(request.sonarrSeriesId),
    seasonNumber: requestPositiveInteger(request.seasonNumber),
    item: {
      kind: item.kind === "season" ? "season" : invalidKind(),
      title: requestString(item.title),
      season: requestPositiveInteger(item.season),
      ids: requestMediaIds(item.ids),
    },
    subdlLanguages: requestLanguageMappings(request.subdlLanguages),
  };
}

function invalidKind(): never {
  throw new TypeError("Season report request kind must be season");
}

function writeState(
  options: SonarrSeasonReportOptions,
  status: "disabled" | "invalid_configuration",
): void {
  options.write(`${JSON.stringify({
    kind: "sonarr-season-feasibility",
    mode: "read_only",
    status,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runSonarrSeasonReport({
    environment: process.env,
    write: (value) => process.stdout.write(value),
  });
}
