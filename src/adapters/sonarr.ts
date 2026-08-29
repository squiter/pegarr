import { createHash } from "node:crypto";

import type {
  ArrReleaseCandidate,
  ArrReleaseEvidence,
  ArrGrabReceipt,
  ArrReleaseHandle,
  ArrCatalogAddOptions,
  ArrCatalogAddReceipt,
  CatalogMediaItem,
  MissingItemPage,
  MissingItemQuery,
  MissingMediaItem,
  ReleaseTraits,
  RevalidatedArrRelease,
} from "../domain.js";
import {
  addedArrId,
  catalogTemplate,
  exactLookupRecord,
  existingArrId,
  parseArrQualityProfiles,
  parseArrRootFolders,
  positiveInteger,
  publicArrAddOptions,
  safeCatalogTitle,
  selectedQualityProfile,
  selectedRootFolder,
  verifiedAddedRecord,
} from "./arr-add.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonTransport,
  type JsonRequest,
} from "./http.js";

export type SonarrErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unexpected_status"
  | "invalid_response";

export class SonarrAdapterError extends Error {
  readonly code: SonarrErrorCode;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: SonarrErrorCode,
    message: string,
    options: { readonly status?: number; readonly retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "SonarrAdapterError";
    this.code = code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export type SonarrGrabErrorCode =
  | "timeout"
  | "unauthorized"
  | "rate_limited"
  | "release_unavailable"
  | "upstream_failure"
  | "invalid_response";

export class SonarrGrabError extends Error {
  readonly code: SonarrGrabErrorCode;

  constructor(code: SonarrGrabErrorCode, message: string) {
    super(message);
    this.name = "SonarrGrabError";
    this.code = code;
  }
}

export class SonarrAddError extends Error {
  readonly code: "timeout_unknown" | "verification_unknown" | "unauthorized" | "rate_limited" | "already_exists" | "upstream_failure" | "invalid_response";

  constructor(code: SonarrAddError["code"], message: string) {
    super(message);
    this.name = "SonarrAddError";
    this.code = code;
  }
}

export interface SonarrCatalogAddInput {
  readonly tvdbId: number;
  readonly rootFolderId: number;
  readonly qualityProfileId: number;
  readonly monitored: boolean;
  readonly monitor: "all" | "future" | "missing" | "existing" | "firstSeason" | "lastSeason" | "pilot" | "recent" | "none";
}

export interface SonarrClientOptions {
  readonly instanceId: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export interface SonarrSystemStatus {
  readonly appName: "Sonarr";
  readonly version: string;
  readonly isDocker?: boolean;
  readonly responseBytes?: number;
}

const defaultTimeoutMs = 15_000;
const defaultMaxResponseBytes = 5 * 1024 * 1024;

export class SonarrClient {
  readonly #instanceId: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #transport: JsonTransport;

  constructor(options: SonarrClientOptions, transport: JsonTransport) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(options.instanceId)) {
      throw new TypeError("Sonarr instanceId must be a safe label, not a URL or hostname");
    }
    if (!options.apiKey.trim()) {
      throw new TypeError("Sonarr apiKey must not be empty");
    }

    this.#instanceId = options.instanceId;
    this.#apiKey = options.apiKey;
    this.#timeoutMs = boundedInteger(options.timeoutMs ?? defaultTimeoutMs, 1, 60_000, "timeoutMs");
    this.#maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? defaultMaxResponseBytes,
      1_024,
      10 * 1024 * 1024,
      "maxResponseBytes",
    );
    this.#transport = transport;
  }

