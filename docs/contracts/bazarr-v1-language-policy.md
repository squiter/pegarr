# Bazarr v1 language-policy contract

Snapshot date: 2026-08-26
Status: fixture-proven against official Bazarr v1.6.0 source; installed NAS compatibility is unverified

## Primary evidence

The Phase 0 adapter is pinned to the official Bazarr `v1.6.0` implementations for [language profiles](https://github.com/morpheus65535/bazarr/blob/v1.6.0/bazarr/api/system/languages_profiles.py), [series metadata](https://github.com/morpheus65535/bazarr/blob/v1.6.0/bazarr/api/series/series.py), [movie metadata](https://github.com/morpheus65535/bazarr/blob/v1.6.0/bazarr/api/movies/movies.py), and [profile storage](https://github.com/morpheus65535/bazarr/blob/v1.6.0/bazarr/app/database.py). The official frontend [profile types](https://github.com/morpheus65535/bazarr/blob/v1.6.0/frontend/src/types/api.d.ts) and [profile editor](https://github.com/morpheus65535/bazarr/blob/v1.6.0/frontend/src/components/forms/ProfileEditForm.tsx) define the item-level semantics.

Pegarr uses only these reads:

```http
GET /api/system/languages/profiles
GET /api/series?seriesid[]=<positive Sonarr series ID>
GET /api/movies?radarrid[]=<positive Radarr movie ID>
X-API-KEY: <server-side secret>
Accept: application/json
```

Bazarr exposes profile updates and library actions on `POST` and `PATCH` variants of the series and movie routes. Pegarr does not expose or call them in Phase 0.

## Profile evidence Pegarr retains

For each profile, Pegarr retains the original:

- numeric profile ID and display name;
- cutoff item ID, including Bazarr's `65535` “Any” sentinel;
- ordered item IDs and language codes;
- normal, hearing-impaired-required, or forced subtitle semantics;
- whether the item always applies, applies only when audio matches, or applies only when audio does not match;
- must-contain and must-not-contain release-info filters;
- original-format preference and optional tag.

The normalized `SubtitlePolicy` keeps each source item ID, language code, subtitle type, audio applicability, and cutoff marker. No language is hardcoded: whatever Bazarr returns becomes the policy evidence.

## Assignment evidence Pegarr retains

A targeted assignment response becomes only:

- media kind (`series` or `movie`);
- upstream Sonarr series ID or Radarr movie ID;
- assigned profile ID, or an explicit `unassigned` state;
- an explicit `not_found` state when the targeted response is empty.

Library titles, filesystem paths, artwork URLs, overviews, tags, audio-track data, subtitle paths, and other response fields are discarded. A profile ID that is assigned but absent from the profile list remains `profile_missing`; it is never replaced by an implicit default.

## Failure contract

The adapter distinguishes:

- malformed `200` response: `invalid_response`;
- `401` or `403`: `unauthorized`;
- `429`: `rate_limited`, preserving a numeric `Retry-After` when supplied;
- `5xx` or transport failure: `unavailable`;
- other non-success status: `unexpected_status`.

Transport exception details are replaced with stable Pegarr messages. The key is sent only through `X-API-KEY`, never in a query string, URL, fixture, log, or browser-visible model.

## Remaining proof

On 2026-08-26, a read-only check without credentials confirmed that all three HTTPS routes are reachable and enforce authentication with `401` responses. Each response was 236 bytes and completed in approximately 33–38 ms. No body, key, private address, library ID, or library content was retained.

`PEG-MANUAL-002` remains open until a separately authorized, authenticated read-only probe verifies the installed Bazarr version, bounded response sizes and latency, and a sanitized copy of the live profile and assignment shapes. Provider internals and subtitle downloads are outside this adapter.
