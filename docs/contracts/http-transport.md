# Bounded HTTP transport contract

Status: hermetically tested for read requests and one narrow JSON POST used only by controlled Arr Grab

Pegarr adapters use one transport boundary so network, URL, timeout, size, and redaction behavior is not reimplemented for each service.

## URL and request policy

- HTTPS is required by default. HTTP requires an explicit `allowInsecureHttp` configuration for private-network installations.
- The configured hostname must appear in an explicit allowlist.
- Base URLs cannot contain credentials, query parameters, or fragments.
- Adapter paths must be local absolute paths and cannot contain traversal, schemes, query strings, fragments, or backslashes.
- Query keys use simple names or a single terminal `[]` suffix for Bazarr's array filters. Indexed, nested, and credential-like keys are rejected.
- `GET` is the default adapter operation. `POST` requires a bounded JSON object and is used only by the Sonarr/Radarr controlled Grab methods; no PUT, PATCH, or DELETE exists in the transport contract.
- Request bodies are capped at 64 KiB and serialized once by the transport.
- Request headers are restricted to `Accept`, `Authorization`, `Content-Type`, `User-Agent`, and `X-Api-Key`.
- Redirects are rejected, cookies are omitted, caching is disabled, and the referrer policy is `no-referrer`.

These checks prevent an adapter from turning a configured service into an arbitrary URL fetcher. DNS resolution and rebinding behavior still require a live deployment review and remain part of `PEG-MANUAL-001`.

## Response policy

- The caller supplies a timeout between 1 ms and 60 seconds.
- The caller supplies a response limit capped at 10 MiB.
- Declared `Content-Length` and streamed bytes are both enforced.
- The exact accepted body-byte count is returned as safe transport evidence.
- Invalid JSON on a successful response is an explicit `invalid_json` failure.
- Invalid or empty non-success bodies are discarded; adapters classify the HTTP status.
- Only content type, retry metadata, and standard rate-limit headers are returned to adapters.
- Cookies, server banners, arbitrary headers, response bodies, URLs, and transport exception details never enter error messages.

There are no automatic retries. Controlled Grab applies its idempotency and unknown-timeout policy above the transport so a connection outcome can never trigger an automatic second mutation.

## Harness boundary

`PEG-HTTP-001` through `PEG-HTTP-006` inject an in-memory fetch implementation. They prove URL construction, the Sonarr- and Bazarr-to-transport flows, bounded POST serialization, timeouts, redaction, response limits, JSON behavior, and safe headers without DNS or network access.

The first live probe must be separately authorized, read-only, and record the installed service version, TLS mode, response size, latency, and any DNS assumptions without recording the API key or private address.
