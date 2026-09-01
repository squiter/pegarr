# Radarr v3 system-status contract

Snapshot date: 2026-08-25
Status: fixture-proven, runtime-enabled when explicitly configured, not yet verified against the installed NAS version

## Primary evidence

The implementation is pinned to Radarr commit [`94ef97b`](https://github.com/Radarr/Radarr/blob/94ef97b1f1187aeeca20d658a747620df8980238/src/Radarr.Api.V3/System/SystemController.cs) and its [`SystemResource`](https://github.com/Radarr/Radarr/blob/94ef97b1f1187aeeca20d658a747620df8980238/src/Radarr.Api.V3/System/SystemResource.cs).

The read-only probe is:

```http
GET /api/v3/system/status
X-Api-Key: <server-side secret>
Accept: application/json
```

The response is capped at 256 KiB and uses the shared timeout, host-allowlist, and redirect-free transport contract.

## Fields Pegarr retains

- canonical application name `Radarr`;
- version;
- `isDocker` when Radarr supplies a boolean;
- exact bounded response bytes measured by Pegarr's transport;
- bounded request latency, observation time, and the `https` or `explicit_http` transport-security category.

## Fields Pegarr deliberately discards

Radarr's resource also exposes instance name, startup and application-data paths, OS/runtime details, branch, authentication mode, database versions, URL base, start time, and package metadata. Pegarr does not retain or return those fields because they are unnecessary for capability discovery and can expose private topology or operational details.

## Runtime states

The Pegarr endpoint reports one of `disabled`, `available`, `unauthorized`, `rate_limited`, `unavailable`, `unexpected_status`, or `invalid_response`. These are diagnostic integration states, not subtitle-availability results.

Concurrent status readers share one in-flight request. Completed states are cached for 30 seconds, including failures, to prevent refreshes from hammering an unavailable or rate-limited instance. The one-shot `probe:radarr` command creates a fresh runtime and bypasses that cache.

The probe exits `0` for `available`, `1` for a configured upstream failure, and `2` for disabled or invalid configuration. It emits no exception message, URL, hostname, filesystem path, or secret value.

## Remaining proof

The automated harness injects a sanitized response and executes the packaged command against a synthetic Radarr sibling container on an internal-only Docker network. Installed acceptance later reported Radarr `6.3.0.10514` available through Pegarr's bounded runtime, then completed catalog lookup, an automatic-search-disabled add, and exact analysis with 11 release candidates without recording the API key or private address. The live compatibility boundary is closed; controlled Grab remains separate under `PEG-MANUAL-004`.
