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
}

export interface JsonTransport {
  requestJson(request: ReadonlyJsonRequest): Promise<JsonResponse>;
}