  async searchEpisodeReleases(episodeId: number): Promise<readonly ArrReleaseCandidate[]> {
    const normalizedEpisodeId = boundedInteger(episodeId, 1, Number.MAX_SAFE_INTEGER, "episodeId");
    const response = await this.#requestJson({
      method: "GET",
      path: "/api/v3/release",
      query: { episodeId: String(normalizedEpisodeId) },
      headers: {
        accept: "application/json",
        "x-api-key": this.#apiKey,
      },
      timeoutMs: this.#timeoutMs,
      maxResponseBytes: this.#maxResponseBytes,
    });

    assertSuccessfulStatus(response, "release search");
    try {
      return mapSonarrReleaseResponse(response.body, this.#instanceId);
    } catch {
      throw new SonarrAdapterError("invalid_response", "Sonarr returned an invalid release response", {
        status: response.status,
      });
    }
  }

  async lookupSeries(term: string): Promise<readonly CatalogMediaItem[]> {
    const normalizedTerm = boundedLookupTerm(term);
    const response = await this.#requestJson({
      method: "GET",
      path: "/api/v3/series/lookup",
      query: { term: normalizedTerm },
      headers: { accept: "application/json", "x-api-key": this.#apiKey },
      timeoutMs: this.#timeoutMs,
      maxResponseBytes: this.#maxResponseBytes,
    });
    assertSuccessfulStatus(response, "series catalog lookup");
    try {
      return mapSonarrCatalogResponse(response.body, this.#instanceId);
    } catch {
      throw new SonarrAdapterError("invalid_response", "Sonarr returned an invalid catalog response", {
        status: response.status,
      });
    }
  }

  async readCatalogAddOptions(): Promise<ArrCatalogAddOptions> {
    const [rootFolders, qualityProfiles] = await Promise.all([
      this.#readRootFolders(),
      this.#readQualityProfiles(),
    ]);
    return publicArrAddOptions(rootFolders, qualityProfiles);
  }

  async addCatalogSeries(input: SonarrCatalogAddInput): Promise<ArrCatalogAddReceipt> {
    const tvdbId = positiveInteger(input.tvdbId, "tvdbId");
    const monitor = sonarrMonitor(input.monitor);
    if (typeof input.monitored !== "boolean") throw new TypeError("monitored must be a boolean");
    const [lookupResponse, rootFolders, qualityProfiles] = await Promise.all([
      this.#requestJson({
        method: "GET",
        path: "/api/v3/series/lookup",
        query: { term: `tvdb:${tvdbId}` },
        headers: { accept: "application/json", "x-api-key": this.#apiKey },
        timeoutMs: this.#timeoutMs,
        maxResponseBytes: this.#maxResponseBytes,
      }),
      this.#readRootFolders(),
      this.#readQualityProfiles(),
    ]);
    assertSuccessfulStatus(lookupResponse, "series catalog lookup");
    const lookup = exactLookupRecord(lookupResponse.body, "tvdbId", tvdbId);
    if (lookup === undefined) throw new TypeError("Series is no longer present in the Sonarr catalog");
    const title = safeCatalogTitle(lookup);
    const existingId = existingArrId(lookup);
    if (existingId !== undefined) {
      return { status: "already_added", application: "sonarr", instanceId: this.#instanceId, itemId: existingId, title, automaticSearch: false };
    }
    const rootFolder = selectedRootFolder(rootFolders, input.rootFolderId);
    selectedQualityProfile(qualityProfiles, input.qualityProfileId);
    const body = {
      ...catalogTemplate(lookup, sonarrCatalogFields),
      qualityProfileId: input.qualityProfileId,
      rootFolderPath: rootFolder.path,
      monitored: input.monitored,
      seasonFolder: true,
      addOptions: {
        monitor,
        searchForMissingEpisodes: false,
        searchForCutoffUnmetEpisodes: false,
      },
    };
    let response: JsonResponse;
    try {
      response = await this.#transport.requestJson({
        method: "POST",
        path: "/api/v3/series",
        query: {},
        headers: { accept: "application/json", "x-api-key": this.#apiKey },
        body,
        timeoutMs: this.#timeoutMs,
        maxResponseBytes: Math.min(this.#maxResponseBytes, 512 * 1024),
      });
    } catch (error) {
      if (error instanceof JsonTransportError && error.code === "timeout") throw new SonarrAddError("timeout_unknown", "Sonarr add outcome is unknown after a timeout");
      if (error instanceof JsonTransportError && (error.code === "invalid_json" || error.code === "response_too_large")) throw new SonarrAddError("invalid_response", "Sonarr returned an invalid add response");
      throw new SonarrAddError("upstream_failure", "Sonarr add request failed");
    }
    assertAddStatus(response, "Sonarr");
    let itemId: number;
    try {
      itemId = addedArrId(response.body);
    } catch {
      throw new SonarrAddError("invalid_response", "Sonarr returned an invalid add response");
    }
    try {
      const verified = await this.#requestJson({
        method: "GET",
        path: `/api/v3/series/${itemId}`,
        query: {},
        headers: { accept: "application/json", "x-api-key": this.#apiKey },
        timeoutMs: this.#timeoutMs,
        maxResponseBytes: Math.min(this.#maxResponseBytes, 512 * 1024),
      });
      assertSuccessfulStatus(verified, "added series verification");
      verifiedAddedRecord(verified.body, itemId, "tvdbId", tvdbId);
    } catch {
      throw new SonarrAddError("verification_unknown", "Sonarr added the series but its identity could not be verified");
    }
    return { status: "added", application: "sonarr", instanceId: this.#instanceId, itemId, title, automaticSearch: false };
  }

  async #readRootFolders(): Promise<ReturnType<typeof parseArrRootFolders>> {
    const response = await this.#requestJson({
      method: "GET", path: "/api/v3/rootfolder", query: {},
      headers: { accept: "application/json", "x-api-key": this.#apiKey },
      timeoutMs: this.#timeoutMs, maxResponseBytes: Math.min(this.#maxResponseBytes, 512 * 1024),
    });
    assertSuccessfulStatus(response, "root folder list");
    try { return parseArrRootFolders(response.body); } catch { throw new SonarrAdapterError("invalid_response", "Sonarr returned invalid root folders", { status: response.status }); }
  }

  async #readQualityProfiles(): Promise<ReturnType<typeof parseArrQualityProfiles>> {
    const response = await this.#requestJson({
      method: "GET", path: "/api/v3/qualityprofile", query: {},
      headers: { accept: "application/json", "x-api-key": this.#apiKey },
      timeoutMs: this.#timeoutMs, maxResponseBytes: Math.min(this.#maxResponseBytes, 1024 * 1024),
    });
    assertSuccessfulStatus(response, "quality profile list");
    try { return parseArrQualityProfiles(response.body); } catch { throw new SonarrAdapterError("invalid_response", "Sonarr returned invalid quality profiles", { status: response.status }); }
  }

  async revalidateEpisodeRelease(
    episodeId: number,
    releaseId: string,
  ): Promise<RevalidatedArrRelease | undefined> {
    const normalizedEpisodeId = boundedInteger(episodeId, 1, Number.MAX_SAFE_INTEGER, "episodeId");
    const normalizedReleaseId = safeReleaseId(releaseId, "sonarr");
    const response = await this.#requestJson({
      method: "GET",
      path: "/api/v3/release",
      query: { episodeId: String(normalizedEpisodeId) },
      headers: { accept: "application/json", "x-api-key": this.#apiKey },
      timeoutMs: this.#timeoutMs,
      maxResponseBytes: this.#maxResponseBytes,
    });
    assertSuccessfulStatus(response, "release revalidation");
    try {
      return mapSonarrRevalidatedReleaseResponse(response.body, this.#instanceId)
        .find(({ candidate }) => candidate.id === normalizedReleaseId);
    } catch {
      throw new SonarrAdapterError("invalid_response", "Sonarr returned an invalid release response", {
        status: response.status,
      });
    }
  }

  async grabRelease(handle: ArrReleaseHandle): Promise<ArrGrabReceipt> {
    const normalized = validateGrabHandle(handle);
    let response: JsonResponse;
    try {
      response = await this.#transport.requestJson({
        method: "POST",
        path: "/api/v3/release",
        query: {},
        headers: { accept: "application/json", "x-api-key": this.#apiKey },
        body: normalized,
        timeoutMs: this.#timeoutMs,
        maxResponseBytes: Math.min(this.#maxResponseBytes, 256 * 1024),
      });
    } catch (error) {
      if (error instanceof JsonTransportError && error.code === "timeout") {
        throw new SonarrGrabError("timeout", "Sonarr Grab outcome is unknown after a timeout");
      }
      if (error instanceof JsonTransportError && (error.code === "invalid_json" || error.code === "response_too_large")) {
        throw new SonarrGrabError("invalid_response", "Sonarr returned an invalid Grab response");
      }
      throw new SonarrGrabError("upstream_failure", "Sonarr Grab request failed");
    }
    assertGrabStatus(response, "Sonarr");
    return { status: "accepted", responseStatus: 200 };
  }

  async searchSeasonReleases(
    seriesId: number,
    seasonNumber: number,
  ): Promise<readonly ArrReleaseCandidate[]> {
    const normalizedSeriesId = boundedInteger(seriesId, 1, Number.MAX_SAFE_INTEGER, "seriesId");
    const normalizedSeasonNumber = boundedInteger(seasonNumber, 0, 10_000, "seasonNumber");
    const response = await this.#requestJson({
      method: "GET",
      path: "/api/v3/release",
      query: {
        seriesId: String(normalizedSeriesId),
        seasonNumber: String(normalizedSeasonNumber),
      },
      headers: {
        accept: "application/json",
        "x-api-key": this.#apiKey,
      },
      timeoutMs: this.#timeoutMs,
      maxResponseBytes: this.#maxResponseBytes,
    });

    assertSuccessfulStatus(response, "season release search");
    try {
      return mapSonarrReleaseResponse(response.body, this.#instanceId);
    } catch {
      throw new SonarrAdapterError("invalid_response", "Sonarr returned an invalid season release response", {
        status: response.status,
      });
    }
  }

  async listMissingEpisodes(query: MissingItemQuery = {}): Promise<MissingItemPage> {
    const page = boundedInteger(query.page ?? 1, 1, Number.MAX_SAFE_INTEGER, "page");
    const pageSize = boundedInteger(query.pageSize ?? 50, 1, 100, "pageSize");
    const response = await this.#requestJson({
      method: "GET",
      path: "/api/v3/wanted/missing",
      query: {
        page: String(page),
        pageSize: String(pageSize),
        sortKey: "airDateUtc",
        sortDirection: "descending",
        monitored: "true",
        includeSeries: "true",
      },
      headers: {
        accept: "application/json",
        "x-api-key": this.#apiKey,
      },
      timeoutMs: this.#timeoutMs,
      maxResponseBytes: this.#maxResponseBytes,
    });

    assertSuccessfulStatus(response, "missing episode list");
    try {
      return mapSonarrMissingResponse(response.body, this.#instanceId);
    } catch {
      throw new SonarrAdapterError("invalid_response", "Sonarr returned an invalid missing episode response", {
        status: response.status,
      });
    }
  }

  async readSystemStatus(): Promise<SonarrSystemStatus> {
    const response = await this.#requestJson({
      method: "GET",
      path: "/api/v3/system/status",
      query: {},
      headers: {
        accept: "application/json",
        "x-api-key": this.#apiKey,
      },
      timeoutMs: this.#timeoutMs,
      maxResponseBytes: Math.min(this.#maxResponseBytes, 256 * 1024),
    });

    assertSuccessfulStatus(response, "status probe");
    try {
      const status = mapSonarrSystemStatus(response.body);
      const responseBytes = optionalBoundedInteger(
        response.responseBytes,
        0,
        256 * 1024,
        "system status responseBytes",
      );
      return {
        ...status,
        ...(responseBytes === undefined ? {} : { responseBytes }),
      };
    } catch {
      throw new SonarrAdapterError("invalid_response", "Sonarr returned an invalid status response", {
        status: response.status,
      });
    }
  }

  async #requestJson(request: JsonRequest): Promise<JsonResponse> {
    try {
      return await this.#transport.requestJson(request);
    } catch (error) {
      if (
        error instanceof JsonTransportError &&
        (error.code === "invalid_json" || error.code === "response_too_large")
      ) {
        throw new SonarrAdapterError("invalid_response", "Sonarr returned an invalid response");
      }
      throw new SonarrAdapterError("unavailable", "Sonarr request transport failed");
    }
  }
}

