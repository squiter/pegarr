# Radarr v3 movie release-search contract

Snapshot date: 2026-08-28
Status: search and controlled Grab fixture-proven, not yet verified against a live installed Radarr

## Primary evidence

The implementation is pinned to Radarr commit [`94ef97b`](https://github.com/Radarr/Radarr/blob/94ef97b1f1187aeeca20d658a747620df8980238/src/Radarr.Api.V3/Indexers/ReleaseController.cs) and its [`ReleaseResource`](https://github.com/Radarr/Radarr/blob/94ef97b1f1187aeeca20d658a747620df8980238/src/Radarr.Api.V3/Indexers/ReleaseResource.cs).

Movie interactive search is:

```http
GET /api/v3/release?movieId=<positive integer>
X-Api-Key: <server-side secret>
Accept: application/json
```

Radarr's official OpenAPI exposes Grab as a separate `POST /api/v3/release` using `ReleaseResource`. Phase 2 performs a fresh movie release search, retains the matched handle only on the server, and sends only:

```http
POST /api/v3/release
X-Api-Key: <server-side secret>
Content-Type: application/json

{"guid":"<revalidated server-side handle>","indexerId":<positive integer>}
```

Pegarr revalidates during preparation and again immediately before POST. The browser never receives or supplies either handle field.

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

The expiring confirmation challenge contains only the opaque Pegarr release ID and display evidence. Raw selection data exists only inside the revalidation and mutation call stack.

## Failure contract

The adapter distinguishes:

- successful empty array: valid search with no release rows;
- malformed `200` response: `invalid_response`;
- `401` or `403`: `unauthorized`;
- `429`: `rate_limited`, preserving a numeric `Retry-After` when supplied;
- `5xx` or transport failure: `unavailable`;
- other non-success status: `unexpected_status`.

Transport exception messages are replaced with stable Pegarr messages so private topology or credentials cannot escape through errors.

For Grab, `200` is accepted. Authentication, unavailable-release, quota, and other upstream failures remain distinct. A timeout is `timeout_unknown`, is audited for reconciliation, and blocks an immediate duplicate.

## Remaining proof

`PEG-MANUAL-001` remains open for live read compatibility, while `PEG-MANUAL-004` covers a separately authorized harmless Grab and reconciliation drill. Automated tests never call a live Radarr.
