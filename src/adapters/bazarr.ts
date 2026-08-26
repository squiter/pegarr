import type { SubtitlePolicy } from "../domain.js";
import {
  JsonTransportError,
  type JsonResponse,
  type JsonTransport,
  type ReadonlyJsonRequest,
} from "./http.js";

export type BazarrErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unexpected_status"
  | "invalid_response";

export class BazarrAdapterError extends Error {
  readonly code: BazarrErrorCode;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: BazarrErrorCode,
    message: string,
    options: { readonly status?: number; readonly retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "BazarrAdapterError";
    this.code = code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export interface BazarrClientOptions {
  readonly instanceId: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export type BazarrAudioCondition = "always" | "audio_matches" | "audio_does_not_match";

export interface BazarrProfileItemEvidence {
  readonly id: number;
  readonly language: string;
  readonly hearingImpaired: boolean;
  readonly forced: boolean;
  readonly audioCondition: BazarrAudioCondition;
}

export interface BazarrLanguageProfileEvidence {
  readonly profileId: number;
  readonly name: string;
  readonly cutoffItemId: number | null;
  readonly items: readonly BazarrProfileItemEvidence[];
  readonly mustContain: readonly string[];
  readonly mustNotContain: readonly string[];
  readonly originalFormat: boolean | null;
  readonly tag?: string;
}

export type BazarrMediaKind = "series" | "movie";

export interface BazarrAssignedProfile {
  readonly status: "assigned";
  readonly mediaKind: BazarrMediaKind;
  readonly mediaId: number;
  readonly profileId: number;
}

export interface BazarrUnassignedProfile {
  readonly status: "unassigned";
  readonly mediaKind: BazarrMediaKind;
  readonly mediaId: number;
}

export interface BazarrMissingMedia {
  readonly status: "not_found";
  readonly mediaKind: BazarrMediaKind;
  readonly mediaId: number;
}

export type BazarrProfileAssignment =
  | BazarrAssignedProfile
  | BazarrUnassignedProfile
  | BazarrMissingMedia;

export type BazarrPolicyResolution =
  | {
      readonly status: "resolved";
      readonly assignment: BazarrAssignedProfile;
      readonly profile: BazarrLanguageProfileEvidence;
      readonly policy: SubtitlePolicy;
    }
  | {
      readonly status: "unassigned" | "media_not_found";
      readonly assignment: BazarrProfileAssignment;
    }
  | {
      readonly status: "profile_missing";
      readonly assignment: BazarrAssignedProfile;
    };

const defaultTimeoutMs = 15_000;
const defaultMaxResponseBytes = 1024 * 1024;
const profileResponseLimit = 512 * 1024;
const assignmentResponseLimit = 256 * 1024;

export class BazarrClient {
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #transport: JsonTransport;

  constructor(options: BazarrClientOptions, transport: JsonTransport) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(options.instanceId)) {
      throw new TypeError("Bazarr instanceId must be a safe label, not a URL or hostname");
    }
    if (!options.apiKey.trim()) {
      throw new TypeError("Bazarr apiKey must not be empty");
    }

    this.#apiKey = options.apiKey;
    this.#timeoutMs = boundedInteger(options.timeoutMs ?? defaultTimeoutMs, 1, 60_000, "timeoutMs");
    this.#maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? defaultMaxResponseBytes,
      1_024,
      2 * 1024 * 1024,
      "maxResponseBytes",
    );
    this.#transport = transport;
  }

  async listLanguageProfiles(): Promise<readonly BazarrLanguageProfileEvidence[]> {
    const response = await this.#get(
      "/api/system/languages/profiles",
      {},
      Math.min(this.#maxResponseBytes, profileResponseLimit),
    );
    assertSuccessfulStatus(response, "language profile read");
    try {
      return mapBazarrLanguageProfiles(response.body);
    } catch {
      throw invalidResponse(response.status);
    }
  }

  async readSeriesAssignment(sonarrSeriesId: number): Promise<BazarrProfileAssignment> {
    const mediaId = boundedInteger(
      sonarrSeriesId,
      1,
      Number.MAX_SAFE_INTEGER,
      "sonarrSeriesId",
    );
    const response = await this.#get(
      "/api/series",
      { "seriesid[]": String(mediaId) },
      Math.min(this.#maxResponseBytes, assignmentResponseLimit),
    );
    assertSuccessfulStatus(response, "series profile assignment read");
    try {
      return mapBazarrAssignment(response.body, "series", mediaId);
    } catch {
      throw invalidResponse(response.status);
    }
  }

