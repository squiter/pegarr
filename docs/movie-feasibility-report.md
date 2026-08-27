# Radarr movie feasibility report

Status: packaged, read-only, and fixture-proven; live Radarr and SubDL verification remain manual

`npm run report:radarr-movie` is the Phase 0 end-to-end movie path. It performs one Radarr movie release search, reads the Bazarr movie assignment and language profiles, searches SubDL sequentially at most once per unique policy language, and evaluates every returned release with the deterministic matcher.

It does not expose a browser route and cannot Grab, download, update, or delete anything.

When the [provider search cache](provider-search-cache.md) is enabled, successful item/language windows are reused across command invocations. Cache hits are visible in `report.providerStatus` and count as zero provider requests. Failures and quota responses are never stored in the durable cache.

## Current provider boundary

Bazarr defines which subtitle languages and variants Pegarr should seek. Pegarr does not reuse Bazarr's configured subtitle-provider credentials or call Bazarr's provider internals. In this phase, Pegarr supports only a separately configured direct SubDL connection.

That means a user who also enables SubDL in Bazarr currently configures it in both applications. This duplication is a known Phase 0 limitation, not the intended final setup experience. Keeping the direct search boundary explicit lets Pegarr measure release-specific availability without making Bazarr internals a required runtime dependency. Future provider and setup work should reduce this friction while preserving that independence.

## Request file

The command reads `PEGARR_MOVIE_REPORT_REQUEST_FILE`, which must be an absolute in-container path to a JSON file no larger than 64 KiB:

```json
{
  "movieId": 84,
  "item": {
    "kind": "movie",
    "title": "Example Movie",
    "year": 2024,
    "ids": {
      "imdb": "tt1234567",
      "tmdb": "12345"
    }
  },
  "subdlLanguages": [
    { "policyCode": "en", "providerCode": "EN" },
    { "policyCode": "pt-BR", "providerCode": "PT-BR" }
  ]
}
```

The Radarr movie ID selects the upstream release search and Bazarr assignment. The media identity is the provider matching identity. Language mappings are explicit because Bazarr policy codes and SubDL provider codes are separate contracts. A missing mapping remains `Unknown` for only that language and does not trigger a provider request. The installed Bazarr code `pb` is canonically equivalent to `pt-BR`, so users do not need duplicate `pb` and `pt-BR` rows.

Keep this file outside the repository with mode `0600`. It contains private library metadata even though it is not an API credential.

## Packaged execution

Configure the Radarr, Bazarr, and SubDL secret-file overlays described in [runtime configuration](configuration.md). Mount the request file into the one-shot container and pass only its in-container path:

```console
docker compose \
  -f deploy/compose.nas.yaml \
  -f deploy/compose.radarr.yaml \
  -f deploy/compose.bazarr.yaml \
  -f deploy/compose.subdl.yaml \
  run --rm \
  --mount type=bind,source=/absolute/private/path/movie-report.json,target=/run/pegarr/movie-report.json,readonly \
  -e PEGARR_MOVIE_REPORT_REQUEST_FILE=/run/pegarr/movie-report.json \
  pegarr npm run --silent report:radarr-movie
```

Exit code `0` means a report was built. Exit code `1` means policy resolution or an upstream integration failed. Exit code `2` means integrations were disabled or configuration was invalid.

## Request and failure bounds

- Radarr: exactly one interactive release-search request.
- Bazarr: exactly two GETs, run alongside the Radarr request.
- SubDL: sequential, at most one request per unique Bazarr policy language with an explicit mapping.
- A provider rate limit, timeout, outage, or adapter failure stops further SubDL requests and makes affected evidence `Unknown`.
- An unassigned, missing, or stale Bazarr profile stops provider work rather than assuming a language.
- Radarr/Bazarr failures are classified without exposing URLs, hostnames, paths, keys, or transport exception details.

The successful report intentionally contains the item title, media identifiers, release titles, policy details, and match evidence. Treat it as private library output; inspect and sanitize it before attaching it to a public issue.

`PEG-MOVIEFLOW-001` through `PEG-MOVIEFLOW-003`, `PEG-MOVIEREPORT-001`, `PEG-MOVIEREPORT-002`, `PEG-CACHE-001` through `PEG-CACHE-008`, `PEG-DOCKER-007`, and `PEG-DOCKER-010` are the deterministic completion evidence for this path. They use only sanitized fixtures and internal-only Docker networks.
