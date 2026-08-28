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
  readonly adminControl?: AccessControl;
  readonly authorization?: string;
}

export interface RequestLogEntry {
  readonly event: "http_request";
  readonly service: "pegarr";
  readonly method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "OTHER";
  readonly route: "dashboard" | "dashboard_asset" | "health" | "readiness" | "demo_feasibility" | "sonarr_status" | "radarr_status" | "missing_inventory" | "item_feasibility" | "grab_prepare" | "grab_execute" | "grab_history" | "grab_reconcile" | "not_found";
  readonly statusCode: number;
  readonly durationMs: number;
}

export interface RequestHandlerOptions {
  readonly now?: () => number;
  readonly log?: (entry: RequestLogEntry) => void;
  readonly adminAccessControl?: AccessControl;
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
  requestBody?: unknown,
): Promise<RouteResult> {
  const parsedUrl = new URL(requestUrl ?? "/", "http://pegarr.invalid");
  const pathname = parsedUrl.pathname;
  const itemSelection = parseItemFeasibilityPath(pathname);
  const grabSelection = parseGrabPath(pathname);
  const grabHistory = pathname === "/api/v1/grabs/history";
  const grabReconciliation = parseGrabReconciliationPath(pathname);
  const protectedLibraryRoute = pathname === "/api/v1/library/missing" || itemSelection !== undefined;
  if (protectedLibraryRoute && access?.control.configured !== true) {
    return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
  }
  const controlledGrabAvailable = services?.controlledGrab !== undefined && access?.adminControl?.configured === true;
  if ((grabSelection !== undefined || grabHistory || grabReconciliation !== undefined) && !controlledGrabAvailable) {
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
  if (grabHistory && method !== "GET") {
    return { statusCode: 405, headers: { allow: "GET" }, body: { service: "pegarr", status: "method_not_allowed" } };
  }
  if (grabReconciliation !== undefined && method !== "POST") {
    return { statusCode: 405, headers: { allow: "POST" }, body: { service: "pegarr", status: "method_not_allowed" } };
  }
  if (grabSelection !== undefined && method !== "POST") {
    return { statusCode: 405, headers: { allow: "POST" }, body: { service: "pegarr", status: "method_not_allowed" } };
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
      return {
        statusCode: body.status === "not_found" ? 404 : 200,
        body: {
          ...body,
          capabilities: { controlledGrab: controlledGrabAvailable },
        },
      };
    } catch {
      return {
        statusCode: 503,
        body: { service: "pegarr", mode: "read_only", status: "unavailable" },
      };
    }
  }

  if (grabSelection !== undefined) {
    const rejection = authorizeAdministratorRoute(access);
    if (rejection !== undefined) return rejection;
    if (services?.controlledGrab === undefined) {
      return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
    }
    try {
      if (grabSelection.action === "prepare") {
        const body = parsePrepareGrabBody(requestBody);
        const result = await services.controlledGrab.prepare(grabSelection.selection, body.releaseId);
        return { statusCode: result.status === "confirmation_required" ? 200 : 409, body: result };
      }
      const body = parseExecuteGrabBody(requestBody);
      const result = await services.controlledGrab.execute(grabSelection.selection, body.challengeId, body.confirmation, body.idempotencyKey);
      return { statusCode: executeGrabStatusCode(result.status), body: result };
    } catch (error) {
      if (error instanceof InvalidRequestBodyError) {
        return { statusCode: 400, body: { service: "pegarr", status: "invalid_request" } };
      }
      return { statusCode: 503, body: { service: "pegarr", status: "controlled_grab_unavailable" } };
    }
  }

  if (grabHistory) {
    const rejection = authorizeAdministratorRoute(access);
    if (rejection !== undefined) return rejection;
    try {
      const limit = boundedHistoryLimit(parsedUrl.searchParams.get("limit"));
      return {
        statusCode: 200,
        body: {
          kind: "grab-audit-history",
          mode: "controlled_grab",
          events: services?.controlledGrab?.history(limit) ?? [],
        },
      };
    } catch {
      return { statusCode: 400, body: { service: "pegarr", status: "invalid_request" } };
    }
  }

  if (grabReconciliation !== undefined) {
    const rejection = authorizeAdministratorRoute(access);
    if (rejection !== undefined) return rejection;
    if (services?.controlledGrab === undefined) {
      return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
    }
    try {
      const body = parseReconcileGrabBody(requestBody);
      const result = services.controlledGrab.reconcile(grabReconciliation.eventId, body.outcome, body.confirmation);
      return { statusCode: reconcileGrabStatusCode(result.status), body: result };
    } catch (error) {
      return error instanceof InvalidRequestBodyError
        ? { statusCode: 400, body: { service: "pegarr", status: "invalid_request" } }
        : { statusCode: 503, body: { service: "pegarr", status: "controlled_grab_unavailable" } };
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

function authorizeAdministratorRoute(access: RouteAccess | undefined): RouteResult | undefined {
  if (access?.adminControl?.configured !== true) {
    return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
  }
  if (access.adminControl.authorize(access.authorization)) return undefined;
  return {
    statusCode: 401,
    headers: { "www-authenticate": 'Bearer realm="pegarr-admin", charset="UTF-8"' },
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

interface GrabPath {
  readonly selection: ItemFeasibilitySelection;
  readonly action: "prepare" | "execute";
}

function parseGrabPath(pathname: string): GrabPath | undefined {
  const match = /^\/api\/v1\/library\/items\/(sonarr|radarr)\/(episode|movie)\/(\d+)\/grab\/(prepare|execute)$/u.exec(pathname);
  if (match === null) return undefined;
  const application = match[1];
  const kind = match[2];
  const itemId = Number(match[3]);
  const action = match[4];
  if (!Number.isSafeInteger(itemId) || itemId < 1 || (action !== "prepare" && action !== "execute")) return undefined;
  if (application === "sonarr" && kind === "episode") return { selection: { application, kind, itemId }, action };
  if (application === "radarr" && kind === "movie") return { selection: { application, kind, itemId }, action };
  return undefined;
}

function parseGrabReconciliationPath(pathname: string): { readonly eventId: string } | undefined {
  const match = /^\/api\/v1\/grabs\/([a-z0-9_-]{8,128})\/reconcile$/iu.exec(pathname);
  return match?.[1] === undefined ? undefined : { eventId: match[1] };
}

class InvalidRequestBodyError extends Error {}

function parsePrepareGrabBody(value: unknown): { readonly releaseId: string } {
  const body = requestRecord(value, ["releaseId"]);
  return { releaseId: requestString(body.releaseId, "releaseId", 64) };
}

function parseExecuteGrabBody(value: unknown): {
  readonly challengeId: string;
  readonly confirmation: string;
  readonly idempotencyKey: string;
} {
  const body = requestRecord(value, ["challengeId", "confirmation", "idempotencyKey"]);
  return {
    challengeId: requestString(body.challengeId, "challengeId", 128),
    confirmation: requestString(body.confirmation, "confirmation", 8_192),
    idempotencyKey: requestString(body.idempotencyKey, "idempotencyKey", 128),
  };
}

function parseReconcileGrabBody(value: unknown): {
  readonly outcome: "grabbed" | "not_grabbed";
  readonly confirmation: string;
} {
  const body = requestRecord(value, ["outcome", "confirmation"]);
  const outcome = requestString(body.outcome, "outcome", 32);
  if (outcome !== "grabbed" && outcome !== "not_grabbed") throw new InvalidRequestBodyError("outcome is invalid");
  return {
    outcome,
    confirmation: requestString(body.confirmation, "confirmation", 8_192),
  };
}

function requestRecord(value: unknown, expectedKeys: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidRequestBodyError();
  const body = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(body).toSorted();
  if (JSON.stringify(keys) !== JSON.stringify([...expectedKeys].toSorted())) throw new InvalidRequestBodyError();
  return body;
}

function requestString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new InvalidRequestBodyError(`${field} is invalid`);
  }
  return value;
}

function boundedHistoryLimit(value: string | null): number {
  if (value === null) return 50;
  if (!/^\d{1,3}$/u.test(value)) throw new InvalidRequestBodyError();
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new InvalidRequestBodyError();
  return limit;
}

function executeGrabStatusCode(status: string): number {
  if (status === "grabbed") return 200;
  if (status === "timeout_unknown") return 202;
  if (status === "challenge_expired") return 410;
  if (status === "revalidation_failed" || status === "confirmation_mismatch" || status === "duplicate_blocked" || status === "duplicate_in_progress" || status === "idempotency_conflict") return 409;
  return 503;
}

function reconcileGrabStatusCode(status: string): number {
  if (status === "reconciled") return 200;
  if (status === "event_not_found") return 404;
  return 409;
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
      const requestBody = request.method === "POST" && safeRequestRoute(request.url).startsWith("grab_")
        ? await readBoundedJsonBody(request)
        : undefined;
      result = await resolveRoute(
        request.method,
        request.url,
        dataDirectory,
        services,
        accessControl === undefined
          ? undefined
          : {
              control: accessControl,
              ...(options.adminAccessControl === undefined
                ? {}
                : { adminControl: options.adminAccessControl }),
              ...(typeof authorization === "string" ? { authorization } : {}),
            },
        requestBody,
      );
    } catch (error) {
      result = {
        statusCode: error instanceof HttpRequestBodyError ? error.statusCode : 500,
        body: {
          service: "pegarr",
          status: error instanceof HttpRequestBodyError ? error.status : "unexpected_failure",
        },
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

class HttpRequestBodyError extends Error {
  readonly statusCode: 400 | 413 | 415;
  readonly status: "invalid_request" | "request_too_large" | "unsupported_media_type";

  constructor(statusCode: 400 | 413 | 415, status: HttpRequestBodyError["status"]) {
    super(status);
    this.statusCode = statusCode;
    this.status = status;
  }
}

async function readBoundedJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"];
  const normalizedContentType = Array.isArray(contentType) ? contentType[0] : contentType;
  if (normalizedContentType === undefined || !/^application\/json(?:\s*;|$)/iu.test(normalizedContentType)) {
    throw new HttpRequestBodyError(415, "unsupported_media_type");
  }
  const declared = request.headers["content-length"];
  if (typeof declared === "string" && /^\d+$/u.test(declared) && Number(declared) > 16 * 1024) {
    request.resume();
    throw new HttpRequestBodyError(413, "request_too_large");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 16 * 1024) {
      request.resume();
      throw new HttpRequestBodyError(413, "request_too_large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpRequestBodyError(400, "invalid_request");
  }
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
  const grab = parseGrabPath(pathname);
  if (grab?.action === "prepare") return "grab_prepare";
  if (grab?.action === "execute") return "grab_execute";
  if (pathname === "/api/v1/grabs/history") return "grab_history";
  if (parseGrabReconciliationPath(pathname) !== undefined) return "grab_reconcile";
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
