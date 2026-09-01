import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AccessControl } from "./access-control.js";
import { currentBuildInfo } from "./build-info.js";
import { dashboardAsset, type DashboardAssetName } from "./dashboard-assets.js";
import { dashboardPage } from "./dashboard-page.js";
import { demoFeasibilityInput } from "./fixtures/demo.js";
import { buildFeasibilityReport } from "./matching.js";
import type {
  RadarrIntegrationStatus,
  RuntimeServices,
  SonarrIntegrationStatus,
} from "./runtime.js";
import { SonarrAddError } from "./adapters/sonarr.js";
import { RadarrAddError } from "./adapters/radarr.js";
import type { ItemFeasibilitySelection } from "./item-feasibility.js";
import { SessionStore } from "./session-store.js";

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
  readonly sessionStore?: SessionStore;
  readonly sessionToken?: string;
  readonly sessionAuthenticated?: boolean;
  readonly sessionMutationAuthorized?: boolean;
  readonly secureSessionCookie?: boolean;
}

export interface RequestLogEntry {
  readonly event: "http_request";
  readonly service: "pegarr";
  readonly method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "OTHER";
  readonly route: "dashboard" | "dashboard_asset" | "health" | "readiness" | "version" | "session_status" | "session_login" | "session_logout" | "demo_feasibility" | "sonarr_status" | "radarr_status" | "arr_instances" | "onboarding" | "catalog_search" | "catalog_coverage" | "catalog_add_options" | "catalog_add" | "catalog_continuation" | "subtitle_settings" | "provider_settings" | "missing_inventory" | "item_feasibility" | "grab_prepare" | "grab_execute" | "grab_history" | "grab_reconcile" | "not_found";
  readonly statusCode: number;
  readonly durationMs: number;
}

