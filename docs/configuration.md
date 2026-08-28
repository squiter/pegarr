# Runtime configuration

Pegarr starts with every external integration disabled. Sonarr, Radarr, Bazarr, and SubDL become available independently only when all required settings for that integration are present and valid. Partial configuration stops startup with a redacted error instead of silently running with an unexpected boundary.

## Sonarr settings

| Variable | Required when enabled | Meaning |
| --- | --- | --- |
| `PEGARR_SONARR_URL` | Yes | Sonarr base URL, including an existing URL base when used |
| `PEGARR_SONARR_ALLOWED_HOSTS` | Yes | Comma-separated hostnames Pegarr may contact, without schemes, paths, credentials, or ports |
| `PEGARR_SONARR_API_KEY_FILE` | Yes | Absolute in-container path to a file containing only the Sonarr API key |
| `PEGARR_SONARR_INSTANCE_ID` | No | Safe non-secret label; defaults to `sonarr` |
| `PEGARR_SONARR_ALLOW_INSECURE_HTTP` | No | Must be explicitly `true` to permit HTTP; defaults to `false` |

## Radarr settings

| Variable | Required when enabled | Meaning |
| --- | --- | --- |
| `PEGARR_RADARR_URL` | Yes | Radarr base URL, including an existing URL base when used |
| `PEGARR_RADARR_ALLOWED_HOSTS` | Yes | Comma-separated hostnames Pegarr may contact, without schemes, paths, credentials, or ports |
| `PEGARR_RADARR_API_KEY_FILE` | Yes | Absolute in-container path to a file containing only the Radarr API key |
| `PEGARR_RADARR_INSTANCE_ID` | No | Safe non-secret label; defaults to `radarr` |
| `PEGARR_RADARR_ALLOW_INSECURE_HTTP` | No | Must be explicitly `true` to permit HTTP; defaults to `false` |

## Bazarr settings

| Variable | Required when enabled | Meaning |
| --- | --- | --- |
| `PEGARR_BAZARR_URL` | Yes | Bazarr base URL, including an existing URL base when used |
| `PEGARR_BAZARR_ALLOWED_HOSTS` | Yes | Comma-separated hostnames Pegarr may contact, without schemes, paths, credentials, or ports |
| `PEGARR_BAZARR_API_KEY_FILE` | Yes | Absolute in-container path to a file containing only the Bazarr API key |
| `PEGARR_BAZARR_INSTANCE_ID` | No | Safe non-secret label; defaults to `bazarr` |
| `PEGARR_BAZARR_ALLOW_INSECURE_HTTP` | No | Must be explicitly `true` to permit HTTP; defaults to `false` |

## SubDL settings

| Variable | Required when enabled | Meaning |
| --- | --- | --- |
| `PEGARR_SUBDL_URL` | Yes | SubDL API base URL; normally `https://api.subdl.com` |
| `PEGARR_SUBDL_ALLOWED_HOSTS` | Yes | Comma-separated hostnames Pegarr may contact; normally `api.subdl.com` |
| `PEGARR_SUBDL_API_KEY_FILE` | Yes | Absolute in-container path to a file containing only the SubDL API key |
| `PEGARR_SUBDL_INSTANCE_ID` | No | Safe non-secret label; defaults to `subdl` |
| `PEGARR_SUBDL_ALLOW_INSECURE_HTTP` | No | Test fixtures only; production SubDL access should remain HTTPS |
| `PEGARR_SUBDL_LANGUAGE_MAPPINGS` | For release evidence | Comma-separated Bazarr-policy-to-SubDL pairs such as `en:EN,pt-BR:PT-BR`; no language is assumed |

The one-shot SubDL probe also requires a deliberate, representative search window. Set `PEGARR_SUBDL_PROBE_KIND` to `movie` or `episode`, provide at least one of `PEGARR_SUBDL_PROBE_IMDB_ID` or `PEGARR_SUBDL_PROBE_TMDB_ID`, and map `PEGARR_SUBDL_PROBE_POLICY_LANGUAGE` to `PEGARR_SUBDL_PROBE_PROVIDER_LANGUAGE`. Episode probes additionally require `PEGARR_SUBDL_PROBE_SEASON` and `PEGARR_SUBDL_PROBE_EPISODE`. These values are never printed by the probe.

The dashboard item route uses `PEGARR_SUBDL_LANGUAGE_MAPPINGS`. Each mapping is explicit because Bazarr policy codes and SubDL provider codes are separate contracts. Unmapped policy languages remain `Unknown` and cause no provider request; Pegarr never supplies a PT-BR or other language default.

