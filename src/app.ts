import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface RouteResult {
  readonly statusCode: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, string>>;
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
): Promise<RouteResult> {
  const pathname = new URL(requestUrl ?? "/", "http://pegarr.invalid").pathname;

  if ((pathname === "/health" || pathname === "/health/ready") && method !== "GET") {
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

  return {
    statusCode: 404,
    body: { service: "pegarr", status: "not_found" },
  };
}

export function createRequestHandler(dataDirectory: string) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const result = await resolveRoute(request.method, request.url, dataDirectory);
    response.writeHead(result.statusCode, { ...jsonHeaders, ...result.headers });
    response.end(`${JSON.stringify(result.body)}\n`);
  };
}
