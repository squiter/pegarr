import { pathToFileURL } from "node:url";

import { SubdlAdapterError, SubdlClient, type SubdlSearchWindow } from "./adapters/subdl.js";
import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { loadRuntimeConfiguration } from "./config.js";

export type SubdlProbeState =
  | "disabled"
  | "available"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "unsupported"
  | "unauthorized"
  | "unexpected_status"
  | "invalid_response"
  | "invalid_configuration";

export interface SubdlProbeOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly write: (value: string) => void;
}

export interface SubdlProbeReport {
  readonly probe: "subdl-search";
  readonly provider: "subdl";
  readonly mode: "read_only";
  readonly configured: boolean;
  readonly state: SubdlProbeState;
  readonly requestCount?: 1;
  readonly subtitleCount?: number;
  readonly quotaLimit?: number;
  readonly quotaRemaining?: number;
  readonly quotaResetAtEpochSeconds?: number;
  readonly transportSecurity?: "https" | "explicit_http";
  readonly latencyMs?: number;
  readonly observedAt?: string;
}

export async function runSubdlProbe(options: SubdlProbeOptions): Promise<number> {
  let report: SubdlProbeReport;
  try {
    const configuration = await loadRuntimeConfiguration(options.environment);
    const subdl = configuration.subdl;
    if (subdl === undefined) {
      report = baseReport(false, "disabled");
    } else {
      const window = probeWindow(options.environment);
      const transport = new FetchJsonTransport({
        baseUrl: subdl.baseUrl,
        allowedHosts: subdl.allowedHosts,
        allowInsecureHttp: subdl.allowInsecureHttp,
        ...(options.fetchImplementation === undefined
          ? {}
          : { fetchImplementation: options.fetchImplementation }),
      });
      const client = new SubdlClient({ apiKey: subdl.apiKey.reveal() }, transport);
      const startedAt = (options.now ?? Date.now)();
      const transportSecurity = new URL(subdl.baseUrl).protocol === "https:"
        ? "https"
        : "explicit_http";
      try {
        const result = await client.search(window);
        const completedAt = (options.now ?? Date.now)();
        report = {
          ...baseReport(true, result.status === "success" ? "available" : result.status),
          requestCount: 1,
          subtitleCount: result.subtitles.length,
          ...(result.quota?.limit === undefined ? {} : { quotaLimit: result.quota.limit }),
          ...(result.quota?.remaining === undefined
            ? {}
            : { quotaRemaining: result.quota.remaining }),
          ...(result.quota?.resetAtEpochSeconds === undefined
            ? {}
            : { quotaResetAtEpochSeconds: result.quota.resetAtEpochSeconds }),
          transportSecurity,
          latencyMs: safeElapsed(startedAt, completedAt),
          observedAt: safeTimestamp(completedAt),
        };
      } catch (error) {
        const completedAt = (options.now ?? Date.now)();
        report = {
          ...baseReport(
            true,
            error instanceof SubdlAdapterError ? error.code : "unavailable",
          ),
          requestCount: 1,
          transportSecurity,
          latencyMs: safeElapsed(startedAt, completedAt),
          observedAt: safeTimestamp(completedAt),
        };
      }
    }
  } catch {
    report = baseReport(false, "invalid_configuration");
  }

  options.write(`${JSON.stringify(report)}\n`);
  if (report.state === "available") {
    return 0;
  }
  return report.state === "disabled" || report.state === "invalid_configuration" ? 2 : 1;
}

function probeWindow(
  environment: Readonly<Record<string, string | undefined>>,
): SubdlSearchWindow {
  const kind = required(environment.PEGARR_SUBDL_PROBE_KIND);
  if (kind !== "movie" && kind !== "episode") {
    throw new TypeError("PEGARR_SUBDL_PROBE_KIND must be movie or episode");
  }
  const imdb = optional(environment.PEGARR_SUBDL_PROBE_IMDB_ID);
  const tmdb = optional(environment.PEGARR_SUBDL_PROBE_TMDB_ID);
  if (imdb === undefined && tmdb === undefined) {
    throw new TypeError("SubDL probe requires an IMDb or TMDB identifier");
  }
  if (imdb !== undefined && !/^tt\d{5,12}$/u.test(imdb)) {
    throw new TypeError("SubDL probe IMDb identifier is invalid");
  }
  if (tmdb !== undefined) {
    const numericTmdb = Number(tmdb);
    if (!/^\d+$/u.test(tmdb) || !Number.isSafeInteger(numericTmdb) || numericTmdb < 1) {
      throw new TypeError("SubDL probe TMDB identifier is invalid");
    }
  }
  const policyCode = required(environment.PEGARR_SUBDL_PROBE_POLICY_LANGUAGE);
  const providerCode = required(environment.PEGARR_SUBDL_PROBE_PROVIDER_LANGUAGE);
  if (!/^[a-z][a-z0-9_-]{0,31}$/iu.test(policyCode) || !/^[a-z][a-z0-9_-]{0,31}$/iu.test(providerCode)) {
    throw new TypeError("SubDL probe language mapping is invalid");
  }
  const episodeFields = kind === "episode"
    ? {
        season: seasonNumber(environment.PEGARR_SUBDL_PROBE_SEASON),
        episode: positiveInteger(environment.PEGARR_SUBDL_PROBE_EPISODE),
      }
    : {};

  return {
    item: {
      kind,
      title: "Configured probe item",
      ids: {
        ...(imdb === undefined ? {} : { imdb }),
        ...(tmdb === undefined ? {} : { tmdb }),
      },
      ...episodeFields,
    },
    language: { policyCode, providerCode },
  };
}

function baseReport(configured: boolean, state: SubdlProbeState): SubdlProbeReport {
  return { probe: "subdl-search", provider: "subdl", mode: "read_only", configured, state };
}

function required(value: string | undefined): string {
  const normalized = optional(value);
  if (normalized === undefined) {
    throw new TypeError("Required SubDL probe setting is absent");
  }
  return normalized;
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function positiveInteger(value: string | undefined): number {
  const normalized = required(value);
  if (!/^\d+$/u.test(normalized)) {
    throw new TypeError("SubDL episode coordinates must be positive integers");
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100_000) {
    throw new TypeError("SubDL episode coordinates are outside the supported range");
  }
  return parsed;
}

function seasonNumber(value: string | undefined): number {
  const normalized = required(value);
  if (!/^\d+$/u.test(normalized)) {
    throw new TypeError("SubDL season coordinate must be a non-negative integer");
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed > 100_000) {
    throw new TypeError("SubDL season coordinate is outside the supported range");
  }
  return parsed;
}

function safeElapsed(startedAt: number, completedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) {
    return 0;
  }
  return Math.max(0, Math.min(60_000, Math.round(completedAt - startedAt)));
}

function safeTimestamp(value: number): string {
  return Number.isFinite(value) && value >= 0 && value <= 8.64e15
    ? new Date(value).toISOString()
    : new Date(0).toISOString();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runSubdlProbe({
    environment: process.env,
    write: (value) => process.stdout.write(value),
  });
}
