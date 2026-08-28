import assert from "node:assert/strict";
import test from "node:test";

import { syntheticBazarrSeriesAssignmentResponse } from "../fixtures/bazarr-language-policy.js";
import { syntheticSonarrEpisodeReleaseResponse } from "../fixtures/sonarr-release-search.js";
import { BazarrClient } from "./bazarr.js";
import {
  FetchJsonTransport,
  type FetchImplementation,
} from "./fetch-json-transport.js";
import { JsonTransportError, type MutatingJsonRequest, type ReadonlyJsonRequest } from "./http.js";
import { SonarrClient } from "./sonarr.js";

const directRequest: ReadonlyJsonRequest = {
  method: "GET",
  path: "/api/v3/system/status",
  query: {},
  headers: { accept: "application/json" },
  timeoutMs: 100,
  maxResponseBytes: 1_024,
};

test("PEG-HTTP-001 requests stay on an explicit allowlisted base URL", async () => {
  let capturedUrl: URL | undefined;
  let capturedInit: RequestInit | undefined;
  const fakeFetch: FetchImplementation = async (input, init) => {
    capturedUrl = new URL(input);
    capturedInit = init;
    return new Response(JSON.stringify(syntheticSonarrEpisodeReleaseResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const transport = new FetchJsonTransport({
    baseUrl: "https://sonarr.example.invalid/root/",
    allowedHosts: ["sonarr.example.invalid"],
    fetchImplementation: fakeFetch,
  });
  const releases = await new SonarrClient(
    { instanceId: "synthetic-sonarr", apiKey: "synthetic-api-key" },
    transport,
  ).searchEpisodeReleases(305);

  assert.equal(releases.length, 4);
  assert.equal(capturedUrl?.origin, "https://sonarr.example.invalid");
  assert.equal(capturedUrl?.pathname, "/root/api/v3/release");
  assert.equal(capturedUrl?.search, "?episodeId=305");
  assert.doesNotMatch(capturedUrl?.href ?? "", /api.?key|synthetic-api-key/iu);
  assert.equal(capturedInit?.method, "GET");
  assert.equal(capturedInit?.redirect, "error");
  assert.equal(capturedInit?.credentials, "omit");
  assert.equal(new Headers(capturedInit?.headers).get("x-api-key"), "synthetic-api-key");

  assert.throws(
    () =>
      new FetchJsonTransport({
        baseUrl: "http://sonarr.example.invalid",
        allowedHosts: ["sonarr.example.invalid"],
      }),
    /HTTPS/u,
  );
  assert.throws(
    () =>
      new FetchJsonTransport({
        baseUrl: "https://sonarr.example.invalid",
        allowedHosts: ["different.example.invalid"],
      }),
    /allowlist/u,
  );
  assert.throws(
    () =>
      new FetchJsonTransport({
        baseUrl: "https://synthetic:credential@sonarr.example.invalid",
        allowedHosts: ["sonarr.example.invalid"],
      }),
    /credentials/iu,
  );
  assert.doesNotThrow(
    () =>
      new FetchJsonTransport({
        baseUrl: "http://sonarr.example.invalid",
        allowedHosts: ["sonarr.example.invalid"],
        allowInsecureHttp: true,
      }),
  );
  await assert.rejects(
    transport.requestJson({ ...directRequest, path: "/api/v3/../admin" }),
    (error: unknown) => error instanceof JsonTransportError && error.code === "invalid_request",
  );
  await assert.rejects(
    transport.requestJson({ ...directRequest, query: { apiKey: "synthetic-secret" } }),
    (error: unknown) => error instanceof JsonTransportError && error.code === "invalid_request",
  );
  await assert.rejects(
    transport.requestJson({ ...directRequest, headers: { cookie: "synthetic=value" } }),
    (error: unknown) => error instanceof JsonTransportError && error.code === "invalid_request",
  );
});

test("PEG-HTTP-002 timeouts and network failures return stable redacted errors", async () => {
  const timeoutFetch: FetchImplementation = async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("private timeout detail", "AbortError"));
      });
    });
  const timeoutTransport = new FetchJsonTransport({
    baseUrl: "https://sonarr.example.invalid",
    allowedHosts: ["sonarr.example.invalid"],
    fetchImplementation: timeoutFetch,
  });
  await assert.rejects(
    timeoutTransport.requestJson({ ...directRequest, timeoutMs: 5 }),
    (error: unknown) => {
      assert.ok(error instanceof JsonTransportError);
      assert.equal(error.code, "timeout");
      assert.doesNotMatch(error.message, /private|sonarr\.example/iu);
      return true;
    },
  );

  const networkTransport = new FetchJsonTransport({
    baseUrl: "https://sonarr.example.invalid",
    allowedHosts: ["sonarr.example.invalid"],
    fetchImplementation: async () => {
      throw new Error("private topology and synthetic-api-key");
    },
  });
  await assert.rejects(networkTransport.requestJson(directRequest), (error: unknown) => {
    assert.ok(error instanceof JsonTransportError);
    assert.equal(error.code, "network");
    assert.doesNotMatch(error.message, /private|synthetic-api-key|sonarr\.example/iu);
    return true;
  });
});

