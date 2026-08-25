# Sonarr v3 system-status contract

Snapshot date: 2026-08-25
Status: fixture-proven, runtime-enabled when explicitly configured, not yet verified against the installed NAS version

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
- `isDocker` when Sonarr supplies a boolean.

## Fields Pegarr deliberately discards

Sonarr's resource also exposes instance name, startup and application-data paths, OS/runtime details, branch, authentication mode, database versions, URL base, start time, and package metadata. Pegarr does not retain or return those fields because they are unnecessary for capability discovery and can expose private topology or operational details.

## Runtime states

The Pegarr endpoint reports one of `disabled`, `available`, `unauthorized`, `rate_limited`, `unavailable`, `unexpected_status`, or `invalid_response`. These are diagnostic integration states, not subtitle-availability results.

## Remaining proof

The automated harness injects a sanitized response and never performs DNS or network access. `PEG-MANUAL-001` remains open until a separately authorized probe measures the installed version, transport security, response size, and latency without recording the API key or private address.
