# Sonarr v3 episode release-search contract

Snapshot date: 2026-08-28
Status: search fixture-proven and read-only compatible with local Sonarr `4.0.16.2944`; controlled Grab is synthetic-only

## Primary evidence

The implementation is based on Sonarr's official source at commit [`a4a2583`](https://github.com/Sonarr/Sonarr/blob/a4a2583dea800f3926f069a66a4b7651ef516796/src/Sonarr.Api.V3/Indexers/ReleaseController.cs) and its [`ReleaseResource`](https://github.com/Sonarr/Sonarr/blob/a4a2583dea800f3926f069a66a4b7651ef516796/src/Sonarr.Api.V3/Indexers/ReleaseResource.cs).

Episode interactive search is:

```http
GET /api/v3/release?episodeId=<positive integer>
X-Api-Key: <server-side secret>
Accept: application/json
```

Sonarr's official controller and OpenAPI expose Grab as a separate `POST /api/v3/release` whose request schema is `ReleaseResource`. The controller resolves the cached release from its GUID and indexer ID. Phase 2 therefore performs a fresh GET search, keeps the matching handle server-side, and sends only:

```http
POST /api/v3/release
X-Api-Key: <server-side secret>
Content-Type: application/json

{"guid":"<revalidated server-side handle>","indexerId":<positive integer>}
```

Pegarr never accepts either handle field from the browser. It revalidates once during confirmation preparation and again immediately before POST.

## Fields Pegarr retains

Pegarr maps these fields into provider-independent, browser-safe evidence:

- title;
- download-allowed decision and rejection reasons;
- custom-format score and format names;
- indexer label and protocol;
- quality name, source, resolution, and release group;
- size, age, seeders, and leechers when present;
- language names returned by Sonarr.

The opaque Pegarr release ID is a one-way digest of the instance label, indexer ID, and Sonarr GUID. It supports stable row identity without exposing the upstream selection handle.

## Fields Pegarr deliberately discards

The read-only report must not contain:

- Sonarr API keys or private service addresses;
- raw GUIDs or indexer selection handles;
- download, comment, or info URLs;
- magnet URLs or info hashes;
- arbitrary unvalidated response properties.

The raw selection handle lives only in the short revalidation call stack. The expiring browser challenge contains the opaque Pegarr release ID and display evidence, never the raw handle.

## Failure contract

The adapter distinguishes:

- successful empty array: valid search with no release rows;
- malformed `200` response: `invalid_response`;
- `401` or `403`: `unauthorized`;
- `429`: `rate_limited`, preserving a numeric `Retry-After` when supplied;
- `5xx` or transport failure: `unavailable`;
- other non-success status: `unexpected_status`.

Transport exception messages are replaced with stable Pegarr messages so private topology or credentials cannot escape through errors.

For Grab, `200` is accepted. Authentication, unavailable-release, quota, and other upstream failures remain distinct. A transport timeout becomes `timeout_unknown`; Pegarr audits it as requiring reconciliation and blocks an immediate duplicate instead of claiming failure.

## Remaining proof

The installed Sonarr version and authentication requirement are verified separately in the system-status contract. `PEG-MANUAL-004` remains open until an operator explicitly authorizes a harmless live Grab and reconciles the observed Arr activity. Automated tests use only injected transports and disposable fixture containers.
