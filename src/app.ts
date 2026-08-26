import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

import { demoFeasibilityInput } from "./fixtures/demo.js";
import { buildFeasibilityReport } from "./matching.js";
import type {
  RadarrIntegrationStatus,
  RuntimeServices,
  SonarrIntegrationStatus,
} from "./runtime.js";

export interface RouteResult {
  readonly statusCode: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
}

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

export function healthResponse(): RouteResult {
  return {
    statusCode: 200,
    body: { service: "pegarr", status: "ok" },
  };
}

export async function readinessResponse(dataDirectory: string): Promise<RouteResult> {
  try {
    await access(dataDirectory, fsConstants.R_OK | fsConstants.W_OK);

    return {
      statusCode: 200,
      body: { service: "pegarr", status: "ready" },
    };
  } catch {
    return {
      statusCode: 503,
      body: { service: "pegarr", status: "not_ready" },
    };
  }
}

export async function resolveRoute(
  method: string | undefined,
  requestUrl: string | undefined,
  dataDirectory: string,
  services?: RuntimeServices,
): Promise<RouteResult> {
  const pathname = new URL(requestUrl ?? "/", "http://pegarr.invalid").pathname;
  const knownReadOnlyRoutes = new Set([
    "/health",
    "/health/ready",
    "/api/v1/feasibility/demo",
    "/api/v1/integrations/sonarr/status",
    "/api/v1/integrations/radarr/status",
  ]);

  if (knownReadOnlyRoutes.has(pathname) && method !== "GET") {
    return {
      statusCode: 405,
      headers: { allow: "GET" },
      body: { service: "pegarr", status: "method_not_allowed" },
    };
  }

  if (pathname === "/health") {
    return healthResponse();
  }

  if (pathname === "/health/ready") {
    return readinessResponse(dataDirectory);
  }

  if (pathname === "/api/v1/feasibility/demo") {
    return {
      statusCode: 200,
      body: buildFeasibilityReport(demoFeasibilityInput),
    };
  }

  if (pathname === "/api/v1/integrations/sonarr/status") {
    return {
      statusCode: 200,
      body: {
        service: "pegarr",
        ...(await safeSonarrStatus(services)),
      },
    };
  }

  if (pathname === "/api/v1/integrations/radarr/status") {
    return {
      statusCode: 200,
      body: {
        service: "pegarr",
        ...(await safeRadarrStatus(services)),
      },
    };
  }

  return {
    statusCode: 404,
    body: { service: "pegarr", status: "not_found" },
  };
}

async function safeRadarrStatus(services: RuntimeServices | undefined): Promise<RadarrIntegrationStatus> {
  if (services === undefined) {
    return {
      integration: "radarr",
      mode: "read_only",
      configured: false,
      state: "disabled",
    };
  }
  try {
    return await services.readRadarrStatus();
  } catch {
    return {
      integration: "radarr",
      mode: "read_only",
      configured: true,
      state: "unavailable",
    };
  }
}

export function createRequestHandler(dataDirectory: string, services?: RuntimeServices) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const result = await resolveRoute(request.method, request.url, dataDirectory, services);
    response.writeHead(result.statusCode, { ...jsonHeaders, ...result.headers });
    response.end(`${JSON.stringify(result.body)}\n`);
  };
}

async function safeSonarrStatus(services: RuntimeServices | undefined): Promise<SonarrIntegrationStatus> {
  if (services === undefined) {
    return {
      integration: "sonarr",
      mode: "read_only",
      configured: false,
      state: "disabled",
    };
  }
  try {
    return await services.readSonarrStatus();
  } catch {
    return {
      integration: "sonarr",
      mode: "read_only",
      configured: true,
      state: "unavailable",
    };
  }
}