  async readMovieAssignment(radarrId: number): Promise<BazarrProfileAssignment> {
    const mediaId = boundedInteger(radarrId, 1, Number.MAX_SAFE_INTEGER, "radarrId");
    const response = await this.#get(
      "/api/movies",
      { "radarrid[]": String(mediaId) },
      Math.min(this.#maxResponseBytes, assignmentResponseLimit),
    );
    assertSuccessfulStatus(response, "movie profile assignment read");
    try {
      return mapBazarrAssignment(response.body, "movie", mediaId);
    } catch {
      throw invalidResponse(response.status);
    }
  }

  async #get(
    path: string,
    query: Readonly<Record<string, string>>,
    maxResponseBytes: number,
  ): Promise<JsonResponse> {
    const request: ReadonlyJsonRequest = {
      method: "GET",
      path,
      query,
      headers: { accept: "application/json", "x-api-key": this.#apiKey },
      timeoutMs: this.#timeoutMs,
      maxResponseBytes,
    };
    try {
      return await this.#transport.requestJson(request);
    } catch (error) {
      if (
        error instanceof JsonTransportError &&
        (error.code === "invalid_json" || error.code === "response_too_large")
      ) {
        throw new BazarrAdapterError("invalid_response", "Bazarr returned an invalid response");
      }
      throw new BazarrAdapterError("unavailable", "Bazarr request transport failed");
    }
  }
}

export function mapBazarrLanguageProfiles(
  body: unknown,
): readonly BazarrLanguageProfileEvidence[] {
  if (!Array.isArray(body)) {
    throw new TypeError("Bazarr language profiles response must be an array");
  }
  const profiles = body.map((value, index) => mapProfile(value, index));
  if (new Set(profiles.map(({ profileId }) => profileId)).size !== profiles.length) {
    throw new TypeError("Bazarr language profile IDs must be unique");
  }
  return profiles;
}

export function mapBazarrAssignment(
  body: unknown,
  mediaKind: BazarrMediaKind,
  mediaId: number,
): BazarrProfileAssignment {
  const envelope = record(body, `${mediaKind} assignment response`);
  if (!Array.isArray(envelope.data)) {
    throw new TypeError(`${mediaKind} assignment response.data must be an array`);
  }
  if (envelope.data.length === 0) {
    return { status: "not_found", mediaKind, mediaId };
  }
  if (envelope.data.length !== 1) {
    throw new TypeError(`${mediaKind} assignment response must contain at most one row`);
  }

  const row = record(envelope.data[0], `${mediaKind} assignment response.data[0]`);
  const upstreamIdField = mediaKind === "series" ? "sonarrSeriesId" : "radarrId";
  const upstreamId = positiveInteger(row[upstreamIdField], upstreamIdField);
  if (upstreamId !== mediaId) {
    throw new TypeError(`${mediaKind} assignment response returned a different media ID`);
  }
  if (row.profileId === null) {
    return { status: "unassigned", mediaKind, mediaId };
  }
  return {
    status: "assigned",
    mediaKind,
    mediaId,
    profileId: positiveInteger(row.profileId, "profileId"),
  };
}

export function resolveBazarrPolicy(
  assignment: BazarrProfileAssignment,
  profiles: readonly BazarrLanguageProfileEvidence[],
): BazarrPolicyResolution {
  if (assignment.status === "not_found") {
    return { status: "media_not_found", assignment };
  }
  if (assignment.status === "unassigned") {
    return { status: "unassigned", assignment };
  }

  const profile = profiles.find(({ profileId }) => profileId === assignment.profileId);
  if (profile === undefined) {
    return { status: "profile_missing", assignment };
  }

  return {
    status: "resolved",
    assignment,
    profile,
    policy: {
      source: "bazarr",
      profileId: String(profile.profileId),
      profileName: profile.name,
      languages: profile.items.map((item) => ({
        code: item.language,
        required: true,
        forced: item.forced,
        hearingImpaired: item.hearingImpaired ? "required" : "either",
        sourceItemId: item.id,
        applicability: item.audioCondition,
        cutoff: profile.cutoffItemId === 65_535 || profile.cutoffItemId === item.id,
      })),
    },
  };
}