export function mapSonarrSystemStatus(body: unknown): SonarrSystemStatus {
  const status = record(body, "system status");
  const appName = requiredString(status.appName, "system status.appName");
  if (appName.toLowerCase() !== "sonarr") {
    throw new TypeError("system status.appName must identify Sonarr");
  }
  const version = requiredString(status.version, "system status.version");
  if (!/^[0-9][0-9a-z._+-]{0,63}$/iu.test(version)) {
    throw new TypeError("system status.version must be a safe version label");
  }
  const isDocker = optionalBoolean(status.isDocker, "system status.isDocker");

  return {
    appName: "Sonarr",
    version,
    ...(isDocker === undefined ? {} : { isDocker }),
  };
}

export function mapSonarrReleaseResponse(
  body: unknown,
  instanceId = "sonarr",
): readonly ArrReleaseCandidate[] {
  if (!Array.isArray(body)) {
    throw new TypeError("Sonarr release response must be an array");
  }

  return body.map((value, index) => mapRelease(value, index, instanceId));
}

export function mapSonarrCatalogResponse(
  body: unknown,
  instanceId = "sonarr",
): readonly CatalogMediaItem[] {
  if (!Array.isArray(body)) throw new TypeError("Sonarr catalog response must be an array");
  return body.slice(0, 20).map((value, index) => {
    const row = record(value, `series lookup[${index}]`);
    const tvdb = optionalNumericIdentifier(row.tvdbId, `series lookup[${index}].tvdbId`);
    const tmdb = optionalNumericIdentifier(row.tmdbId, `series lookup[${index}].tmdbId`);
    const imdb = optionalImdbIdentifier(row.imdbId, `series lookup[${index}].imdbId`);
    if (tvdb === undefined && tmdb === undefined && imdb === undefined) {
      throw new TypeError(`series lookup[${index}] must contain a stable identifier`);
    }
    const existingId = row.id === undefined || row.id === null || row.id === 0
      ? undefined
      : boundedInteger(requiredNumber(row.id, `series lookup[${index}].id`), 1, Number.MAX_SAFE_INTEGER, `series lookup[${index}].id`);
    return {
      application: "sonarr",
      instanceId,
      kind: "series",
      title: boundedRequiredString(row.title, `series lookup[${index}].title`),
      ...optionalPositiveIntegerField("year", row.year, `series lookup[${index}].year`),
      ids: {
        ...(tvdb === undefined ? {} : { tvdb }),
        ...(tmdb === undefined ? {} : { tmdb }),
        ...(imdb === undefined ? {} : { imdb }),
      },
      alreadyAdded: existingId !== undefined,
    };
  });
}

