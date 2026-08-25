import {
  JsonTransportError,
  type JsonResponse,
  type JsonTransport,
  type ReadonlyJsonRequest,
} from "./http.js";

export type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchJsonTransportOptions {
  readonly baseUrl: string;
  readonly allowedHosts: readonly string[];
  readonly allowInsecureHttp?: boolean;
  readonly fetchImplementation?: FetchImplementation;
}

const allowedRequestHeaders = new Set(["accept", "authorization", "user-agent", "x-api-key"]);
const safeResponseHeaders = new Set([
  "content-type",
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
]);
const maximumResponseBytes = 10 * 1024 * 1024;

export class FetchJsonTransport implements JsonTransport {
  readonly #origin: string;
  readonly #basePath: string;
  readonly #hostname: string;
  readonly #fetch: FetchImplementation;

  constructor(options: FetchJsonTransportOptions) {
    const baseUrl = parseBaseUrl(options.baseUrl, options.allowInsecureHttp ?? false);
    const allowedHosts = new Set(options.allowedHosts.map(normalizeAllowedHost));
    if (allowedHosts.size === 0 || !allowedHosts.has(baseUrl.hostname.toLowerCase())) {
      throw new JsonTransportError(
        "invalid_request",
        "Configured service host is absent from the explicit allowlist",
      );
    }

    this.#origin = baseUrl.origin;
    this.#basePath = baseUrl.pathname === "/" ? "" : baseUrl.pathname.replace(/\/+$/u, "");
    this.#hostname = baseUrl.hostname.toLowerCase();
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async requestJson(request: ReadonlyJsonRequest): Promise<JsonResponse> {
    const timeoutMs = boundedInteger(request.timeoutMs, 1, 60_000, "timeoutMs");
    const maxResponseBytes = boundedInteger(
      request.maxResponseBytes,
      1,
      maximumResponseBytes,
      "maxResponseBytes",
    );
    const target = this.#targetUrl(request);
    const headers = requestHeaders(request.headers);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.#fetch(target, {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      const boundedBody = await readBoundedBody(response, maxResponseBytes);
      const body = parseBody(boundedBody.text, response.status);

      return {
        status: response.status,
        headers: responseHeaders(response.headers),
        body,
        responseBytes: boundedBody.bytes,
      };
    } catch (error) {
      if (error instanceof JsonTransportError) {
        throw error;
      }
      if (controller.signal.aborted || isAbortError(error)) {
        throw new JsonTransportError("timeout", "Service request timed out");
      }
      throw new JsonTransportError("network", "Service request failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  #targetUrl(request: ReadonlyJsonRequest): URL {
    const path = safeRequestPath(request.path);
    const target = new URL(this.#origin);
    target.pathname = `${this.#basePath}${path}`;
    for (const [name, value] of Object.entries(request.query)) {
      if (!/^[a-z][a-z0-9_-]*$/iu.test(name) || isSensitiveQueryName(name)) {
        throw new JsonTransportError("invalid_request", "Request contains a forbidden query key");
      }
      target.searchParams.append(name, value);
    }
    if (target.hostname.toLowerCase() !== this.#hostname) {
      throw new JsonTransportError("invalid_request", "Request escaped the configured service host");
    }
    return target;
  }
}

function parseBaseUrl(value: string, allowInsecureHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new JsonTransportError("invalid_request", "Configured service URL is invalid");
  }
  if (url.protocol !== "https:" && !(allowInsecureHttp && url.protocol === "http:")) {
    throw new JsonTransportError("invalid_request", "Configured service URL must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new JsonTransportError(
      "invalid_request",
      "Configured service URL may not contain credentials, query parameters, or fragments",
    );
  }
  return url;
}

function normalizeAllowedHost(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || /[\s/@?#]/u.test(normalized)) {
    throw new JsonTransportError("invalid_request", "Allowed hosts must contain hostnames only");
  }
  return normalized;
}

function safeRequestPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || /[\\?#]/u.test(value)) {
    throw new JsonTransportError("invalid_request", "Request path must be a local absolute path");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new JsonTransportError("invalid_request", "Request path contains invalid encoding");
  }
  if (decoded.split("/").includes("..") || decoded.includes("\\")) {
    throw new JsonTransportError("invalid_request", "Request path may not traverse directories");
  }
  return value;
}

function requestHeaders(values: Readonly<Record<string, string>>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    const normalizedName = name.toLowerCase();
    if (!allowedRequestHeaders.has(normalizedName) || /[\r\n]/u.test(value)) {
      throw new JsonTransportError("invalid_request", "Request contains a forbidden header");
    }
    headers.set(normalizedName, value);
  }
  return headers;
}

function responseHeaders(headers: Headers): Readonly<Record<string, string>> {
  const safe: Record<string, string> = {};
  for (const name of safeResponseHeaders) {
    const value = headers.get(name);
    if (value !== null) {
      safe[name] = value;
    }
  }
  return safe;
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<{ readonly text: string; readonly bytes: number }> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/u.test(declaredLength)) {
    if (Number(declaredLength) > maxResponseBytes) {
      try {
        await response.body?.cancel();
      } catch {
        // Preserve the size-limit classification even if cancellation itself fails.
      }
      throw new JsonTransportError("response_too_large", "Service response exceeded its size limit");
    }
  }
  if (response.body === null) {
    return { text: "", bytes: 0 };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > maxResponseBytes) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the size-limit classification even if cancellation itself fails.
      }
      throw new JsonTransportError("response_too_large", "Service response exceeded its size limit");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(body), bytes: received };
}

function parseBody(value: string, status: number): unknown {
  if (!value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    if (status >= 200 && status < 300) {
      throw new JsonTransportError("invalid_json", "Service returned invalid JSON");
    }
    return null;
  }
}

function isSensitiveQueryName(value: string): boolean {
  return /(?:api.?key|authorization|password|secret|token)/iu.test(value);
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && (value.name === "AbortError" || value.name === "TimeoutError");
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new JsonTransportError(
      "invalid_request",
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}
