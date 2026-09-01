# Read-only API access control

Pegarr's live catalog and library APIs are disabled unless either `PEGARR_USERNAME` plus `PEGARR_PASSWORD_FILE`, or the legacy `PEGARR_ACCESS_TOKEN_FILE`, is configured. When disabled, protected routes return the same generic `404` response as an unknown route and perform no Sonarr or Radarr work.

The protected read-only routes are:

```text
GET /api/v1/catalog/search?q=<title>&application=<optional sonarr or radarr>
Authentication: Pegarr server session, Basic, or legacy Bearer

GET /api/v1/catalog/<application>/<instance-id>/<provider-id>/<value>/coverage
GET /api/v1/settings/subtitles
Authentication: Pegarr server session, Basic, or legacy Bearer

GET /api/v1/catalog/<application>/<instance-id>/<provider-id>/<value>/add-options
Authentication: Pegarr server session, Basic, or legacy Bearer

POST /api/v1/catalog/<application>/<instance-id>/<provider-id>/<value>/add
Authentication: Pegarr server session plus CSRF token, or Basic for compatible API clients

GET /api/v1/catalog/continuations/<opaque-id>/analysis
GET /api/v1/catalog/continuations/<opaque-id>/scopes
GET /api/v1/catalog/continuations/<opaque-id>/analysis/season/<season-number>
GET /api/v1/catalog/continuations/<opaque-id>/analysis/episode/<episode-id>
Authentication: Pegarr server session, Basic, or legacy Bearer

PUT /api/v1/settings/subtitles
PUT /api/v1/settings/providers/subdl
PUT /api/v1/settings/providers/opensubtitles
Authentication: Pegarr server session plus CSRF token, or Basic for compatible API clients

GET /api/v1/library/missing
Authentication: Pegarr server session, Basic, or legacy Bearer

GET /api/v1/library/instances
Authentication: Pegarr server session, Basic, or legacy Bearer

GET /api/v1/onboarding
Authentication: Pegarr server session, Basic, or legacy Bearer

GET /api/v1/library/items/sonarr/<instance-id>/episode/<episode-id>/feasibility
GET /api/v1/library/items/radarr/<instance-id>/movie/<movie-id>/feasibility
Authentication: Pegarr server session, Basic, or legacy Bearer
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

Pegarr rejects a direct `PEGARR_PASSWORD`, incomplete login pairs, unsafe usernames, passwords shorter than 32 characters, and secret files larger than 4096 bytes. The dashboard sends the username and password once to `POST /api/v1/session/login`, clears the password immediately, and receives an opaque host-only `HttpOnly`, `SameSite=Strict` cookie. Sessions expire after 30 days without authenticated use and are limited to 100 concurrent entries. Their SHA-256 session and CSRF digests, current expiry, and insertion order are stored in the mode-`0600` `DATA_DIR/sessions.sqlite` file; the configured password and raw browser tokens are never persisted there. A safe process or container restart restores an unexpired session without implicitly extending it. Reloading restores the page-memory CSRF token through `GET /api/v1/session` and renews the bounded inactivity window, while `POST /api/v1/session/logout` durably invalidates the session and clears the cookie.

State-changing login routes also require a separate CSRF token kept only in page memory. Reload rotates that token. Set `PEGARR_SESSION_COOKIE_SECURE=true` when Pegarr is served through HTTPS so the cookie also carries `Secure`; leave it false only for a trusted private HTTP deployment. Basic authentication does not encrypt traffic, so HTTPS or a trusted private network remains mandatory.

```text
POST /api/v1/session/login   { "username": "...", "password": "..." }
GET  /api/v1/session         restores the page-memory CSRF token
POST /api/v1/session/logout  requires X-Pegarr-CSRF and clears the session
```

The opaque session token is returned only as the `HttpOnly` cookie. Login and restore responses return the CSRF token and current expiry, never the session token or configured password.

The authenticated onboarding route returns only safe counts, configured/not-configured prerequisite states, deployment capability flags, and the current access class. It never probes a subtitle provider, returns a hostname or API key, or claims an unavailable provider is a subtitle miss. A username/password session is described as an operator session for settings and optional catalog add; legacy bearer access is described as read-only; controlled Grab always remains behind the independent administrator token.

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

Bearer authentication does not encrypt traffic. Use HTTPS or a trusted private network. Never place the token in a URL, log, fixture, issue attachment, browser storage, or committed file. The dashboard keeps a legacy bearer token only in page memory and requires it again after reload.

The read-only token is deliberately unable to authorize a controlled Grab. Phase 2 uses a second administrator token, loaded from its own secret file, for the mutation routes. See [controlled Grab](controlled-grab.md).

Exact movie, episode, and server-issued season catalog continuations can use that same administrator boundary when both catalog add and controlled Grab are enabled:

```text
POST /api/v1/catalog/continuations/<opaque-id>/analysis/grab/prepare
POST /api/v1/catalog/continuations/<opaque-id>/analysis/grab/execute
POST /api/v1/catalog/continuations/<opaque-id>/analysis/season/<season-number>/grab/prepare
POST /api/v1/catalog/continuations/<opaque-id>/analysis/season/<season-number>/grab/execute
POST /api/v1/catalog/continuations/<opaque-id>/analysis/episode/<episode-id>/grab/prepare
POST /api/v1/catalog/continuations/<opaque-id>/analysis/episode/<episode-id>/grab/execute
Authorization: Bearer <independent administrator token>
```

Administrator authorization is checked before continuation lookup, Arr revalidation, or audit work. The browser cannot submit an Arr item ID, target label, or release handle; a season-pack mutation is accepted only for the exact season number already issued by the continuation.

## Request bounds

Authorized inventory reads request at most one configured page from each Arr instance. Concurrent requests share one in-flight operation, and completed results are reused for 30 seconds. `PEGARR_MISSING_PAGE_SIZE` defaults to 50 and accepts values from 1 through 100. The instance-status route probes every configured Arr through the same independently bounded 30-second status readers and returns only safe capability evidence plus each configured instance ID.

Authorized item reads resolve the requested instance and ID from that server-owned inventory before starting release, Bazarr, or provider work. Legacy unscoped URLs remain available only when the item identity is unambiguous. Successful item reports share a 30-second bounded in-memory window. See [item feasibility API](item-feasibility-api.md).

`PEG-ACCESS-001` through `PEG-ACCESS-005`, `PEG-SESSION-001` through `PEG-SESSION-003`, `PEG-ONBOARD-001`, `PEG-ONBOARD-002`, `PEG-CONFIG-006`, `PEG-CONFIG-014`, `PEG-CONFIG-015`, `PEG-CATALOG-001`, `PEG-CATALOG-002`, `PEG-CATALOG-006`, `PEG-CATALOG-007`, `PEG-SONARR-011`, `PEG-RADARR-010`, `PEG-INVENTORY-004`, `PEG-ITEM-001` through `PEG-ITEM-004`, `PEG-DOCKER-011`, and `PEG-DOCKER-013` are the deterministic evidence for this boundary.
