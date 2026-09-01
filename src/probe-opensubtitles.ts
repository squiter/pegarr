import { pathToFileURL } from "node:url";

import {
  OpenSubtitlesAdapterError,
  OpenSubtitlesClient,
  type OpenSubtitlesSearchWindow,
} from "./adapters/opensubtitles.js";
import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { currentBuildInfo } from "./build-info.js";
import { loadRuntimeConfiguration } from "./config.js";

export type OpenSubtitlesProbeState =
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

export interface OpenSubtitlesProbeOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly write: (value: string) => void;
}

export interface OpenSubtitlesProbeReport {
  readonly probe: "opensubtitles-search";
  readonly provider: "opensubtitles";
  readonly mode: "read_only";
  readonly configured: boolean;
  readonly state: OpenSubtitlesProbeState;
  readonly requestCount?: 1;
  readonly subtitleCount?: number;
  readonly quotaLimit?: number;
  readonly quotaRemaining?: number;
  readonly quotaWindowSeconds?: number;
  readonly transportSecurity?: "https" | "explicit_http";
  readonly latencyMs?: number;
  readonly observedAt?: string;
}

export async function runOpenSubtitlesProbe(
  options: OpenSubtitlesProbeOptions,
): Promise<number> {
  let report: OpenSubtitlesProbeReport;
  try {
    const configuration = await loadRuntimeConfiguration(options.environment);
    const opensubtitles = configuration.opensubtitles;
    if (opensubtitles === undefined) {
      report = baseReport(false, "disabled");
    } else {
      const window = probeWindow(options.environment);
      const transport = new FetchJsonTransport({
        baseUrl: opensubtitles.baseUrl,
        allowedHosts: opensubtitles.allowedHosts,
        allowInsecureHttp: opensubtitles.allowInsecureHttp,
        ...(options.fetchImplementation === undefined
          ? {}
          : { fetchImplementation: options.fetchImplementation }),
      });
      const client = new OpenSubtitlesClient(
        { apiKey: opensubtitles.apiKey.reveal(), userAgent: `Pegarr v${currentBuildInfo.version}` },
        transport,
      );
      const startedAt = (options.now ?? Date.now)();
      const transportSecurity = new URL(opensubtitles.baseUrl).protocol === "https:"
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
          ...(result.quota?.windowSeconds === undefined
            ? {}
            : { quotaWindowSeconds: result.quota.windowSeconds }),
          transportSecurity,
          latencyMs: safeElapsed(startedAt, completedAt),
          observedAt: safeTimestamp(completedAt),
        };
      } catch (error) {
        const completedAt = (options.now ?? Date.now)();
        report = {
          ...baseReport(
            true,
            error instanceof OpenSubtitlesAdapterError ? error.code : "unavailable",
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
  if (report.state === "available") return 0;
  return report.state === "disabled" || report.state === "invalid_configuration" ? 2 : 1;
}

function probeWindow(
  environment: Readonly<Record<string, string | undefined>>,
): OpenSubtitlesSearchWindow {
  const kind = required(environment.PEGARR_OPENSUBTITLES_PROBE_KIND);
  if (kind !== "movie" && kind !== "episode") {
    throw new TypeError("OpenSubtitles probe kind must be movie or episode");
  }
  const imdb = optional(environment.PEGARR_OPENSUBTITLES_PROBE_IMDB_ID);
  const tmdb = optional(environment.PEGARR_OPENSUBTITLES_PROBE_TMDB_ID);
  if (imdb === undefined && tmdb === undefined) {
    throw new TypeError("OpenSubtitles probe requires an IMDb or TMDB identifier");
  }
  if (imdb !== undefined && !/^tt\d{5,12}$/u.test(imdb)) {
    throw new TypeError("OpenSubtitles probe IMDb identifier is invalid");
  }
  if (tmdb !== undefined && !/^[1-9]\d{0,15}$/u.test(tmdb)) {
    throw new TypeError("OpenSubtitles probe TMDB identifier is invalid");
  }
  const policyCode = required(environment.PEGARR_OPENSUBTITLES_PROBE_POLICY_LANGUAGE);
  const providerCode = required(environment.PEGARR_OPENSUBTITLES_PROBE_PROVIDER_LANGUAGE);
  if (
    !/^[a-z][a-z0-9_-]{0,31}$/iu.test(policyCode)
    || !/^[a-z][a-z0-9_-]{0,31}$/iu.test(providerCode)
  ) {
    throw new TypeError("OpenSubtitles probe language mapping is invalid");
  }
  const episodeFields = kind === "episode"
    ? {
        season: positiveInteger(environment.PEGARR_OPENSUBTITLES_PROBE_SEASON),
        episode: positiveInteger(environment.PEGARR_OPENSUBTITLES_PROBE_EPISODE),
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

function baseReport(
  configured: boolean,
  state: OpenSubtitlesProbeState,
): OpenSubtitlesProbeReport {
  return {
    probe: "opensubtitles-search",
    provider: "opensubtitles",
    mode: "read_only",
    configured,
    state,
  };
}

function required(value: string | undefined): string {
  const normalized = optional(value);
  if (normalized === undefined) {
    throw new TypeError("Required OpenSubtitles probe setting is absent");
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
    throw new TypeError("OpenSubtitles episode coordinates must be positive integers");
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100_000) {
    throw new TypeError("OpenSubtitles episode coordinates are outside the supported range");
  }
  return parsed;
}

function safeElapsed(startedAt: number, completedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) return 0;
  return Math.max(0, Math.min(60_000, Math.round(completedAt - startedAt)));
}

function safeTimestamp(value: number): string {
  return Number.isFinite(value) && value >= 0 && value <= 8.64e15
    ? new Date(value).toISOString()
    : new Date(0).toISOString();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runOpenSubtitlesProbe({
    environment: process.env,
    write: (value) => process.stdout.write(value),
  });
}
