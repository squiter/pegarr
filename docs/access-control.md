# Read-only API access control

Pegarr's live catalog and library APIs are disabled unless either `PEGARR_USERNAME` plus `PEGARR_PASSWORD_FILE`, or the legacy `PEGARR_ACCESS_TOKEN_FILE`, is configured. When disabled, protected routes return the same generic `404` response as an unknown route and perform no Sonarr or Radarr work.

The protected read-only routes are:

```text
GET /api/v1/catalog/search?q=<title>&application=<optional sonarr or radarr>
Authorization: Basic <Pegarr username and password>

GET /api/v1/catalog/<application>/<instance-id>/<provider-id>/<value>/coverage
GET /api/v1/settings/subtitles
Authorization: Basic <Pegarr username and password>

GET /api/v1/catalog/<application>/<instance-id>/<provider-id>/<value>/add-options
Authorization: Basic <Pegarr username and password>

POST /api/v1/catalog/<application>/<instance-id>/<provider-id>/<value>/add
Authorization: Basic <Pegarr username and password only>

GET /api/v1/catalog/continuations/<opaque-id>/analysis
Authorization: Basic <Pegarr username and password>

PUT /api/v1/settings/subtitles
PUT /api/v1/settings/providers/subdl
PUT /api/v1/settings/providers/opensubtitles
Authorization: Basic <Pegarr username and password only>

GET /api/v1/library/missing
Authorization: Basic <Pegarr username and password>

GET /api/v1/library/instances
Authorization: Basic <Pegarr username and password>

GET /api/v1/library/items/sonarr/<instance-id>/episode/<episode-id>/feasibility
GET /api/v1/library/items/radarr/<instance-id>/movie/<movie-id>/feasibility
Authorization: Basic <Pegarr username and password>
```

Legacy API clients may continue to send `Authorization: Bearer <access token>` when `PEGARR_ACCESS_TOKEN_FILE` is configured. Bearer access remains read-only: catalog add and subtitle-policy/provider settings mutations return `403 login_required` even when the bearer token is valid. Catalog add routes are absent unless `PEGARR_ADD_ENABLED=true`.

A missing, malformed, query-string, or incorrect token returns `401` before any upstream request. Mutation methods return `405`. Successful responses use `Cache-Control: no-store`, contain an explicit `read_only` mode, and retain only the private library evidence required by the current dashboard.

## Username and password boundary

Configure a safe username and mount a random password from a restricted secret file:

```dotenv
PEGARR_USERNAME=pegarr
PEGARR_PASSWORD_FILE=/run/secrets/pegarr_password
```

For Compose, set only the non-secret username and host secret-file path, then include the login overlay:

```dotenv
PEGARR_USERNAME=pegarr
PEGARR_PASSWORD_HOST_FILE=/absolute/private/path/pegarr_password
```

```console
docker compose \
  -f deploy/compose.nas.yaml \
  -f deploy/compose.login.yaml \
  -f deploy/compose.sonarr.yaml \
  -f deploy/compose.radarr.yaml \
  up -d
```

Pegarr rejects a direct `PEGARR_PASSWORD`, incomplete login pairs, unsafe usernames, passwords shorter than 32 characters, and secret files larger than 4096 bytes. The dashboard holds the resulting Basic authorization value only in page memory and requires login again after reload. Basic authentication does not encrypt traffic, so HTTPS or a trusted private network is mandatory. The planned final boundary replaces repeated Basic headers with a bounded server-side `HttpOnly`, `SameSite=Strict` session.

## Legacy token boundary

Generate a random token of at least 32 characters, store it outside the repository, and restrict the file to the account managing the container:

```console
install -m 600 /dev/null /absolute/private/path/pegarr_access_token
openssl rand -base64 32 > /absolute/private/path/pegarr_access_token
```

Set only its host path in `.env`:

```dotenv
PEGARR_ACCESS_TOKEN_HOST_FILE=/absolute/private/path/pegarr_access_token
```

Legacy installations can enable the token overlay with the Arr overlays whose missing items should appear:

```console
docker compose \
  -f deploy/compose.nas.yaml \
  -f deploy/compose.access.yaml \
  -f deploy/compose.sonarr.yaml \
  -f deploy/compose.radarr.yaml \
  up -d
```

The overlay mounts the token at `/run/secrets/pegarr_access_token`. Pegarr rejects `PEGARR_ACCESS_TOKEN` environment values, tokens shorter than 32 characters, and secrets larger than 4096 bytes. Rotate the file and recreate the container to replace the in-memory token.

Bearer authentication does not encrypt traffic. Use HTTPS or a trusted private network. Never place the token in a URL, log, fixture, issue attachment, browser storage, or committed file. The dashboard keeps it only in page memory and requires it again after reload unless a stronger server-side session design replaces this boundary.

The read-only token is deliberately unable to authorize a controlled Grab. Phase 2 uses a second administrator token, loaded from its own secret file, for the mutation routes. See [controlled Grab](controlled-grab.md).

## Request bounds

Authorized inventory reads request at most one configured page from each Arr instance. Concurrent requests share one in-flight operation, and completed results are reused for 30 seconds. `PEGARR_MISSING_PAGE_SIZE` defaults to 50 and accepts values from 1 through 100. The instance-status route probes every configured Arr through the same independently bounded 30-second status readers and returns only safe capability evidence plus each configured instance ID.

Authorized item reads resolve the requested instance and ID from that server-owned inventory before starting release, Bazarr, or provider work. Legacy unscoped URLs remain available only when the item identity is unambiguous. Successful item reports share a 30-second bounded in-memory window. See [item feasibility API](item-feasibility-api.md).

`PEG-ACCESS-001` through `PEG-ACCESS-005`, `PEG-CONFIG-006`, `PEG-CONFIG-014`, `PEG-CONFIG-015`, `PEG-CATALOG-001`, `PEG-CATALOG-002`, `PEG-CATALOG-006`, `PEG-CATALOG-007`, `PEG-SONARR-011`, `PEG-RADARR-010`, `PEG-INVENTORY-004`, `PEG-ITEM-001` through `PEG-ITEM-004`, `PEG-DOCKER-011`, and `PEG-DOCKER-013` are the deterministic evidence for this boundary.