export interface RequestHandlerOptions {
  readonly now?: () => number;
  readonly log?: (entry: RequestLogEntry) => void;
  readonly adminAccessControl?: AccessControl;
  readonly sessionStore?: SessionStore;
  readonly secureSessionCookie?: boolean;
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
  const catalogSearch = pathname === "/api/v1/catalog/search";
  const catalogCoverage = parseCatalogCoveragePath(pathname);
  const catalogAdd = parseCatalogAddPath(pathname);
  const catalogContinuation = parseCatalogContinuationPath(pathname);
  const catalogContinuationGrab = parseCatalogContinuationGrabPath(pathname);
  const subtitleSettings = pathname === "/api/v1/settings/subtitles";
  const providerSettings = parseProviderSettingsPath(pathname);
  const sessionLogin = pathname === "/api/v1/session/login";
  const sessionLogout = pathname === "/api/v1/session/logout";
  const sessionStatus = pathname === "/api/v1/session";
  const onboarding = pathname === "/api/v1/onboarding";
  if ((sessionStatus || sessionLogin || sessionLogout) && (access?.sessionStore === undefined || access.control.loginConfigured !== true)) {
    return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
  }
  const protectedLibraryRoute = onboarding || catalogSearch || catalogCoverage !== undefined || catalogAdd !== undefined || catalogContinuation !== undefined || subtitleSettings || providerSettings !== undefined || pathname === "/api/v1/library/instances" || pathname === "/api/v1/library/missing" || itemSelection !== undefined;
  if (protectedLibraryRoute && access?.control.configured !== true) {
    return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
  }
  const controlledGrabAvailable = services?.controlledGrab !== undefined && access?.adminControl?.configured === true;
  if (catalogAdd !== undefined && services?.catalogAdd === undefined) {
    return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
  }
  if ((catalogContinuation !== undefined || catalogContinuationGrab !== undefined) && services?.catalogContinuation === undefined) {
    return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
  }
  if ((grabSelection !== undefined || catalogContinuationGrab !== undefined || grabHistory || grabReconciliation !== undefined) && !controlledGrabAvailable) {
    return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
  }
  const knownReadOnlyRoutes = new Set([
    "/",
    "/health",
    "/health/ready",
    "/api/v1/version",
    "/api/v1/feasibility/demo",
    "/api/v1/integrations/sonarr/status",
    "/api/v1/integrations/radarr/status",
    "/api/v1/library/instances",
    "/api/v1/onboarding",
    "/api/v1/catalog/search",
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
  if (catalogContinuationGrab !== undefined && method !== "POST") {
    return { statusCode: 405, headers: { allow: "POST" }, body: { service: "pegarr", status: "method_not_allowed" } };
  }
  if ((sessionLogin || sessionLogout) && method !== "POST") {
    return { statusCode: 405, headers: { allow: "POST" }, body: { service: "pegarr", status: "method_not_allowed" } };
  }
  if (sessionStatus && method !== "GET") {
    return { statusCode: 405, headers: { allow: "GET" }, body: { service: "pegarr", status: "method_not_allowed" } };
  }
  if (subtitleSettings && method !== "GET" && method !== "PUT") {
    return { statusCode: 405, headers: { allow: "GET, PUT" }, body: { service: "pegarr", status: "method_not_allowed" } };
  }
  if (providerSettings !== undefined && method !== "PUT") {
    return { statusCode: 405, headers: { allow: "PUT" }, body: { service: "pegarr", status: "method_not_allowed" } };
  }
  if (catalogCoverage !== undefined && method !== "GET") {
    return { statusCode: 405, headers: { allow: "GET" }, body: { service: "pegarr", status: "method_not_allowed" } };
  }
  if (catalogAdd?.action === "options" && method !== "GET") {
    return { statusCode: 405, headers: { allow: "GET" }, body: { service: "pegarr", status: "method_not_allowed" } };
  }
  if (catalogAdd?.action === "add" && method !== "POST") {
    return { statusCode: 405, headers: { allow: "POST" }, body: { service: "pegarr", status: "method_not_allowed" } };
  }
  if (catalogContinuation !== undefined && method !== "GET") {
    return { statusCode: 405, headers: { allow: "GET" }, body: { service: "pegarr", status: "method_not_allowed" } };
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

  if (pathname === "/api/v1/version") {
    return {
      statusCode: 200,
      body: { kind: "build-info", ...currentBuildInfo },
    };
  }

  if (sessionStatus) {
    if (access?.sessionAuthenticated !== true) return { statusCode: 401, body: { service: "pegarr", status: "unauthorized" } };
    const session = access.sessionStore?.refresh(access.sessionToken);
    return session === undefined
      ? { statusCode: 401, body: { service: "pegarr", status: "unauthorized" } }
      : { statusCode: 200, body: { kind: "session", status: "authenticated", ...session } };
  }

  if (sessionLogin) {
    try {
      const body = parseSessionLoginBody(requestBody);
      const authorization = `Basic ${Buffer.from(`${body.username}:${body.password}`, "utf8").toString("base64")}`;
      if (!access?.control.authorizeLogin(authorization)) {
        return { statusCode: 401, body: { service: "pegarr", status: "unauthorized" } };
      }
      const session = access.sessionStore?.create();
      if (session === undefined) return { statusCode: 503, body: { service: "pegarr", status: "session_unavailable" } };
      return {
        statusCode: 200,
        headers: { "set-cookie": sessionCookie(session.token, session.expiresAt, access.secureSessionCookie === true) },
        body: { kind: "session", status: "authenticated", csrfToken: session.csrfToken, expiresAt: session.expiresAt },
      };
    } catch (error) {
      return error instanceof InvalidRequestBodyError
        ? { statusCode: 400, body: { service: "pegarr", status: "invalid_request" } }
        : { statusCode: 503, body: { service: "pegarr", status: "session_unavailable" } };
    }
  }

  if (sessionLogout) {
    if (access?.sessionAuthenticated === true && access.sessionMutationAuthorized !== true) {
      return { statusCode: 403, body: { service: "pegarr", status: "csrf_required" } };
    }
    access?.sessionStore?.destroy(access.sessionToken);
    return {
      statusCode: 200,
      headers: { "set-cookie": expiredSessionCookie(access?.secureSessionCookie === true) },
      body: { kind: "session", status: "signed_out" },
    };
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

  if (pathname === "/api/v1/library/instances") {
    const rejection = authorizeLibraryRoute(access);
    if (rejection !== undefined) return rejection;
    try {
      return {
        statusCode: 200,
        body: {
          kind: "arr-instance-status",
          mode: "read_only",
          instances: await (services?.readArrInstanceStatuses?.() ?? Promise.resolve([])),
        },
      };
    } catch {
      return { statusCode: 503, body: { service: "pegarr", mode: "read_only", status: "unavailable" } };
    }
  }

  if (onboarding) {
    const rejection = authorizeLibraryRoute(access);
    if (rejection !== undefined) return rejection;
    try {
      const onboardingStatus = await services?.readOnboardingStatus?.();
      if (onboardingStatus === undefined) {
        return { statusCode: 503, body: { service: "pegarr", mode: "read_only", status: "unavailable" } };
      }
      const loginApiAuthorized = access?.control.authorizeLogin(access.authorization) === true;
      const operatorMutation = access?.sessionAuthenticated === true || loginApiAuthorized;
      return {
        statusCode: 200,
        body: {
          ...onboardingStatus,
          access: {
            role: access?.sessionAuthenticated === true
              ? "operator_session"
              : loginApiAuthorized
                ? "operator_api"
                : "legacy_read_only",
            settingsMutation: operatorMutation,
            catalogAddMutation: operatorMutation && onboardingStatus.capabilities.catalogAdd,
            controlledGrab: onboardingStatus.capabilities.controlledGrab
              ? "administrator_token_required"
              : "disabled",
          },
        },
      };
    } catch {
      return { statusCode: 503, body: { service: "pegarr", mode: "read_only", status: "unavailable" } };
    }
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

  if (catalogSearch) {
    const rejection = authorizeLibraryRoute(access);
    if (rejection !== undefined) return rejection;
    const query = parsedUrl.searchParams.get("q")?.trim() ?? "";
    const applicationValue = parsedUrl.searchParams.get("application");
    if (applicationValue !== null && applicationValue !== "sonarr" && applicationValue !== "radarr") {
      return { statusCode: 400, body: { service: "pegarr", mode: "read_only", status: "invalid_request" } };
    }
    if (query.length < 2 || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query)) {
      return { statusCode: 400, body: { service: "pegarr", mode: "read_only", status: "invalid_request" } };
    }
    try {
      return {
        statusCode: 200,
        body: await (services?.searchCatalog(query, applicationValue ?? undefined) ?? Promise.resolve({
          kind: "catalog-search" as const,
          mode: "read_only" as const,
          status: "disabled" as const,
          query: query.trim(),
          items: [],
          sources: [],
          capabilities: { catalogAdd: false },
        })),
      };
    } catch (error) {
      return error instanceof TypeError
        ? { statusCode: 400, body: { service: "pegarr", mode: "read_only", status: "invalid_request" } }
        : { statusCode: 503, body: { service: "pegarr", mode: "read_only", status: "unavailable" } };
    }
  }

  if (catalogCoverage !== undefined) {
    const rejection = authorizeLibraryRoute(access);
    if (rejection !== undefined) return rejection;
    try {
      const result = await services?.previewCatalogCoverage(catalogCoverage);
      if (result === undefined) return { statusCode: 503, body: { service: "pegarr", mode: "read_only", status: "unavailable" } };
      return { statusCode: result.status === "item_not_found" ? 404 : 200, body: result };
    } catch (error) {
      return error instanceof TypeError
        ? { statusCode: 400, body: { service: "pegarr", mode: "read_only", status: "invalid_request" } }
        : { statusCode: 503, body: { service: "pegarr", mode: "read_only", status: "unavailable" } };
    }
  }

  if (catalogContinuation !== undefined) {
    const rejection = authorizeLibraryRoute(access);
    if (rejection !== undefined) return rejection;
    try {
      const result = catalogContinuation.action === "scopes"
        ? await services?.catalogContinuation?.scopes(catalogContinuation.continuationId)
        : await services?.catalogContinuation?.analyze(catalogContinuation.continuationId, catalogContinuation.scope);
      if (result === undefined || result.status === "not_found" || result.status === "scope_not_found") return { statusCode: 404, body: { service: "pegarr", mode: "read_only", status: "not_found" } };
      if (result.status === "scope_required") return { statusCode: 409, body: result };
      return { statusCode: 200, body: result };
    } catch (error) {
      return error instanceof TypeError
        ? { statusCode: 400, body: { service: "pegarr", mode: "read_only", status: "invalid_request" } }
        : { statusCode: 503, body: { service: "pegarr", mode: "read_only", status: "unavailable" } };
    }
  }

  if (catalogContinuationGrab !== undefined) {
    const rejection = authorizeAdministratorRoute(access);
    if (rejection !== undefined) return rejection;
    try {
      if (catalogContinuationGrab.action === "prepare") {
        const body = parsePrepareGrabBody(requestBody);
        const result = await services?.catalogContinuation?.prepareGrab(
          catalogContinuationGrab.continuationId,
          body.releaseId,
          catalogContinuationGrab.scope,
        );
        if (result === undefined) return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
        return { statusCode: result.status === "confirmation_required" ? 200 : 409, body: result };
      }
      const body = parseExecuteGrabBody(requestBody);
      const result = await services?.catalogContinuation?.executeGrab(
        catalogContinuationGrab.continuationId,
        body.challengeId,
        body.confirmation,
        body.idempotencyKey,
        catalogContinuationGrab.scope,
      );
      if (result === undefined) return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
      return { statusCode: executeGrabStatusCode(result.status), body: result };
    } catch (error) {
      return error instanceof InvalidRequestBodyError || error instanceof TypeError
        ? { statusCode: 400, body: { service: "pegarr", status: "invalid_request" } }
        : { statusCode: 503, body: { service: "pegarr", status: "controlled_grab_unavailable" } };
    }
  }

  if (catalogAdd !== undefined) {
    if (catalogAdd.action === "options") {
      const rejection = authorizeLibraryRoute(access);
      if (rejection !== undefined) return rejection;
      try {
        return { statusCode: 200, body: await services?.catalogAdd?.readOptions(catalogAdd.selection) };
      } catch (error) {
        return error instanceof TypeError
          ? { statusCode: 400, body: { service: "pegarr", status: "invalid_request" } }
          : { statusCode: 503, body: { service: "pegarr", status: "catalog_add_options_unavailable" } };
      }
    }
    const rejection = authorizeSettingsMutation(access);
    if (rejection !== undefined) return rejection;
    try {
      const body = parseCatalogAddBody(catalogAdd.selection.application, requestBody);
      const result = await services?.catalogAdd?.add(catalogAdd.selection, body);
      return { statusCode: 200, body: result };
    } catch (error) {
      if (error instanceof InvalidRequestBodyError || error instanceof TypeError) {
        return { statusCode: 400, body: { service: "pegarr", status: "invalid_request" } };
      }
      if ((error instanceof SonarrAddError || error instanceof RadarrAddError) && (error.code === "timeout_unknown" || error.code === "verification_unknown")) {
        return { statusCode: 202, body: { service: "pegarr", mode: "catalog_add", status: error.code } };
      }
      if ((error instanceof SonarrAddError || error instanceof RadarrAddError) && error.code === "already_exists") {
        return { statusCode: 409, body: { service: "pegarr", mode: "catalog_add", status: "already_exists" } };
      }
      return { statusCode: 503, body: { service: "pegarr", mode: "catalog_add", status: "unavailable" } };
    }
  }

  if (subtitleSettings) {
    if (method === "GET") {
      const rejection = authorizeLibraryRoute(access);
      if (rejection !== undefined) return rejection;
      try {
        return { statusCode: 200, body: await services?.readSubtitleSettings() };
      } catch {
        return { statusCode: 503, body: { service: "pegarr", status: "settings_unavailable" } };
      }
    }
    const rejection = authorizeSettingsMutation(access);
    if (rejection !== undefined) return rejection;
    try {
      const body = parseSubtitleSettingsBody(requestBody);
      return { statusCode: 200, body: await services?.updateSubtitleSettings(body) };
    } catch (error) {
      return error instanceof InvalidRequestBodyError || error instanceof TypeError
        ? { statusCode: 400, body: { service: "pegarr", status: "invalid_request" } }
        : { statusCode: 503, body: { service: "pegarr", status: "settings_unavailable" } };
    }
  }

  if (providerSettings !== undefined) {
    const rejection = authorizeSettingsMutation(access);
    if (rejection !== undefined) return rejection;
    try {
      const body = parseProviderSettingsBody(requestBody);
      return { statusCode: 200, body: await services?.updateProviderSettings(providerSettings.provider, body) };
    } catch (error) {
      return error instanceof InvalidRequestBodyError || error instanceof TypeError
        ? { statusCode: 400, body: { service: "pegarr", status: "invalid_request" } }
        : { statusCode: 503, body: { service: "pegarr", status: "settings_unavailable" } };
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
  if (access.sessionAuthenticated === true || access.control.authorize(access.authorization)) return undefined;
  return {
    statusCode: 401,
    headers: { "www-authenticate": access.control.challenge },
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

function authorizeSettingsMutation(access: RouteAccess | undefined): RouteResult | undefined {
  if (access === undefined) return { statusCode: 404, body: { service: "pegarr", status: "not_found" } };
  if (access.control.authorizeLogin(access.authorization)) return undefined;
  if (access.sessionAuthenticated === true) {
    return access.sessionMutationAuthorized === true
      ? undefined
      : { statusCode: 403, body: { service: "pegarr", status: "csrf_required" } };
  }
  if (access.control.authorize(access.authorization)) {
    return { statusCode: 403, body: { service: "pegarr", status: "login_required" } };
  }
  return {
    statusCode: 401,
    headers: { "www-authenticate": 'Basic realm="pegarr-settings", charset="UTF-8"' },
    body: { service: "pegarr", status: "unauthorized" },
  };
}

function parseItemFeasibilityPath(pathname: string): ItemFeasibilitySelection | undefined {
  const scoped = /^\/api\/v1\/library\/items\/(sonarr|radarr)\/([a-z0-9][a-z0-9_-]{0,63})\/(episode|movie)\/(\d+)\/feasibility$/iu.exec(pathname);
  const legacy = /^\/api\/v1\/library\/items\/(sonarr|radarr)\/(episode|movie)\/(\d+)\/feasibility$/u.exec(pathname);
  const match = scoped ?? legacy;
  if (match === null) return undefined;
  const application = match[1];
  const instanceId = scoped === null ? undefined : match[2];
  const kind = scoped === null ? match[2] : match[3];
  const itemId = Number(scoped === null ? match[3] : match[4]);
  if (!Number.isSafeInteger(itemId) || itemId < 1) return undefined;
  if (application === "sonarr" && kind === "episode") return { application, ...(instanceId === undefined ? {} : { instanceId }), kind, itemId };
  if (application === "radarr" && kind === "movie") return { application, ...(instanceId === undefined ? {} : { instanceId }), kind, itemId };
  return undefined;
}

interface GrabPath {
  readonly selection: ItemFeasibilitySelection;
  readonly action: "prepare" | "execute";
}

function parseGrabPath(pathname: string): GrabPath | undefined {
  const scoped = /^\/api\/v1\/library\/items\/(sonarr|radarr)\/([a-z0-9][a-z0-9_-]{0,63})\/(episode|movie)\/(\d+)\/grab\/(prepare|execute)$/iu.exec(pathname);
  const legacy = /^\/api\/v1\/library\/items\/(sonarr|radarr)\/(episode|movie)\/(\d+)\/grab\/(prepare|execute)$/u.exec(pathname);
  const match = scoped ?? legacy;
  if (match === null) return undefined;
  const application = match[1];
  const instanceId = scoped === null ? undefined : match[2];
  const kind = scoped === null ? match[2] : match[3];
  const itemId = Number(scoped === null ? match[3] : match[4]);
  const action = scoped === null ? match[4] : match[5];
  if (!Number.isSafeInteger(itemId) || itemId < 1 || (action !== "prepare" && action !== "execute")) return undefined;
  if (application === "sonarr" && kind === "episode") return { selection: { application, ...(instanceId === undefined ? {} : { instanceId }), kind, itemId }, action };
  if (application === "radarr" && kind === "movie") return { selection: { application, ...(instanceId === undefined ? {} : { instanceId }), kind, itemId }, action };
  return undefined;
}

function parseGrabReconciliationPath(pathname: string): { readonly eventId: string } | undefined {
  const match = /^\/api\/v1\/grabs\/([a-z0-9_-]{8,128})\/reconcile$/iu.exec(pathname);
  return match?.[1] === undefined ? undefined : { eventId: match[1] };
}

function parseCatalogCoveragePath(pathname: string): import("./runtime.js").CatalogCoverageSelection | undefined {
  const match = /^\/api\/v1\/catalog\/(sonarr|radarr)\/([a-z0-9][a-z0-9_-]{0,63})\/(tvdb|tmdb)\/(\d{1,16})\/coverage$/iu.exec(pathname);
  if (match === null) return undefined;
  const application = match[1];
  const instanceId = match[2];
  const providerId = match[3];
  const value = match[4];
  if ((application === "sonarr" && providerId === "tvdb") || (application === "radarr" && providerId === "tmdb")) {
    return { application, instanceId: instanceId as string, providerId, value: value as string };
  }
  return undefined;
}

function parseProviderSettingsPath(pathname: string): { readonly provider: import("./provider-settings.js").ConfigurableProviderId } | undefined {
  const match = /^\/api\/v1\/settings\/providers\/(subdl|opensubtitles)$/u.exec(pathname);
  return match?.[1] === undefined
    ? undefined
    : { provider: match[1] as import("./provider-settings.js").ConfigurableProviderId };
}

function parseCatalogAddPath(pathname: string): { readonly selection: import("./runtime.js").CatalogAddSelection; readonly action: "options" | "add" } | undefined {
  const match = /^\/api\/v1\/catalog\/(sonarr|radarr)\/([a-z0-9][a-z0-9_-]{0,63})\/(tvdb|tmdb)\/(\d{1,16})\/(add-options|add)$/iu.exec(pathname);
  if (match === null) return undefined;
  const application = match[1];
  const instanceId = match[2];
  const providerId = match[3];
  const value = match[4];
  const action = match[5] === "add-options" ? "options" : "add";
  if ((application === "sonarr" && providerId === "tvdb") || (application === "radarr" && providerId === "tmdb")) {
    return { selection: { application, instanceId: instanceId as string, providerId, value: value as string }, action };
  }
  return undefined;
}

function parseCatalogContinuationPath(pathname: string): {
  readonly continuationId: string;
  readonly action: "scopes" | "analysis";
  readonly scope?: import("./runtime.js").CatalogContinuationScope;
} | undefined {
  const match = /^\/api\/v1\/catalog\/continuations\/([A-Za-z0-9_-]{32})\/(scopes|analysis)(?:\/(season|episode)\/(\d{1,16}))?$/u.exec(pathname);
  if (match === null) return undefined;
  const continuationId = match[1] as string;
  const action = match[2] as "scopes" | "analysis";
  const scopeKind = match[3];
  const scopeValue = match[4];
  if (action === "scopes" && scopeKind === undefined) return { continuationId, action };
  if (action === "analysis" && scopeKind === undefined) return { continuationId, action };
  if (action !== "analysis" || scopeValue === undefined || !Number.isSafeInteger(Number(scopeValue))) return undefined;
  return scopeKind === "season"
    ? { continuationId, action, scope: { kind: "season", seasonNumber: Number(scopeValue) } }
    : { continuationId, action, scope: { kind: "episode", episodeId: Number(scopeValue) } };
}

function parseCatalogContinuationGrabPath(pathname: string): {
  readonly continuationId: string;
  readonly action: "prepare" | "execute";
  readonly scope?: import("./runtime.js").CatalogContinuationScope;
} | undefined {
  const match = /^\/api\/v1\/catalog\/continuations\/([A-Za-z0-9_-]{32})\/analysis(?:\/(season|episode)\/(\d{1,16}))?\/grab\/(prepare|execute)$/u.exec(pathname);
  if (match === null) return undefined;
  const continuationId = match[1] as string;
  const scopeKind = match[2];
  const scopeValue = match[3];
  const action = match[4] as "prepare" | "execute";
  if (scopeKind === undefined) return { continuationId, action };
  if (scopeValue === undefined || !Number.isSafeInteger(Number(scopeValue))) return undefined;
  return scopeKind === "season"
    ? { continuationId, action, scope: { kind: "season", seasonNumber: Number(scopeValue) } }
    : { continuationId, action, scope: { kind: "episode", episodeId: Number(scopeValue) } };
}

class InvalidRequestBodyError extends Error {}

function parseSessionLoginBody(value: unknown): { readonly username: string; readonly password: string } {
  const body = requestRecord(value, ["username", "password"]);
  return {
    username: requestString(body.username, "username", 64),
    password: requestString(body.password, "password", 4_096),
  };
}

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

function parseSubtitleSettingsBody(value: unknown): import("./subtitle-settings.js").SubtitleSettingsInput {
  const body = requestRecord(value, ["languages"]);
  if (!Array.isArray(body.languages)) throw new InvalidRequestBodyError("languages is invalid");
  return { languages: body.languages as import("./domain.js").SubtitleLanguageRequirement[] };
}

function parseProviderSettingsBody(value: unknown): import("./provider-settings.js").ProviderSettingsInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidRequestBodyError();
  const body = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(body);
  if (!keys.includes("languageMappings") || keys.some((key) => key !== "apiKey" && key !== "languageMappings")) {
    throw new InvalidRequestBodyError();
  }
  if (!Array.isArray(body.languageMappings)) throw new InvalidRequestBodyError("languageMappings is invalid");
  return {
    ...(body.apiKey === undefined ? {} : { apiKey: requestString(body.apiKey, "apiKey", 4_096) }),
    languageMappings: body.languageMappings as import("./provider-policy-search.js").ProviderLanguageMapping[],
  };
}

function parseCatalogAddBody(
  application: "sonarr" | "radarr",
  value: unknown,
): import("./runtime.js").CatalogAddInput {
  const expected = application === "sonarr"
    ? ["rootFolderId", "qualityProfileId", "monitored", "monitor"]
    : ["rootFolderId", "qualityProfileId", "monitored", "minimumAvailability"];
  const body = requestRecord(value, expected);
  const rootFolderId = requestPositiveInteger(body.rootFolderId, "rootFolderId");
  const qualityProfileId = requestPositiveInteger(body.qualityProfileId, "qualityProfileId");
  if (typeof body.monitored !== "boolean") throw new InvalidRequestBodyError("monitored is invalid");
  if (application === "sonarr") {
    const monitor = requestString(body.monitor, "monitor", 32);
    if (!["all", "future", "missing", "existing", "firstSeason", "lastSeason", "pilot", "recent", "none"].includes(monitor)) {
      throw new InvalidRequestBodyError("monitor is invalid");
    }
    return { rootFolderId, qualityProfileId, monitored: body.monitored, monitor: monitor as NonNullable<import("./runtime.js").CatalogAddInput["monitor"]> };
  }
  const minimumAvailability = requestString(body.minimumAvailability, "minimumAvailability", 32);
  if (!["announced", "inCinemas", "released"].includes(minimumAvailability)) throw new InvalidRequestBodyError("minimumAvailability is invalid");
  return { rootFolderId, qualityProfileId, monitored: body.monitored, minimumAvailability: minimumAvailability as NonNullable<import("./runtime.js").CatalogAddInput["minimumAvailability"]> };
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

function requestPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new InvalidRequestBodyError(`${field} is invalid`);
  return value;
}

const sessionCookieName = "pegarr_session";
function expiredSessionCookie(secure: boolean): string {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function sessionCookie(token: string, expiresAt: string, secure: boolean): string {
  return `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}; Expires=${new Date(expiresAt).toUTCString()}`;
}

function sessionTokenFromCookie(value: string | undefined): string | undefined {
  if (value === undefined || value.length > 8_192) return undefined;
  const matches = value.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${sessionCookieName}=`));
  if (matches.length !== 1) return undefined;
  const token = matches[0]?.slice(sessionCookieName.length + 1);
  return token !== undefined && token.length >= 32 && token.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(token) ? token : undefined;
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
    const sessionToken = sessionTokenFromCookie(request.headers.cookie);
    const csrfHeader = request.headers["x-pegarr-csrf"];
    const csrfToken = typeof csrfHeader === "string" ? csrfHeader : undefined;
    const sessionAuthenticated = options.sessionStore?.authenticate(sessionToken) === true;
    const sessionMutationAuthorized = options.sessionStore?.authorizeMutation(sessionToken, csrfToken) === true;
    let result: RouteResult;
    try {
      const safeRoute = safeRequestRoute(request.url);
      const requestBody = (request.method === "POST" && (safeRoute.startsWith("grab_") || safeRoute === "catalog_add" || safeRoute === "session_login")) || (request.method === "PUT" && (safeRoute === "subtitle_settings" || safeRoute === "provider_settings"))
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
              ...(options.sessionStore === undefined
                ? {}
                : {
                    sessionStore: options.sessionStore,
                    ...(sessionToken === undefined ? {} : { sessionToken }),
                    sessionAuthenticated,
                    sessionMutationAuthorized,
                    secureSessionCookie: options.secureSessionCookie === true,
                  }),
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
  if (pathname === "/api/v1/version") return "version";
  if (pathname === "/api/v1/session/login") return "session_login";
  if (pathname === "/api/v1/session/logout") return "session_logout";
  if (pathname === "/api/v1/session") return "session_status";
  if (pathname === "/api/v1/feasibility/demo") return "demo_feasibility";
  if (pathname === "/api/v1/integrations/sonarr/status") return "sonarr_status";
  if (pathname === "/api/v1/integrations/radarr/status") return "radarr_status";
  if (/^\/api\/v1\/catalog\/(?:sonarr|radarr)\/[a-z0-9][a-z0-9_-]{0,63}\/(?:tvdb|tmdb)\/\d{1,16}\/add-options$/iu.test(pathname)) return "catalog_add_options";
  if (/^\/api\/v1\/catalog\/(?:sonarr|radarr)\/[a-z0-9][a-z0-9_-]{0,63}\/(?:tvdb|tmdb)\/\d{1,16}\/add$/iu.test(pathname)) return "catalog_add";
  const continuationGrab = parseCatalogContinuationGrabPath(pathname);
  if (continuationGrab?.action === "prepare") return "grab_prepare";
  if (continuationGrab?.action === "execute") return "grab_execute";
  if (parseCatalogContinuationPath(pathname) !== undefined) return "catalog_continuation";
  if (/^\/api\/v1\/settings\/providers\/(?:subdl|opensubtitles)$/u.test(pathname)) return "provider_settings";
  if (pathname === "/api/v1/library/instances") return "arr_instances";
  if (pathname === "/api/v1/onboarding") return "onboarding";
  if (pathname === "/api/v1/catalog/search") return "catalog_search";
  if (parseCatalogCoveragePath(pathname) !== undefined) return "catalog_coverage";
  if (pathname === "/api/v1/settings/subtitles") return "subtitle_settings";
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
