import type { FetchImplementation } from "./adapters/fetch-json-transport.js";
import { FetchJsonTransport } from "./adapters/fetch-json-transport.js";
import { SonarrAdapterError, SonarrClient } from "./adapters/sonarr.js";
import type { RuntimeConfiguration } from "./config.js";

export type SonarrIntegrationState =
  | "disabled"
  | "available"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unexpected_status"
  | "invalid_response";

export interface SonarrIntegrationStatus {
  readonly integration: "sonarr";
  readonly mode: "read_only";
  readonly configured: boolean;
  readonly state: SonarrIntegrationState;
  readonly appName?: "Sonarr";
  readonly version?: string;
  readonly isDocker?: boolean;
  readonly retryAfterSeconds?: number;
}

export interface RuntimeServices {
  readSonarrStatus(): Promise<SonarrIntegrationStatus>;
}

export function createRuntimeServices(
  configuration: RuntimeConfiguration,
  options: { readonly fetchImplementation?: FetchImplementation } = {},
): RuntimeServices {
  const sonarrConfiguration = configuration.sonarr;
  if (sonarrConfiguration === undefined) {
    return {
      async readSonarrStatus() {
        return {
          integration: "sonarr",
          mode: "read_only",
          configured: false,
          state: "disabled",
        };
      },
    };
  }

  const transport = new FetchJsonTransport({
    baseUrl: sonarrConfiguration.baseUrl,
    allowedHosts: sonarrConfiguration.allowedHosts,
    allowInsecureHttp: sonarrConfiguration.allowInsecureHttp,
    ...(options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation }),
  });
  const client = new SonarrClient(
    {
      instanceId: sonarrConfiguration.instanceId,
      apiKey: sonarrConfiguration.apiKey.reveal(),
    },
    transport,
  );

  return {
    async readSonarrStatus() {
      try {
        const status = await client.readSystemStatus();
        return {
          integration: "sonarr",
          mode: "read_only",
          configured: true,
          state: "available",
          appName: status.appName,
          version: status.version,
          ...(status.isDocker === undefined ? {} : { isDocker: status.isDocker }),
        };
      } catch (error) {
        if (error instanceof SonarrAdapterError) {
          return {
            integration: "sonarr",
            mode: "read_only",
            configured: true,
            state: error.code,
            ...(error.retryAfterSeconds === undefined
              ? {}
              : { retryAfterSeconds: error.retryAfterSeconds }),
          };
        }
        return {
          integration: "sonarr",
          mode: "read_only",
          configured: true,
          state: "unavailable",
        };
      }
    },
  };
}
