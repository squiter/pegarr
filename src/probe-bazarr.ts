import { pathToFileURL } from "node:url";

import { BazarrAdapterError, BazarrClient } from "./adapters/bazarr.js";
import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { loadRuntimeConfiguration } from "./config.js";

export type BazarrProbeState =
  | "disabled"
  | "available"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unexpected_status"
  | "invalid_response"
  | "invalid_configuration";

export interface BazarrProbeOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly write: (value: string) => void;
}

export interface BazarrProbeReport {
  readonly probe: "bazarr-language-profiles";
  readonly integration: "bazarr";
  readonly mode: "read_only";
  readonly configured: boolean;
  readonly state: BazarrProbeState;
  readonly profileCount?: number;
  readonly languageItemCount?: number;
  readonly responseBytes?: number;
  readonly retryAfterSeconds?: number;
  readonly transportSecurity?: "https" | "explicit_http";
  readonly latencyMs?: number;
  readonly observedAt?: string;
}

export async function runBazarrProbe(options: BazarrProbeOptions): Promise<number> {
  let report: BazarrProbeReport;
  try {
    const configuration = await loadRuntimeConfiguration(options.environment);
    const bazarr = configuration.bazarr;
    if (bazarr === undefined) {
      report = baseReport(false, "disabled");
    } else {
      const transport = new FetchJsonTransport({
        baseUrl: bazarr.baseUrl,
        allowedHosts: bazarr.allowedHosts,
        allowInsecureHttp: bazarr.allowInsecureHttp,
        ...(options.fetchImplementation === undefined
          ? {}
          : { fetchImplementation: options.fetchImplementation }),
      });
      const client = new BazarrClient(
        { instanceId: bazarr.instanceId, apiKey: bazarr.apiKey.reveal() },
        transport,
      );
      const startedAt = (options.now ?? Date.now)();
      const transportSecurity = new URL(bazarr.baseUrl).protocol === "https:"
        ? "https"
        : "explicit_http";
      try {
        const snapshot = await client.readLanguageProfileSnapshot();
        const completedAt = (options.now ?? Date.now)();
        report = {
          ...baseReport(true, "available"),
          profileCount: snapshot.profiles.length,
          languageItemCount: snapshot.profiles.reduce(
            (count, profile) => count + profile.items.length,
            0,
          ),
          ...(snapshot.responseBytes === undefined
            ? {}
            : { responseBytes: snapshot.responseBytes }),
          transportSecurity,
          latencyMs: safeElapsed(startedAt, completedAt),
          observedAt: safeTimestamp(completedAt),
        };
      } catch (error) {
        const completedAt = (options.now ?? Date.now)();
        report = {
          ...baseReport(true, error instanceof BazarrAdapterError ? error.code : "unavailable"),
          ...(error instanceof BazarrAdapterError && error.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
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

function baseReport(configured: boolean, state: BazarrProbeState): BazarrProbeReport {
  return {
    probe: "bazarr-language-profiles",
    integration: "bazarr",
    mode: "read_only",
    configured,
    state,
  };
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
  process.exitCode = await runBazarrProbe({
    environment: process.env,
    write: (value) => process.stdout.write(value),
  });
}
