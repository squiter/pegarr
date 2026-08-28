import { createHash } from "node:crypto";

import type {
  ArrReleaseCandidate,
  ArrReleaseEvidence,
  ArrGrabReceipt,
  ArrReleaseHandle,
  MissingItemPage,
  MissingItemQuery,
  MissingMediaItem,
  ReleaseTraits,
  RevalidatedArrRelease,
} from "../domain.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonTransport,
  type JsonRequest,
} from "./http.js";

export type RadarrErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unexpected_status"
  | "invalid_response";

export class RadarrAdapterError extends Error {
  readonly code: RadarrErrorCode;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: RadarrErrorCode,
    message: string,
    options: { readonly status?: number; readonly retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "RadarrAdapterError";
    this.code = code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export type RadarrGrabErrorCode =
  | "timeout"
  | "unauthorized"
  | "rate_limited"
  | "release_unavailable"
  | "upstream_failure"
  | "invalid_response";

export class RadarrGrabError extends Error {
  readonly code: RadarrGrabErrorCode;

  constructor(code: RadarrGrabErrorCode, message: string) {
    super(message);
    this.name = "RadarrGrabError";
    this.code = code;
  }
}

export interface RadarrClientOptions {
  readonly instanceId: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export interface RadarrSystemStatus {
  readonly appName: "Radarr";
  readonly version: string;
  readonly isDocker?: boolean;
  readonly responseBytes?: number;
}

const defaultTimeoutMs = 15_000;
const defaultMaxResponseBytes = 5 * 1024 * 1024;

export class RadarrClient {
  readonly #instanceId: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #transport: JsonTransport;

  constructor(options: RadarrClientOptions, transport: JsonTransport) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(options.instanceId)) {
      throw new TypeError("Radarr instanceId must be a safe label, not a URL or hostname");
    }
    if (!options.apiKey.trim()) {
      throw new TypeError("Radarr apiKey must not be empty");
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

  async searchMovieReleases(movieId: number): Promise<readonly ArrReleaseCandidate[]> {
    const normalizedMovieId = boundedInteger(movieId, 1, Number.MAX_SAFE_INTEGER, "movieId");
    const response = await this.#requestJson({
      method: "GET",
      path: "/api/v3/release",
      query: { movieId: String(normalizedMovieId) },
      headers: {
        accept: "application/json",
        "x-api-key": this.#apiKey,
      },
      timeoutMs: this.#timeoutMs,
      maxResponseBytes: this.#maxResponseBytes,
    });

    assertSuccessfulStatus(response, "release search");
    try {
      return mapRadarrReleaseResponse(response.body, this.#instanceId);
    } catch {
      throw new RadarrAdapterError("invalid_response", "Radarr returned an invalid release response", {
        status: response.status,
      });
    }
  }

  async revalidateMovieRelease(
    movieId: number,
    releaseId: string,
  ): Promise<RevalidatedArrRelease | undefined> {
    const normalizedMovieId = boundedInteger(movieId, 1, Number.MAX_SAFE_INTEGER, "movieId");
    const normalizedReleaseId = safeReleaseId(releaseId, "radarr");
    const response = await this.#requestJson({
      method: "GET",
      path: "/api/v3/release",
      query: { movieId: String(normalizedMovieId) },
      headers: { accept: "application/json", "x-api-key": this.#apiKey },
      timeoutMs: this.#timeoutMs,
      maxResponseBytes: this.#maxResponseBytes,
    });
    assertSuccessfulStatus(response, "release revalidation");
    try {
      return mapRadarrRevalidatedReleaseResponse(response.body, this.#instanceId)
        .find(({ candidate }) => candidate.id === normalizedReleaseId);
    } catch {
      throw new RadarrAdapterError("invalid_response", "Radarr returned an invalid release response", {
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
        throw new RadarrGrabError("timeout", "Radarr Grab outcome is unknown after a timeout");
      }
      if (error instanceof JsonTransportError && (error.code === "invalid_json" || error.code === "response_too_large")) {
        throw new RadarrGrabError("invalid_response", "Radarr returned an invalid Grab response");
      }
      throw new RadarrGrabError("upstream_failure", "Radarr Grab request failed");
    }
    assertGrabStatus(response, "Radarr");
    return { status: "accepted", responseStatus: 200 };
  }

  async listMissingMovies(query: MissingItemQuery = {}): Promise<MissingItemPage> {
    const page = boundedInteger(query.page ?? 1, 1, Number.MAX_SAFE_INTEGER, "page");
    const pageSize = boundedInteger(query.pageSize ?? 50, 1, 100, "pageSize");
    const response = await this.#requestJson({
      method: "GET",
      path: "/api/v3/wanted/missing",
      query: {
        page: String(page),
        pageSize: String(pageSize),
        sortKey: "releaseDate",
        sortDirection: "descending",
        monitored: "true",
      },
      headers: {
        accept: "application/json",
        "x-api-key": this.#apiKey,
      },
      timeoutMs: this.#timeoutMs,
      maxResponseBytes: this.#maxResponseBytes,
    });

    assertSuccessfulStatus(response, "missing movie list");
    try {
      return mapRadarrMissingResponse(response.body, this.#instanceId);
    } catch {
      throw new RadarrAdapterError("invalid_response", "Radarr returned an invalid missing movie response", {
        status: response.status,
      });
    }
  }

  async readSystemStatus(): Promise<RadarrSystemStatus> {
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
      const status = mapRadarrSystemStatus(response.body);
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
      throw new RadarrAdapterError("invalid_response", "Radarr returned an invalid status response", {
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
        throw new RadarrAdapterError("invalid_response", "Radarr returned an invalid response");
      }
      throw new RadarrAdapterError("unavailable", "Radarr request transport failed");
    }
  }
}

export function mapRadarrSystemStatus(body: unknown): RadarrSystemStatus {
  const status = record(body, "system status");
  const appName = requiredString(status.appName, "system status.appName");
  if (appName.toLowerCase() !== "radarr") {
    throw new TypeError("system status.appName must identify Radarr");
  }
  const version = requiredString(status.version, "system status.version");
  if (!/^[0-9][0-9a-z._+-]{0,63}$/iu.test(version)) {
    throw new TypeError("system status.version must be a safe version label");
  }
  const isDocker = optionalBoolean(status.isDocker, "system status.isDocker");

  return {
    appName: "Radarr",
    version,
    ...(isDocker === undefined ? {} : { isDocker }),
  };
}

export function mapRadarrReleaseResponse(
  body: unknown,
  instanceId = "radarr",
): readonly ArrReleaseCandidate[] {
  if (!Array.isArray(body)) {
    throw new TypeError("Radarr release response must be an array");
  }

  return body.map((value, index) => mapRelease(value, index, instanceId));
}

export function mapRadarrRevalidatedReleaseResponse(
  body: unknown,
  instanceId = "radarr",
): readonly RevalidatedArrRelease[] {
  if (!Array.isArray(body)) throw new TypeError("Radarr release response must be an array");
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

export function mapRadarrMissingResponse(
  body: unknown,
  instanceId = "radarr",
): MissingItemPage {
  const envelope = record(body, "missing movie response");
  if (!Array.isArray(envelope.records)) {
    throw new TypeError("missing movie response.records must be an array");
  }
  return {
    page: boundedInteger(requiredNumber(envelope.page, "missing movie response.page"), 1, Number.MAX_SAFE_INTEGER, "missing movie response.page"),
    pageSize: boundedInteger(requiredNumber(envelope.pageSize, "missing movie response.pageSize"), 1, 100, "missing movie response.pageSize"),
    totalRecords: boundedInteger(requiredNumber(envelope.totalRecords, "missing movie response.totalRecords"), 0, Number.MAX_SAFE_INTEGER, "missing movie response.totalRecords"),
    items: envelope.records.map((value, index) => mapMissingMovie(value, index, instanceId)),
  };
}

function mapMissingMovie(value: unknown, index: number, instanceId: string): MissingMediaItem {
  const row = record(value, `missing movie[${index}]`);
  const imdb = optionalImdbIdentifier(row.imdbId, `missing movie[${index}].imdbId`);
  const tmdb = optionalNumericIdentifier(row.tmdbId, `missing movie[${index}].tmdbId`);
  const availableAt = row.digitalRelease ?? row.physicalRelease ?? row.inCinemas;
  return {
    application: "radarr",
    instanceId,
    kind: "movie",
    itemId: boundedInteger(requiredNumber(row.id, `missing movie[${index}].id`), 1, Number.MAX_SAFE_INTEGER, `missing movie[${index}].id`),
    title: boundedRequiredString(row.title, `missing movie[${index}].title`),
    ...optionalPositiveIntegerField("year", row.year, `missing movie[${index}].year`),
    monitored: requiredBoolean(row.monitored, `missing movie[${index}].monitored`),
    hasFile: requiredBoolean(row.hasFile, `missing movie[${index}].hasFile`),
    ...optionalTimestampField("availableAt", availableAt, `missing movie[${index}].releaseDate`),
    ids: {
      ...(imdb === undefined ? {} : { imdb }),
      ...(tmdb === undefined ? {} : { tmdb }),
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
  const edition = optionalString(row.edition);
  const quality = nestedRecord(row.quality, "quality");
  const qualityDefinition = nestedRecord(quality?.quality, "quality.quality");
  const qualityName = optionalString(qualityDefinition?.name);
  const qualitySource = optionalString(qualityDefinition?.source);
  const qualityResolution = optionalNumber(qualityDefinition?.resolution);
  const evidence: ArrReleaseEvidence = {
    application: "radarr",
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
  };
  const traits: ReleaseTraits = {
    ...(qualitySource === undefined ? {} : { source: qualitySource }),
    ...(qualityResolution === undefined ? {} : { resolution: `${qualityResolution}p` }),
    ...(releaseGroup === undefined ? {} : { releaseGroup }),
    ...(edition === undefined ? {} : { edition }),
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
    throw new RadarrAdapterError("unauthorized", "Radarr rejected the configured credentials", {
      status: response.status,
    });
  }
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers);
    throw new RadarrAdapterError("rate_limited", `Radarr rate limited the ${operation}`, {
      status: response.status,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }
  if (response.status >= 500) {
    throw new RadarrAdapterError("unavailable", `Radarr ${operation} is unavailable`, {
      status: response.status,
    });
  }
  throw new RadarrAdapterError("unexpected_status", `Radarr rejected the ${operation} request`, {
    status: response.status,
  });
}

function assertGrabStatus(response: JsonResponse, application: "Radarr"): void {
  if (response.status === 200) return;
  if (response.status === 401 || response.status === 403) throw new RadarrGrabError("unauthorized", `${application} rejected the configured credentials`);
  if (response.status === 404 || response.status === 409) throw new RadarrGrabError("release_unavailable", `${application} could not Grab the revalidated release`);
  if (response.status === 429) throw new RadarrGrabError("rate_limited", `${application} rate limited the Grab`);
  throw new RadarrGrabError("upstream_failure", `${application} rejected the Grab request`);
}

function validateGrabHandle(handle: ArrReleaseHandle): Readonly<Record<string, unknown>> {
  const guid = requiredString(handle.guid, "grab.guid");
  if (guid.length > 4_096 || /[\r\n]/u.test(guid)) throw new TypeError("grab.guid must be bounded");
  return { guid, indexerId: boundedInteger(handle.indexerId, 1, Number.MAX_SAFE_INTEGER, "grab.indexerId") };
}

function safeReleaseId(value: string, application: "radarr"): string {
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
  return `radarr-${digest}`;
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

function customFormats(value: unknown, field: string): ArrReleaseEvidence["customFormats"] {
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