test("PEG-HTTP-003 declared and streamed oversized bodies are blocked", async () => {
  const declaredTransport = new FetchJsonTransport({
    baseUrl: "https://sonarr.example.invalid",
    allowedHosts: ["sonarr.example.invalid"],
    fetchImplementation: async () =>
      new Response("[]", { status: 200, headers: { "content-length": "2048" } }),
  });
  await assert.rejects(declaredTransport.requestJson(directRequest), (error: unknown) => {
    return error instanceof JsonTransportError && error.code === "response_too_large";
  });

  const streamedTransport = new FetchJsonTransport({
    baseUrl: "https://sonarr.example.invalid",
    allowedHosts: ["sonarr.example.invalid"],
    fetchImplementation: async () => new Response("0123456789", { status: 200 }),
  });
  await assert.rejects(
    streamedTransport.requestJson({ ...directRequest, maxResponseBytes: 5 }),
    (error: unknown) => error instanceof JsonTransportError && error.code === "response_too_large",
  );
});

test("PEG-HTTP-004 invalid success JSON stays distinct from safe error metadata", async () => {
  const invalidSuccess = new FetchJsonTransport({
    baseUrl: "https://sonarr.example.invalid",
    allowedHosts: ["sonarr.example.invalid"],
    fetchImplementation: async () => new Response("not-json", { status: 200 }),
  });
  await assert.rejects(invalidSuccess.requestJson(directRequest), (error: unknown) => {
    return error instanceof JsonTransportError && error.code === "invalid_json";
  });

  const failedResponse = new FetchJsonTransport({
    baseUrl: "https://sonarr.example.invalid",
    allowedHosts: ["sonarr.example.invalid"],
    fetchImplementation: async () =>
      new Response("private non-json body", {
        status: 503,
        headers: { "retry-after": "30", "set-cookie": "private=value" },
      }),
  });
  assert.deepEqual(await failedResponse.requestJson(directRequest), {
    status: 503,
    headers: { "content-type": "text/plain;charset=UTF-8", "retry-after": "30" },
    body: null,
    responseBytes: new TextEncoder().encode("private non-json body").byteLength,
  });
});

test("PEG-HTTP-005 Bazarr array query keys are encoded without widening the URL boundary", async () => {
  let capturedUrl: URL | undefined;
  const transport = new FetchJsonTransport({
    baseUrl: "https://bazarr.example.invalid",
    allowedHosts: ["bazarr.example.invalid"],
    fetchImplementation: async (input) => {
      capturedUrl = new URL(input);
      return new Response(JSON.stringify(syntheticBazarrSeriesAssignmentResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const assignment = await new BazarrClient(
    { instanceId: "synthetic-bazarr", apiKey: "synthetic-api-key" },
    transport,
  ).readSeriesAssignment(42);

  assert.deepEqual(assignment, {
    status: "assigned",
    mediaKind: "series",
    mediaId: 42,
    profileId: 7,
  });
  assert.equal(capturedUrl?.origin, "https://bazarr.example.invalid");
  assert.equal(capturedUrl?.pathname, "/api/series");
  assert.equal(capturedUrl?.search, "?seriesid%5B%5D=42");
  assert.doesNotMatch(capturedUrl?.href ?? "", /api.?key|synthetic-api-key/iu);

  for (const forbiddenQuery of [
    { "seriesid[0]": "42" },
    { "seriesid[][]": "42" },
    { "token[]": "synthetic-secret" },
  ]) {
    await assert.rejects(
      transport.requestJson({ ...directRequest, query: forbiddenQuery }),
      (error: unknown) => error instanceof JsonTransportError && error.code === "invalid_request",
    );
  }
});

test("PEG-HTTP-006 POST sends one bounded JSON object without widening transport policy", async () => {
  let capturedInit: RequestInit | undefined;
  const transport = new FetchJsonTransport({
    baseUrl: "https://sonarr.example.invalid",
    allowedHosts: ["sonarr.example.invalid"],
    fetchImplementation: async (_input, init) => {
      capturedInit = init;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const request: MutatingJsonRequest = {
    method: "POST",
    path: "/api/v3/release",
    query: {},
    headers: { accept: "application/json" },
    body: { guid: "synthetic-guid", indexerId: 11 },
    timeoutMs: 100,
    maxResponseBytes: 1_024,
  };

  await transport.requestJson(request);
  assert.equal(capturedInit?.method, "POST");
  assert.equal(new Headers(capturedInit?.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), request.body);
  assert.equal(capturedInit?.redirect, "error");
  assert.equal(capturedInit?.credentials, "omit");
  await assert.rejects(
    transport.requestJson({ ...request, body: { value: "x".repeat(65 * 1_024) } }),
    (error: unknown) => error instanceof JsonTransportError && error.code === "invalid_request",
  );
});
