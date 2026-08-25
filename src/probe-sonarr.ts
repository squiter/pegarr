import { pathToFileURL } from "node:url";

import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { loadRuntimeConfiguration } from "./config.js";
import { createRuntimeServices, type SonarrIntegrationStatus } from "./runtime.js";

export interface SonarrProbeOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly write: (value: string) => void;
}

export interface SonarrProbeReport extends Omit<SonarrIntegrationStatus, "state"> {
  readonly probe: "sonarr-status";
  readonly state: SonarrIntegrationStatus["state"] | "invalid_configuration";
}

export async function runSonarrProbe(options: SonarrProbeOptions): Promise<number> {
  let report: SonarrProbeReport;
  try {
    const configuration = await loadRuntimeConfiguration(options.environment);
    const services = createRuntimeServices(configuration, {
      sonarrStatusTtlMs: 0,
      ...(options.fetchImplementation === undefined
        ? {}
        : { fetchImplementation: options.fetchImplementation }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const status = await services.readSonarrStatus();
    report = { probe: "sonarr-status", ...status };
  } catch {
    report = {
      probe: "sonarr-status",
      integration: "sonarr",
      mode: "read_only",
      configured: false,
      state: "invalid_configuration",
    };
  }

  options.write(`${JSON.stringify(report)}\n`);
  if (report.state === "available") {
    return 0;
  }
  return report.state === "disabled" || report.state === "invalid_configuration" ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runSonarrProbe({
    environment: process.env,
    write: (value) => process.stdout.write(value),
  });
}
