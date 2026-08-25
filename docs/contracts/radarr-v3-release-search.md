# Radarr v3 movie release-search contract

Snapshot date: 2026-08-25
Status: fixture-proven, not yet verified against the installed NAS version

## Primary evidence

The implementation is pinned to Radarr commit [`94ef97b`](https://github.com/Radarr/Radarr/blob/94ef97b1f1187aeeca20d658a747620df8980238/src/Radarr.Api.V3/Indexers/ReleaseController.cs) and its [`ReleaseResource`](https://github.com/Radarr/Radarr/blob/94ef97b1f1187aeeca20d658a747620df8980238/src/Radarr.Api.V3/Indexers/ReleaseResource.cs).

Movie interactive search is:

```http
GET /api/v3/release?movieId=<positive integer>
X-Api-Key: <server-side secret>
Accept: application/json
```

Radarr's Grab operation is a separate `POST` on the same controller. Pegarr does not expose or call it in Phase 0.

## Fields Pegarr retains

Pegarr maps these fields into provider-independent, browser-safe evidence:

- title;
- download-allowed decision and rejection reasons;
- custom-format score and format names;
- indexer label and protocol;
- quality name, source, resolution, release group, and movie edition;
- size, age, seeders, and leechers when present;
- language names returned by Radarr.

The opaque Pegarr release ID is a one-way digest of the instance label, indexer ID, and Radarr GUID. It supports stable row identity without exposing the upstream selection handle.

## Fields Pegarr deliberately discards

The read-only report must not contain:

- Radarr API keys or private service addresses;
- raw GUIDs, indexer selection handles, or release hashes;
- download, comment, info, or magnet URLs;
- info hashes, TMDb/IMDb selection metadata, download-client fields, or override flags;
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

`PEG-MANUAL-001` remains open until a separately authorized, read-only probe verifies the installed Radarr version, authentication header, response shape, response size, and latency. No live Grab is part of that probe.
