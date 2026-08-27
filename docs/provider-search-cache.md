# Provider search cache

Pegarr stores successful subtitle-provider search results in a local SQLite file so the same stable media item and language window does not repeatedly consume provider quota. The packaged NAS Compose configuration enables it at `/data/provider-search-cache.sqlite`, inside Pegarr's persistent private data volume.

The cache is used by the packaged Sonarr episode, Sonarr season, and Radarr movie reports. A cache miss performs the normal provider request and reports `cache.status: "miss"`. A hit performs no provider request, reports `cache.status: "hit"`, and contributes zero to `metrics.providerRequests`.

## Honest result semantics

Only `success` responses are stored, including a successful empty result. Authentication failures, timeouts, outages, malformed responses, and quota or rate-limit responses are never cached. They therefore continue to produce `Unknown` rather than becoming stale proof that no subtitle exists.

Entries expire after 900 seconds by default. Expired or corrupt entries are discarded and fetched again. Concurrent requests for the same item/language window share one in-flight provider request. The cache also prunes the oldest entries after its configured limit, which defaults to 5,000.

## Privacy boundary

Cache keys are SHA-256 digests of normalized media identifiers, media scope, and language mapping; titles and raw identifiers are not stored in the key. The cached payload contains the normalized provider evidence needed for local matching, including media identifiers and release names. Treat the database as private application data and do not publish or attach it to issues.

API keys, authorization headers, provider download handles, and upstream URLs are not part of the cached result. The file must be an absolute direct child path inside the absolute `DATA_DIR`; packaged commands reject nested or outside paths before making a network request.

## Settings

| Variable | Default | Boundary |
| --- | --- | --- |
| `PEGARR_PROVIDER_CACHE_FILE` | Disabled unless set; NAS Compose sets `/data/provider-search-cache.sqlite` | Absolute direct child file path inside `DATA_DIR` |
| `PEGARR_PROVIDER_CACHE_TTL_SECONDS` | `900` | Integer from 1 through 86,400 |
| `PEGARR_PROVIDER_CACHE_MAX_ENTRIES` | `5000` | Integer from 1 through 100,000 |

Deleting the database only discards reusable evidence; Pegarr recreates it on the next report. Stop Pegarr before manually deleting it so no report is using the file.

`PEG-CACHE-001` through `PEG-CACHE-008` and `PEG-DOCKER-010` are the deterministic evidence for this behavior. They use disposable local databases, synthetic services, and synthetic secrets only.