function mapProfile(value: unknown, index: number): BazarrLanguageProfileEvidence {
  const row = record(value, `profile[${index}]`);
  if (!Array.isArray(row.items) || row.items.length === 0) {
    throw new TypeError(`profile[${index}].items must be a non-empty array`);
  }
  const items = row.items.map((item, itemIndex) => mapProfileItem(item, index, itemIndex));
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    throw new TypeError(`profile[${index}] item IDs must be unique`);
  }
  const cutoffItemId = nullablePositiveInteger(row.cutoff, `profile[${index}].cutoff`);
  if (
    cutoffItemId !== null &&
    cutoffItemId !== 65_535 &&
    !items.some(({ id }) => id === cutoffItemId)
  ) {
    throw new TypeError(`profile[${index}].cutoff must reference a profile item or Any`);
  }

  const tag = nullableOptionalString(row.tag, `profile[${index}].tag`);
  return {
    profileId: positiveInteger(row.profileId, `profile[${index}].profileId`),
    name: requiredString(row.name, `profile[${index}].name`),
    cutoffItemId,
    items,
    mustContain: stringArray(row.mustContain, `profile[${index}].mustContain`),
    mustNotContain: stringArray(row.mustNotContain, `profile[${index}].mustNotContain`),
    originalFormat: nullablePythonBoolean(row.originalFormat, `profile[${index}].originalFormat`),
    ...(tag === undefined ? {} : { tag }),
  };
}

function mapProfileItem(value: unknown, profileIndex: number, itemIndex: number): BazarrProfileItemEvidence {
  const field = `profile[${profileIndex}].items[${itemIndex}]`;
  const row = record(value, field);
  const hearingImpaired = pythonBoolean(row.hi, `${field}.hi`);
  const forced = pythonBoolean(row.forced, `${field}.forced`);
  if (hearingImpaired && forced) {
    throw new TypeError(`${field} cannot require both hearing-impaired and forced subtitles`);
  }
  const excludesMatchingAudio = pythonBoolean(row.audio_exclude, `${field}.audio_exclude`);
  const includesOnlyMatchingAudio = pythonBoolean(
    row.audio_only_include,
    `${field}.audio_only_include`,
  );
  if (excludesMatchingAudio && includesOnlyMatchingAudio) {
    throw new TypeError(`${field} cannot use conflicting audio conditions`);
  }

  return {
    id: positiveInteger(row.id, `${field}.id`),
    language: safeLanguageCode(row.language, `${field}.language`),
    hearingImpaired,
    forced,
    audioCondition: excludesMatchingAudio
      ? "audio_does_not_match"
      : includesOnlyMatchingAudio
        ? "audio_matches"
        : "always",
  };
}

function assertSuccessfulStatus(response: JsonResponse, operation: string): void {
  if (response.status === 200) {
    return;
  }
  if (response.status === 401 || response.status === 403) {
    throw new BazarrAdapterError("unauthorized", "Bazarr rejected the configured credentials", {
      status: response.status,
    });
  }
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers);
    throw new BazarrAdapterError("rate_limited", `Bazarr rate limited the ${operation}`, {
      status: response.status,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }
  if (response.status >= 500) {
    throw new BazarrAdapterError("unavailable", `Bazarr ${operation} is unavailable`, {
      status: response.status,
    });
  }
  throw new BazarrAdapterError("unexpected_status", `Bazarr rejected the ${operation} request`, {
    status: response.status,
  });
}

function invalidResponse(status: number): BazarrAdapterError {
  return new BazarrAdapterError("invalid_response", "Bazarr returned an invalid response", { status });
}

function parseRetryAfter(headers: Readonly<Record<string, string>>): number | undefined {
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === "retry-after")?.[1];
  if (value === undefined || !/^\d+$/u.test(value)) {
    return undefined;
  }
  return Number(value);
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError(`${field} must be a non-empty bounded string`);
  }
  return value;
}

function safeLanguageCode(value: unknown, field: string): string {
  const code = requiredString(value, field);
  if (!/^[a-z][a-z0-9_-]{0,31}$/iu.test(code)) {
    throw new TypeError(`${field} must be a safe language code`);
  }
  return code;
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    value.some((entry) => typeof entry !== "string" || entry.length > 256)
  ) {
    throw new TypeError(`${field} must be a bounded array of strings`);
  }
  return value;
}

function pythonBoolean(value: unknown, field: string): boolean {
  if (value === true || value === 1 || value === "True") {
    return true;
  }
  if (value === false || value === 0 || value === "False") {
    return false;
  }
  throw new TypeError(`${field} must be a Bazarr boolean`);
}

function nullablePythonBoolean(value: unknown, field: string): boolean | null {
  return value === null || value === undefined ? null : pythonBoolean(value, field);
}

function nullableOptionalString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  return requiredString(value, field);
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new TypeError(`${field} must be a number`);
  }
  return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, field);
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : positiveInteger(value, field);
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