export function mapSonarrRevalidatedReleaseResponse(
  body: unknown,
  instanceId = "sonarr",
): readonly RevalidatedArrRelease[] {
  if (!Array.isArray(body)) throw new TypeError("Sonarr release response must be an array");
  return body.map((value, index) => {
    const row = record(value, `release[${index}]`);
    return {
      candidate: mapRelease(value, index, instanceId),
      handle: {
        guid: requiredString(row.guid, `release[${index}].guid`),
        indexerId: boundedInteger(requiredNumber(row.indexerId, `release[${index}].indexerId`), 1, Number.MAX_SAFE_INTEGER, `release[${index}].indexerId`),
      },
    };
  });
}

export function mapSonarrMissingResponse(
  body: unknown,
  instanceId = "sonarr",
): MissingItemPage {
  const envelope = record(body, "missing episode response");
  if (!Array.isArray(envelope.records)) {
    throw new TypeError("missing episode response.records must be an array");
  }
  return {
    page: boundedInteger(requiredNumber(envelope.page, "missing episode response.page"), 1, Number.MAX_SAFE_INTEGER, "missing episode response.page"),
    pageSize: boundedInteger(requiredNumber(envelope.pageSize, "missing episode response.pageSize"), 1, 100, "missing episode response.pageSize"),
    totalRecords: boundedInteger(requiredNumber(envelope.totalRecords, "missing episode response.totalRecords"), 0, Number.MAX_SAFE_INTEGER, "missing episode response.totalRecords"),
    items: envelope.records.map((value, index) => mapMissingEpisode(value, index, instanceId)),
  };
}

