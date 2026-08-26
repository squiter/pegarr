import { pathToFileURL } from "node:url";

import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { loadRuntimeConfiguration } from "./config.js";
import { createRuntimeServices, type RadarrIntegrationStatus } from "./runtime.js";

export interface RadarrProbeOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetchImplementation?: FetchImplementation;
  readonly now?: () => number;
  readonly write: (value: string) => void;
}

export interface RadarrProbeReport extends Omit<RadarrIntegrationStatus, "state"> {
  readonly probe: "radarr-status";
  readonly state: RadarrIntegrationStatus["state"] | "invalid_configuration";
}

export async function runRadarrProbe(options: RadarrProbeOptions): Promise<number> {
  let report: RadarrProbeReport;
  try {
    const configuration = await loadRuntimeConfiguration(options.environment);
    const services = createRuntimeServices(configuration, {
      radarrStatusTtlMs: 0,
      ...(options.fetchImplementation === undefined
        ? {}
        : { fetchImplementation: options.fetchImplementation }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const status = await services.readRadarrStatus();
    report = { probe: "radarr-status", ...status };
  } catch {
    report = {
      probe: "radarr-status",
      integration: "radarr",
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
  process.exitCode = await runRadarrProbe({
    environment: process.env,
    write: (value) => process.stdout.write(value),
  });
}
