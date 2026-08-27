import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AccessControl } from "./access-control.js";
import { dashboardAsset, type DashboardAssetName } from "./dashboard-assets.js";
import { dashboardPage } from "./dashboard-page.js";
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
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export interface RouteAccess {
  readonly control: AccessControl;
  readonly authorization?: string;
}

const dashboardAssetRoutes = new Map<string, DashboardAssetName>([
  ["/assets/dashboard.css", "dashboard.css"],
  ["/assets/dashboard.js", "dashboard.js"],
  ["/assets/dashboard-model.js", "dashboard-model.js"],
]);

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
  access?: RouteAccess,
): Promise<RouteResult> {
  const pathname = new URL(requestUrl ?? "/", "http://pegarr.invalid").pathname;
  if (pathname === "/api/v1/library/missing" && access?.control.configured !== true) {
    return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
  }
  const knownReadOnlyRoutes = new Set([
    "/",
    "/health",
    "/health/ready",
    "/api/v1/feasibility/demo",
    "/api/v1/integrations/sonarr/status",
    "/api/v1/integrations/radarr/status",
    "/api/v1/library/missing",
    ...dashboardAssetRoutes.keys(),
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

  if (pathname === "/") {
    return {
      statusCode: 200,
      headers: {
        "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'none'; object-src 'none'; script-src 'self'; style-src 'self'",
        "content-type": "text/html; charset=utf-8",
      },
      body: dashboardPage,
    };
  }

  const dashboardAssetName = dashboardAssetRoutes.get(pathname);
  if (dashboardAssetName !== undefined) {
    try {
      const asset = await dashboardAsset(dashboardAssetName);
      return {
        statusCode: 200,
        headers: {
          "cache-control": "public, max-age=300",
          "content-type": asset.contentType,
        },
        body: asset.body,
      };
    } catch {
      return {
        statusCode: 503,
        body: { service: "pegarr", status: "asset_unavailable" },
      };
    }
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

  if (pathname === "/api/v1/library/missing") {
    if (access === undefined) {
      return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
    }
    if (!access.control.authorize(access.authorization)) {
      return {
        statusCode: 401,
        headers: { "www-authenticate": 'Bearer realm="pegarr", charset="UTF-8"' },
        body: { service: "pegarr", status: "unauthorized" },
      };
    }
    try {
      return {
        statusCode: 200,
        body: services === undefined
          ? { kind: "missing-item-inventory", mode: "read_only", status: "disabled" }
          : await services.readMissingInventory(),
      };
    } catch {
      return {
        statusCode: 503,
        body: { service: "pegarr", mode: "read_only", status: "unavailable" },
      };
    }
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

export function createRequestHandler(
  dataDirectory: string,
  services?: RuntimeServices,
  accessControl?: AccessControl,
) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const authorization = request.headers.authorization;
    const result = await resolveRoute(
      request.method,
      request.url,
      dataDirectory,
      services,
      accessControl === undefined
        ? undefined
        : {
            control: accessControl,
            ...(typeof authorization === "string" ? { authorization } : {}),
          },
    );
    response.writeHead(result.statusCode, { ...jsonHeaders, ...result.headers });
    response.end(
      typeof result.body === "string" ? result.body : `${JSON.stringify(result.body)}\n`,
    );
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