function mapMissingEpisode(value: unknown, index: number, instanceId: string): MissingMediaItem {
  const row = record(value, `missing episode[${index}]`);
  const series = record(row.series, `missing episode[${index}].series`);
  const imdb = optionalImdbIdentifier(series.imdbId, `missing episode[${index}].series.imdbId`);
  const tmdb = optionalNumericIdentifier(series.tmdbId, `missing episode[${index}].series.tmdbId`);
  const tvdb = optionalNumericIdentifier(row.tvdbId, `missing episode[${index}].tvdbId`);
  return {
    application: "sonarr",
    instanceId,
    kind: "episode",
    itemId: boundedInteger(requiredNumber(row.id, `missing episode[${index}].id`), 1, Number.MAX_SAFE_INTEGER, `missing episode[${index}].id`),
    parentId: boundedInteger(requiredNumber(row.seriesId, `missing episode[${index}].seriesId`), 1, Number.MAX_SAFE_INTEGER, `missing episode[${index}].seriesId`),
    title: boundedRequiredString(row.title, `missing episode[${index}].title`),
    parentTitle: boundedRequiredString(series.title, `missing episode[${index}].series.title`),
    ...optionalPositiveIntegerField("year", series.year, `missing episode[${index}].series.year`),
    season: boundedInteger(requiredNumber(row.seasonNumber, `missing episode[${index}].seasonNumber`), 0, 10_000, `missing episode[${index}].seasonNumber`),
    episode: boundedInteger(requiredNumber(row.episodeNumber, `missing episode[${index}].episodeNumber`), 0, 100_000, `missing episode[${index}].episodeNumber`),
    monitored: requiredBoolean(row.monitored, `missing episode[${index}].monitored`),
    hasFile: requiredBoolean(row.hasFile, `missing episode[${index}].hasFile`),
    ...optionalTimestampField("availableAt", row.airDateUtc, `missing episode[${index}].airDateUtc`),
    ids: {
      ...(imdb === undefined ? {} : { imdb }),
      ...(tmdb === undefined ? {} : { tmdb }),
      ...(tvdb === undefined ? {} : { tvdb }),
    },
  };
}

