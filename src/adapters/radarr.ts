import { createHash } from "node:crypto";

import type { ArrReleaseCandidate, ArrReleaseEvidence, ReleaseTraits } from "../domain.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonTransport,
  type ReadonlyJsonRequest,
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

export interface RadarrClientOptions {
  readonly instanceId: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
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

  async #requestJson(request: ReadonlyJsonRequest): Promise<JsonResponse> {
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

export function mapRadarrReleaseResponse(
  body: unknown,
  instanceId = "radarr",
): readonly ArrReleaseCandidate[] {
  if (!Array.isArray(body)) {
    throw new TypeError("Radarr release response must be an array");
  }

  return body.map((value, index) => mapRelease(value, index, instanceId));
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
