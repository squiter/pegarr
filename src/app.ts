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
import type { ItemFeasibilitySelection } from "./item-feasibility.js";

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

export interface RequestLogEntry {
  readonly event: "http_request";
  readonly service: "pegarr";
  readonly method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "OTHER";
  readonly route: "dashboard" | "dashboard_asset" | "health" | "readiness" | "demo_feasibility" | "sonarr_status" | "radarr_status" | "missing_inventory" | "item_feasibility" | "not_found";
  readonly statusCode: number;
  readonly durationMs: number;
}

export interface RequestHandlerOptions {
  readonly now?: () => number;
  readonly log?: (entry: RequestLogEntry) => void;
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
  const parsedUrl = new URL(requestUrl ?? "/", "http://pegarr.invalid");
  const pathname = parsedUrl.pathname;
  const itemSelection = parseItemFeasibilityPath(pathname);
  const protectedLibraryRoute = pathname === "/api/v1/library/missing" || itemSelection !== undefined;
  if (protectedLibraryRoute && access?.control.configured !== true) {
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

  if ((knownReadOnlyRoutes.has(pathname) || itemSelection !== undefined) && method !== "GET") {
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
          "cache-control": "no-cache",
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
    const rejection = authorizeLibraryRoute(access);
    if (rejection !== undefined) return rejection;
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

  if (itemSelection !== undefined) {
    const rejection = authorizeLibraryRoute(access);
    if (rejection !== undefined) return rejection;
    try {
      const body = services === undefined
        ? {
            kind: "item-feasibility",
            mode: "read_only",
            status: "disabled",
            selection: itemSelection,
            missingIntegrations: [itemSelection.application, "bazarr", "subdl"],
          }
        : await services.readItemFeasibility(itemSelection, {
            refresh: parsedUrl.searchParams.get("refresh") === "1",
          });
      return { statusCode: body.status === "not_found" ? 404 : 200, body };
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

function authorizeLibraryRoute(access: RouteAccess | undefined): RouteResult | undefined {
  if (access === undefined) {
    return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
  }
  if (access.control.authorize(access.authorization)) return undefined;
  return {
    statusCode: 401,
    headers: { "www-authenticate": 'Bearer realm="pegarr", charset="UTF-8"' },
    body: { service: "pegarr", status: "unauthorized" },
  };
}

function parseItemFeasibilityPath(pathname: string): ItemFeasibilitySelection | undefined {
  const match = /^\/api\/v1\/library\/items\/(sonarr|radarr)\/(episode|movie)\/(\d+)\/feasibility$/u.exec(pathname);
  if (match === null) return undefined;
  const application = match[1];
  const kind = match[2];
  const itemId = Number(match[3]);
  if (!Number.isSafeInteger(itemId) || itemId < 1) return undefined;
  if (application === "sonarr" && kind === "episode") return { application, kind, itemId };
  if (application === "radarr" && kind === "movie") return { application, kind, itemId };
  return undefined;
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
  options: RequestHandlerOptions = {},
) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const now = options.now ?? Date.now;
    const startedAt = now();
    const authorization = request.headers.authorization;
    let result: RouteResult;
    try {
      result = await resolveRoute(
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
    } catch {
      result = {
        statusCode: 500,
        body: { service: "pegarr", status: "unexpected_failure" },
      };
    }
    response.writeHead(result.statusCode, { ...jsonHeaders, ...result.headers });
    response.end(
      typeof result.body === "string" ? result.body : `${JSON.stringify(result.body)}\n`,
    );
    try {
      options.log?.(requestLogEntry(request.method, request.url, result.statusCode, startedAt, now()));
    } catch {
      // Operational logging must never change the HTTP result.
    }
  };
}

export function requestLogEntry(
  method: string | undefined,
  requestUrl: string | undefined,
  statusCode: number,
  startedAt: number,
  completedAt: number,
): RequestLogEntry {
  return {
    event: "http_request",
    service: "pegarr",
    method: safeRequestMethod(method),
    route: safeRequestRoute(requestUrl),
    statusCode: Number.isSafeInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : 500,
    durationMs: safeRequestDuration(startedAt, completedAt),
  };
}

function safeRequestMethod(method: string | undefined): RequestLogEntry["method"] {
  const normalized = method?.toUpperCase();
  return normalized === "GET" || normalized === "HEAD" || normalized === "POST" || normalized === "PUT" || normalized === "PATCH" || normalized === "DELETE" || normalized === "OPTIONS"
    ? normalized
    : "OTHER";
}

function safeRequestRoute(requestUrl: string | undefined): RequestLogEntry["route"] {
  let pathname: string;
  try {
    pathname = new URL(requestUrl ?? "/", "http://pegarr.invalid").pathname;
  } catch {
    return "not_found";
  }
  if (pathname === "/") return "dashboard";
  if (dashboardAssetRoutes.has(pathname)) return "dashboard_asset";
  if (pathname === "/health") return "health";
  if (pathname === "/health/ready") return "readiness";
  if (pathname === "/api/v1/feasibility/demo") return "demo_feasibility";
  if (pathname === "/api/v1/integrations/sonarr/status") return "sonarr_status";
  if (pathname === "/api/v1/integrations/radarr/status") return "radarr_status";
  if (pathname === "/api/v1/library/missing") return "missing_inventory";
  if (parseItemFeasibilityPath(pathname) !== undefined) return "item_feasibility";
  return "not_found";
}

function safeRequestDuration(startedAt: number, completedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) return 0;
  return Math.max(0, Math.min(60_000, Math.round(completedAt - startedAt)));
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