function mapRelease(value: unknown, index: number, instanceId: string): ArrReleaseCandidate {
  const row = record(value, `release[${index}]`);
  const guid = requiredString(row.guid, `release[${index}].guid`);
  const indexerId = boundedInteger(
    requiredNumber(row.indexerId, `release[${index}].indexerId`),
    1,
    Number.MAX_SAFE_INTEGER,
    `release[${index}].indexerId`,
  );
  const title = requiredString(row.title, `release[${index}].title`);
  const indexer = requiredString(row.indexer, `release[${index}].indexer`);
  const protocol = requiredString(row.protocol, `release[${index}].protocol`);
  const downloadAllowed = requiredBoolean(
    row.downloadAllowed,
    `release[${index}].downloadAllowed`,
  );
  const rejectionReasons = stringArray(row.rejections, `release[${index}].rejections`);
  const customFormatScore = requiredNumber(
    row.customFormatScore,
    `release[${index}].customFormatScore`,
  );
  const releaseGroup = optionalString(row.releaseGroup);
  const quality = nestedRecord(row.quality, "quality");
  const qualityDefinition = nestedRecord(quality?.quality, "quality.quality");
  const qualityName = optionalString(qualityDefinition?.name);
  const qualitySource = optionalString(qualityDefinition?.source);
  const qualityResolution = optionalNumber(qualityDefinition?.resolution);
  const evidence: ArrReleaseEvidence = {
    application: "sonarr",
    instanceId,
    indexer,
    protocol,
    languages: namedValues(row.languages, `release[${index}].languages`),
    customFormats: customFormats(row.customFormats, `release[${index}].customFormats`),
    ...(qualityName === undefined ? {} : { quality: qualityName }),
    ...optionalNumberField("sizeBytes", row.size),
    ...optionalNumberField("ageHours", row.ageHours),
    ...optionalNumberField("seeders", row.seeders),
    ...optionalNumberField("leechers", row.leechers),
    ...optionalBooleanField("fullSeason", row.fullSeason, `release[${index}].fullSeason`),
    ...optionalIntegerEvidenceField("seasonNumber", row.seasonNumber, 0, 10_000, `release[${index}].seasonNumber`),
    ...optionalIntegerArrayEvidenceField("episodeNumbers", row.episodeNumbers, 0, 100_000, `release[${index}].episodeNumbers`),
  };
  const traits: ReleaseTraits = {
    ...(qualitySource === undefined ? {} : { source: qualitySource }),
    ...(qualityResolution === undefined ? {} : { resolution: `${qualityResolution}p` }),
    ...(releaseGroup === undefined ? {} : { releaseGroup }),
  };

  return {
    id: stableReleaseId(instanceId, indexerId, guid),
    title,
    downloadAllowed,
    rejectionReasons,
    customFormatScore,
    evidence,
    ...(Object.keys(traits).length === 0 ? {} : { traits }),
  };
}

