# Sonarr v3 system-status contract

Snapshot date: 2026-08-25
Status: installed version verified; API-key transport remains fixture-proven and runtime-enabled when explicitly configured

## Primary evidence

The implementation is pinned to Sonarr commit [`a4a2583`](https://github.com/Sonarr/Sonarr/blob/a4a2583dea800f3926f069a66a4b7651ef516796/src/Sonarr.Api.V3/System/SystemController.cs) and its [`SystemResource`](https://github.com/Sonarr/Sonarr/blob/a4a2583dea800f3926f069a66a4b7651ef516796/src/Sonarr.Api.V3/System/SystemResource.cs).

The read-only probe is:

```http
GET /api/v3/system/status
X-Api-Key: <server-side secret>
Accept: application/json
```

The response is capped at 256 KiB and uses the shared timeout and redirect-free transport contract.

## Fields Pegarr retains

- canonical application name `Sonarr`;
- version;
- `isDocker` when Sonarr supplies a boolean;
- exact bounded response bytes measured by Pegarr's transport;
- bounded request latency, observation time, and the `https` or `explicit_http` transport-security category.

## Fields Pegarr deliberately discards

Sonarr's resource also exposes instance name, startup and application-data paths, OS/runtime details, branch, authentication mode, database versions, URL base, start time, and package metadata. Pegarr does not retain or return those fields because they are unnecessary for capability discovery and can expose private topology or operational details.

## Runtime states

The Pegarr endpoint reports one of `disabled`, `available`, `unauthorized`, `rate_limited`, `unavailable`, `unexpected_status`, or `invalid_response`. These are diagnostic integration states, not subtitle-availability results.

Concurrent status readers share one in-flight request. Completed states are cached for 30 seconds, including failures, to prevent refreshes from hammering an unavailable or rate-limited instance. The one-shot `probe:sonarr` command creates a fresh runtime and bypasses that cache.

The probe exits `0` for `available`, `1` for a configured upstream failure, and `2` for disabled or invalid configuration. It emits no exception message, URL, hostname, or secret value.

## Live NAS evidence

On 2026-08-25, a separately authorized read-only check confirmed:

- Sonarr version `4.0.19.2979` in the authenticated system-status UI;
- Docker runtime enabled;
- no health issue reported by Sonarr;
- both the private HTTPS route and direct HTTP route reached the API and returned `401` without credentials, proving that authentication is enforced;
- the unauthenticated HTTPS response completed in approximately 56 ms and the direct HTTP response in approximately 121 ms.

No API key, private hostname, private address, filesystem path, database detail, or library content is recorded in this evidence.

## Remaining proof

The automated harness injects a sanitized response and also executes the packaged command against a synthetic sibling container on an internal-only Docker network. Installed Sonarr `4.0.19.2979` and Radarr `6.3.0.10514` later passed bounded authenticated status, catalog, add-without-search, and exact-analysis paths. The live compatibility boundary is closed without retaining response bodies, credentials, or private topology.
