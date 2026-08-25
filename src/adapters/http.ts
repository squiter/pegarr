export interface ReadonlyJsonRequest {
  readonly method: "GET";
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export interface JsonResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly responseBytes?: number;
}

export interface JsonTransport {
  requestJson(request: ReadonlyJsonRequest): Promise<JsonResponse>;
}

export type JsonTransportErrorCode =
  | "invalid_request"
  | "timeout"
  | "network"
  | "response_too_large"
  | "invalid_json";

export class JsonTransportError extends Error {
  readonly code: JsonTransportErrorCode;

  constructor(code: JsonTransportErrorCode, message: string) {
    super(message);
    this.name = "JsonTransportError";
    this.code = code;
  }
}