function assertSuccessfulStatus(response: JsonResponse, operation: string): void {
  if (response.status === 200) {
    return;
  }
  if (response.status === 401 || response.status === 403) {
    throw new SonarrAdapterError("unauthorized", "Sonarr rejected the configured credentials", {
      status: response.status,
    });
  }
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers);
    throw new SonarrAdapterError("rate_limited", `Sonarr rate limited the ${operation}`, {
      status: response.status,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }
  if (response.status >= 500) {
    throw new SonarrAdapterError("unavailable", `Sonarr ${operation} is unavailable`, {
      status: response.status,
    });
  }
  throw new SonarrAdapterError("unexpected_status", `Sonarr rejected the ${operation} request`, {
    status: response.status,
  });
}

function assertGrabStatus(response: JsonResponse, application: "Sonarr"): void {
  if (response.status === 200) return;
  if (response.status === 401 || response.status === 403) throw new SonarrGrabError("unauthorized", `${application} rejected the configured credentials`);
  if (response.status === 404 || response.status === 409) throw new SonarrGrabError("release_unavailable", `${application} could not Grab the revalidated release`);
  if (response.status === 429) throw new SonarrGrabError("rate_limited", `${application} rate limited the Grab`);
  throw new SonarrGrabError("upstream_failure", `${application} rejected the Grab request`);
}

function assertAddStatus(response: JsonResponse, application: "Sonarr"): void {
  if (response.status === 200 || response.status === 201) return;
  if (response.status === 401 || response.status === 403) throw new SonarrAddError("unauthorized", `${application} rejected the configured credentials`);
  if (response.status === 409) throw new SonarrAddError("already_exists", `${application} reports that the series already exists`);
  if (response.status === 429) throw new SonarrAddError("rate_limited", `${application} rate limited the add request`);
  throw new SonarrAddError("upstream_failure", `${application} rejected the add request`);
}

const sonarrCatalogFields = [
  "title", "alternateTitles", "sortTitle", "status", "overview", "network", "airTime", "images",
  "originalLanguage", "remotePoster", "seasons", "year", "runtime", "tvdbId", "tvRageId", "tvMazeId",
  "tmdbId", "firstAired", "lastAired", "seriesType", "cleanTitle", "imdbId", "titleSlug", "certification",
  "genres", "ratings",
] as const;

function sonarrMonitor(value: SonarrCatalogAddInput["monitor"]): SonarrCatalogAddInput["monitor"] {
  const allowed: readonly SonarrCatalogAddInput["monitor"][] = ["all", "future", "missing", "existing", "firstSeason", "lastSeason", "pilot", "recent", "none"];
  if (!allowed.includes(value)) throw new TypeError("monitor is invalid");
  return value;
}

function validateGrabHandle(handle: ArrReleaseHandle): Readonly<Record<string, unknown>> {
  const guid = requiredString(handle.guid, "grab.guid");
  if (guid.length > 4_096 || /[\r\n]/u.test(guid)) throw new TypeError("grab.guid must be bounded");
  return { guid, indexerId: boundedInteger(handle.indexerId, 1, Number.MAX_SAFE_INTEGER, "grab.indexerId") };
}

function safeReleaseId(value: string, application: "sonarr"): string {
  if (!new RegExp(`^${application}-[a-f0-9]{24}$`, "u").test(value)) throw new TypeError("releaseId is invalid");
  return value;
}

function parseRetryAfter(headers: Readonly<Record<string, string>>): number | undefined {
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === "retry-after")?.[1];
  if (value === undefined || !/^\d+$/u.test(value)) {
    return undefined;
  }
  return Number(value);
}

