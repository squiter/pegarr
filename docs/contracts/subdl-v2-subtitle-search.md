# SubDL v2 exact subtitle-search contract

Snapshot date: 2026-08-26
Status: official request and failure contract pinned; adapter and packaged probe fixture-proven, awaiting sanitized live verification

## Primary evidence

The adapter is pinned to SubDL's current official [v2 developer documentation](https://subdl.com/developers). That documentation defines:

- base URL `https://api.subdl.com`;
- `GET /api/v2/subtitles/search` for exact subtitle search;
- `Authorization: Bearer` or `X-API-Key` authentication;
- IMDb, TMDB, or SubDL title identifiers;
- required media type when TMDB identifies a title;
- language, season, and episode filters;
- a maximum page size of 30;
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` response headers;
- the shared structured error shape and daily search quotas.

Pegarr uses only the exact read:

```http
GET /api/v2/subtitles/search?<one title ID>&type=<movie|tv>&languages=<provider code>&season=<n>&episode=<n>&subs_per_page=30
Authorization: Bearer <server-side secret>
Accept: application/json
```

Season and episode are present only for episodes. The key is never placed in query parameters, URLs, fixtures, logs, or browser-visible models. Pegarr does not call SubDL's download, upload, batch POST, translation, transcription, AI, or account endpoints.

## One explicit language per window

Bazarr policy codes and SubDL provider codes are separate inputs. For example, a caller must explicitly map a Bazarr dialect to the corresponding supported SubDL code; the adapter never assumes that equal-looking strings have equal provider semantics.

Each stable media-item and language pair is one search window. Concurrent callers share one promise, and the completed outcome is cached for 15 minutes by default. The cache includes quota, timeout, and outage outcomes so UI refreshes cannot multiply provider requests. Candidate comparison against every Sonarr or Radarr release happens locally after that single provider query.

## Evidence Pegarr retains

The provider-independent candidate keeps only:

- an opaque one-way candidate ID;
- Bazarr policy language and original provider language label when returned;
- release name;
- requested IMDb/TMDB identity;
- season and episode for a targeted episode;
- hearing-impaired, forced, and full-season flags when supplied.
- bounded rate-limit limit, remaining count, and reset timestamp headers when supplied.

Multiple release names on one subtitle row become separate local candidates. Subtitle download URLs, raw SubDL IDs, archive or file handles, posters, title-page URLs, uploader names, comments, and arbitrary response properties are discarded.

## Availability and error contract

Pegarr returns provider-search states that keep uncertainty visible:

- successful `200` with an empty subtitle list: `success` with no candidates;
- `429`: `rate_limited`, with a safe numeric retry delay when present;
- transport timeout: `timeout`;
- `5xx` or network failure: `unavailable`;
- `401` or `403`: adapter-level `unauthorized` configuration failure;
- malformed success: adapter-level `invalid_response`;
- other non-success status: adapter-level `unexpected_status`.

Only a successful empty search may later contribute `No match found`. Rate limits, timeouts, outages, and malformed responses cannot.
Likewise, when a candidate exists but SubDL omits metadata required to prove a forced or hearing-impaired policy, the result remains `Unknown` rather than becoming a false negative.

## Packaged probe

`npm run probe:subdl` requires secret-file configuration plus one explicit movie or episode identifier and one Bazarr-policy-to-provider language mapping. It performs exactly one GET for that stable item/language window. Its compact report contains only state, request and subtitle counts, quota evidence, transport-security category, latency, and observation time. It never emits the identifier, language codes, release names, provider response body, URL, hostname, or credential.

`PEG-PROBE-007`, `PEG-PROBE-008`, and `PEG-DOCKER-005` prove this behavior with injected responses and a packaged container on an internal-only network. Those scenarios do not call SubDL or imply live provider compatibility.

## Remaining proof

On 2026-08-26, an exact read without credentials confirmed that the public v2 route is reachable and enforces authentication with a `401`. The 178-byte response completed in approximately 236 ms; no body or credential was retained.

`PEG-MANUAL-005` remains open until a separately authorized authenticated read verifies a sanitized movie and episode response, authenticated response sizes, rate-limit headers, language values, full-season behavior, and the installed Bazarr-to-SubDL language mapping. No subtitle download is part of that proof.