Pegarr deliberately does not accept direct `PEGARR_SONARR_API_KEY`, `PEGARR_RADARR_API_KEY`, `PEGARR_BAZARR_API_KEY`, or `PEGARR_SUBDL_API_KEY` values. Environment variables can be exposed by process inspection, container metadata, support bundles, or accidental diagnostics. Each API key file is capped at 4096 bytes, parsed as one value, kept server-side, and serialized as `[redacted]` if the configuration object is accidentally encoded as JSON.

The base URL may use a Sonarr URL base, such as `https://media.example.invalid/sonarr`. The allowlist entry for that URL is only `media.example.invalid`.

## Provider cache settings

The packaged feasibility reports can reuse successful SubDL results from a private local SQLite file. NAS Compose enables this inside the persistent `/data` volume. Provider failures, timeouts, malformed responses, authentication failures, and quota responses are never cached.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PEGARR_PROVIDER_CACHE_FILE` | Disabled unless set | Absolute SQLite direct child file path inside the absolute `DATA_DIR` |
| `PEGARR_PROVIDER_CACHE_TTL_SECONDS` | `900` | Successful-result lifetime from 1 through 86,400 seconds |
| `PEGARR_PROVIDER_CACHE_MAX_ENTRIES` | `5000` | Oldest-entry pruning limit from 1 through 100,000 |

The database contains private normalized matching evidence such as media identifiers and release names, but never API keys, authorization headers, provider download handles, or upstream URLs. Keep the data volume private. See the [provider search cache guide](provider-search-cache.md) for result and deletion semantics.

## Operational logs

The server writes one JSON record for startup, shutdown, and each completed HTTP request. Request records contain only `event`, `service`, a bounded method, a safe route category, status code, and bounded duration. They never contain the raw URL, query string, item ID, title, authorization header, API key, access token, configured hostname, or upstream error detail. Logging failures cannot change the HTTP response.

Safe route categories include health, readiness, dashboard, dashboard asset, integration status, missing inventory, item feasibility, synthetic demo, and not found. This keeps container logs useful for operations without turning them into library history.

## Read-only API access

| Variable | Required when enabled | Meaning |
| --- | --- | --- |
| `PEGARR_ACCESS_TOKEN_FILE` | Yes | Absolute in-container path to one random bearer token of 32 through 4096 characters |
| `PEGARR_MISSING_PAGE_SIZE` | No | Missing items requested from each Arr instance; defaults to 50, maximum 100 |

The live library route is absent unless the access token is configured. Pegarr rejects a direct `PEGARR_ACCESS_TOKEN` value. Use [the access-control overlay and guide](access-control.md) to mount the token without placing it in `.env`, browser storage, URLs, or logs.

## Controlled Grab

Controlled Grab is disabled by default. Enabling it requires the normal read-only access token plus a separate administrator secret and durable audit path.

| Variable | Required when enabled | Meaning |
| --- | --- | --- |
| `PEGARR_GRAB_ENABLED` | Yes | Must be exactly `true`; absent or `false` keeps every mutation route unavailable |
| `PEGARR_ADMIN_TOKEN_FILE` | Yes | Absolute path to an independent random bearer token of 32 through 4096 characters |
| `PEGARR_GRAB_AUDIT_FILE` | Yes | Absolute SQLite path used for durable Grab request and outcome history |

Pegarr rejects a direct `PEGARR_ADMIN_TOKEN` and refuses to start if the administrator and read-only access token values are equal. The administrator token stays server-side except while a user types it into the page-memory confirmation dialog. See the [controlled Grab guide](controlled-grab.md).

## Docker secret deployment

Create the secret outside the repository and restrict it to the account managing the container:

```console
install -m 600 /dev/null /absolute/private/path/sonarr_api_key
install -m 600 /dev/null /absolute/private/path/radarr_api_key
install -m 600 /dev/null /absolute/private/path/bazarr_api_key
install -m 600 /dev/null /absolute/private/path/subdl_api_key
install -m 600 /dev/null /absolute/private/path/pegarr_access_token
install -m 600 /dev/null /absolute/private/path/pegarr_admin_token
```

Place the API key in that file using an editor that does not store it in shell history. Then set the non-secret variables in `.env`, including the host path used only by Docker Compose:

```dotenv
PEGARR_SONARR_URL=http://sonarr:8989
PEGARR_SONARR_ALLOWED_HOSTS=sonarr
PEGARR_SONARR_ALLOW_INSECURE_HTTP=true
PEGARR_SONARR_API_KEY_HOST_FILE=/absolute/private/path/sonarr_api_key
PEGARR_RADARR_URL=http://radarr:7878
PEGARR_RADARR_ALLOWED_HOSTS=radarr
PEGARR_RADARR_ALLOW_INSECURE_HTTP=true
PEGARR_RADARR_API_KEY_HOST_FILE=/absolute/private/path/radarr_api_key
PEGARR_BAZARR_URL=http://bazarr:6767
PEGARR_BAZARR_ALLOWED_HOSTS=bazarr
PEGARR_BAZARR_ALLOW_INSECURE_HTTP=true
PEGARR_BAZARR_API_KEY_HOST_FILE=/absolute/private/path/bazarr_api_key
PEGARR_SUBDL_URL=https://api.subdl.com
PEGARR_SUBDL_ALLOWED_HOSTS=api.subdl.com
PEGARR_SUBDL_API_KEY_HOST_FILE=/absolute/private/path/subdl_api_key
PEGARR_SUBDL_LANGUAGE_MAPPINGS=en:EN,pt-BR:PT-BR
PEGARR_SUBDL_PROBE_KIND=episode
PEGARR_SUBDL_PROBE_IMDB_ID=tt1234567
PEGARR_SUBDL_PROBE_POLICY_LANGUAGE=en
PEGARR_SUBDL_PROBE_PROVIDER_LANGUAGE=EN
PEGARR_SUBDL_PROBE_SEASON=1
PEGARR_SUBDL_PROBE_EPISODE=1
PEGARR_PROVIDER_CACHE_TTL_SECONDS=900
PEGARR_PROVIDER_CACHE_MAX_ENTRIES=5000
PEGARR_ACCESS_TOKEN_HOST_FILE=/absolute/private/path/pegarr_access_token
PEGARR_ADMIN_TOKEN_HOST_FILE=/absolute/private/path/pegarr_admin_token
PEGARR_MISSING_PAGE_SIZE=50
```

Enable the opt-in overlay alongside either Compose base:

```console
docker compose -f deploy/compose.nas.yaml -f deploy/compose.access.yaml -f deploy/compose.sonarr.yaml -f deploy/compose.radarr.yaml -f deploy/compose.bazarr.yaml -f deploy/compose.subdl.yaml up -d
```

The host secrets are mounted under `/run/secrets`; only those in-container paths are passed to Pegarr. Host paths and API keys must never be committed.

## Read-only verification

After startup, request:

```text
GET /api/v1/integrations/sonarr/status
GET /api/v1/integrations/radarr/status
```

Each response states whether its integration is disabled, available, unauthorized, rate limited, unavailable, or invalid. An available response includes only the application's canonical name, version, container flag, transport-security category, measured response bytes, bounded latency, and observation time. It never includes the API key, configured URL, hostname, instance name, filesystem paths, OS details, branch, URL base, or database metadata.

Each endpoint performs only `GET /api/v3/system/status`. Concurrent calls for the same integration share one in-flight request, and results are cached independently for 30 seconds so page refreshes cannot repeatedly hit Sonarr or Radarr. Neither endpoint searches releases or exposes a Grab operation.

For a fresh one-shot verification from the packaged container, run:

```console
docker compose -f deploy/compose.nas.yaml -f deploy/compose.sonarr.yaml run --rm pegarr npm run --silent probe:sonarr
docker compose -f deploy/compose.nas.yaml -f deploy/compose.radarr.yaml run --rm pegarr npm run --silent probe:radarr
docker compose -f deploy/compose.nas.yaml -f deploy/compose.bazarr.yaml run --rm pegarr npm run --silent probe:bazarr
docker compose -f deploy/compose.nas.yaml -f deploy/compose.subdl.yaml run --rm pegarr npm run --silent probe:subdl
```

Each command prints one compact JSON record. Exit code `0` means its integration was available; `1` means a configured upstream failure such as unauthorized or unavailable; `2` means disabled or invalid configuration. The Bazarr probe performs only the language-profile GET and reports counts, response bytes, and timing—never profile names, tags, language values, or library metadata. The SubDL probe performs exactly one search for the configured stable item/language window and reports only the result count, request count, quota evidence, and timing—never identifiers, language codes, release names, or credentials. The output is designed to be safe to attach to an issue, but review diagnostics before publishing it as a general precaution.
