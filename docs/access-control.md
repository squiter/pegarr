# Read-only API access control

Pegarr's live library API is disabled unless `PEGARR_ACCESS_TOKEN_FILE` points to a valid secret file. When disabled, protected routes return the same generic `404` response as an unknown route and perform no Sonarr or Radarr work.

The protected read-only routes are:

```text
GET /api/v1/library/missing
Authorization: Bearer <access token>

GET /api/v1/library/items/sonarr/episode/<episode-id>/feasibility
GET /api/v1/library/items/radarr/movie/<movie-id>/feasibility
Authorization: Bearer <access token>
```

A missing, malformed, query-string, or incorrect token returns `401` before any upstream request. Mutation methods return `405`. Successful responses use `Cache-Control: no-store`, contain an explicit `read_only` mode, and retain only the private library evidence required by the current dashboard.

## Secret boundary

Generate a random token of at least 32 characters, store it outside the repository, and restrict the file to the account managing the container:

```console
install -m 600 /dev/null /absolute/private/path/pegarr_access_token
openssl rand -base64 32 > /absolute/private/path/pegarr_access_token
```

Set only its host path in `.env`:

```dotenv
PEGARR_ACCESS_TOKEN_HOST_FILE=/absolute/private/path/pegarr_access_token
```

Enable the access overlay with the Arr overlays whose missing items should appear:

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

## Request bounds

Authorized inventory reads request at most one configured page from each Arr instance. Concurrent requests share one in-flight operation, and completed results are reused for 30 seconds. `PEGARR_MISSING_PAGE_SIZE` defaults to 50 and accepts values from 1 through 100.

Authorized item reads resolve the requested ID from that server-owned inventory before starting release, Bazarr, or provider work. Successful item reports share a 30-second bounded in-memory window. See [item feasibility API](item-feasibility-api.md).

`PEG-ACCESS-001` through `PEG-ACCESS-004`, `PEG-CONFIG-006`, `PEG-INVENTORY-004`, `PEG-ITEM-001` through `PEG-ITEM-004`, `PEG-DOCKER-011`, and `PEG-DOCKER-013` are the deterministic evidence for this boundary.
