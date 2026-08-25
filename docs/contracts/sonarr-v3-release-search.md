# Sonarr v3 episode release-search contract

Snapshot date: 2026-08-25
Status: fixture-proven against the verified installed Sonarr `4.0.19.2979`; live release response not yet captured

## Primary evidence

The implementation is based on Sonarr's official source at commit [`a4a2583`](https://github.com/Sonarr/Sonarr/blob/a4a2583dea800f3926f069a66a4b7651ef516796/src/Sonarr.Api.V3/Indexers/ReleaseController.cs) and its [`ReleaseResource`](https://github.com/Sonarr/Sonarr/blob/a4a2583dea800f3926f069a66a4b7651ef516796/src/Sonarr.Api.V3/Indexers/ReleaseResource.cs).

Episode interactive search is:

```http
GET /api/v3/release?episodeId=<positive integer>
X-Api-Key: <server-side secret>
Accept: application/json
```

Sonarr's Grab operation is a separate `POST` on the release controller. Pegarr does not expose or call it in Phase 0.

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

A later controlled-Grab phase will need a server-side, expiring selection cache. That cache must not make raw selection data browser-visible.

## Failure contract

The adapter distinguishes:

- successful empty array: valid search with no release rows;
- malformed `200` response: `invalid_response`;
- `401` or `403`: `unauthorized`;
- `429`: `rate_limited`, preserving a numeric `Retry-After` when supplied;
- `5xx` or transport failure: `unavailable`;
- other non-success status: `unexpected_status`.

Transport exception messages are replaced with stable Pegarr messages so private topology or credentials cannot escape through errors.

## Remaining proof

The installed Sonarr version and authentication requirement are verified separately in the system-status contract. `PEG-MANUAL-001` remains open until a separately authorized, read-only probe verifies this release endpoint's authentication header, response shape, response size, and latency. No live Grab is part of that probe.