function stableReleaseId(instanceId: string, indexerId: number, guid: string): string {
  const digest = createHash("sha256")
    .update(`${instanceId}\0${indexerId}\0${guid}`)
    .digest("hex")
    .slice(0, 24);
  return `sonarr-${digest}`;
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function nestedRecord(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> | undefined {
  return value === undefined || value === null ? undefined : record(value, field);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function boundedRequiredString(value: unknown, field: string): string {
  const result = requiredString(value, field);
  if (result.length > 1_024) {
    throw new TypeError(`${field} must be at most 1024 characters`);
  }
  return result;
}

function optionalImdbIdentifier(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const identifier = boundedRequiredString(value, field);
  if (!/^tt\d{5,12}$/u.test(identifier)) throw new TypeError(`${field} is invalid`);
  return identifier;
}

function optionalNumericIdentifier(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === 0 || value === "") return undefined;
  const number = typeof value === "string" ? Number(value) : requiredNumber(value, field);
  return String(boundedInteger(number, 1, Number.MAX_SAFE_INTEGER, field));
}

function optionalPositiveIntegerField(
  key: "year",
  value: unknown,
  field: string,
): { readonly year?: number } {
  if (value === undefined || value === null || value === 0) return {};
  return { [key]: boundedInteger(requiredNumber(value, field), 1, 9999, field) };
}

function optionalTimestampField(
  key: "availableAt",
  value: unknown,
  field: string,
): { readonly availableAt?: string } {
  if (value === undefined || value === null || value === "") return {};
  const timestamp = boundedRequiredString(value, field);
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${field} is invalid`);
  return { [key]: new Date(milliseconds).toISOString() };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function boundedLookupTerm(value: string): string {
  const term = value.trim();
  if (term.length < 2 || term.length > 200 || /[\u0000-\u001f\u007f]/u.test(term)) {
    throw new TypeError("catalog lookup term must contain 2 through 200 safe characters");
  }
  return term;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${field} must be a boolean`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredBoolean(value, field);
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${field} must be an array of strings`);
  }
  return value;
}

function namedValues(value: unknown, field: string): readonly string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array`);
  }
  return value.map((entry, index) =>
    requiredString(record(entry, `${field}[${index}]`).name, `${field}[${index}].name`),
  );
}

function customFormats(
  value: unknown,
  field: string,
): ArrReleaseEvidence["customFormats"] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array`);
  }
  return value.map((entry, index) => {
    const format = record(entry, `${field}[${index}]`);
    return {
      id: requiredNumber(format.id, `${field}[${index}].id`),
      name: requiredString(format.name, `${field}[${index}].name`),
    };
  });
}

type NumericEvidenceField = "sizeBytes" | "ageHours" | "seeders" | "leechers";

function optionalNumberField<Key extends NumericEvidenceField>(
  key: Key,
  value: unknown,
): Partial<Pick<ArrReleaseEvidence, Key>> {
  const number = optionalNumber(value);
  return number === undefined ? {} : ({ [key]: number } as Partial<Pick<ArrReleaseEvidence, Key>>);
}

function optionalBooleanField(
  key: "fullSeason",
  value: unknown,
  field: string,
): { readonly fullSeason?: boolean } {
  const boolean = optionalBoolean(value, field);
  return boolean === undefined ? {} : { [key]: boolean };
}

function optionalIntegerEvidenceField(
  key: "seasonNumber",
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): { readonly seasonNumber?: number } {
  if (value === undefined || value === null) return {};
  return { [key]: boundedInteger(requiredNumber(value, field), minimum, maximum, field) };
}

function optionalIntegerArrayEvidenceField(
  key: "episodeNumbers",
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): { readonly episodeNumbers?: readonly number[] } {
  if (value === undefined || value === null) return {};
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return {
    [key]: value.map((entry, index) =>
      boundedInteger(requiredNumber(entry, `${field}[${index}]`), minimum, maximum, `${field}[${index}]`),
    ),
  };
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function optionalBoundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  field: string,
): number | undefined {
  return value === undefined ? undefined : boundedInteger(value, minimum, maximum, field);
}
