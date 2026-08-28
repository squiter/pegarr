# Controlled Grab

Controlled Grab is Pegarr's opt-in Phase 2 mutation boundary and is disabled by default. The default image and the Phase 1 routes remain read-only unless an operator explicitly enables this feature and supplies an independent administrator secret.

## Safety contract

A Grab is never automatic. Pegarr requires all of the following for every attempt:

1. the selected episode or movie is still present in Pegarr's bounded missing inventory;
2. Sonarr or Radarr returns the same release again and still accepts it;
3. the user opens the administrator dialog for that exact release;
4. the user supplies the independent administrator token;
5. the user types the exact release-and-target confirmation phrase;
6. Pegarr records an `in_progress` audit event before revalidating once more;
7. only the server-held Arr handle is sent to `POST /api/v3/release`.

Pegarr does not expose the Arr `guid`, indexer ID, API key, or administrator token to the browser or audit database. Sonarr and Radarr rejection decisions remain authoritative. A release rejected during either revalidation is not Grabbed.

## Enable the feature

Controlled Grab requires the normal read-only access overlay, the relevant Sonarr or Radarr overlay, and the dedicated Grab overlay. Create a separate random administrator token of at least 32 characters outside the repository:

```console
install -m 600 /dev/null /absolute/private/path/pegarr_admin_token
```

Edit that file without placing the value in shell history. Add only its host path to `.env`:

```dotenv
PEGARR_ADMIN_TOKEN_HOST_FILE=/absolute/private/path/pegarr_admin_token
```

Then include the overlay:

```console
docker compose \
  -f deploy/compose.nas.yaml \
  -f deploy/compose.access.yaml \
  -f deploy/compose.sonarr.yaml \
  -f deploy/compose.radarr.yaml \
  -f deploy/compose.bazarr.yaml \
  -f deploy/compose.subdl.yaml \
  -f deploy/compose.grab.yaml up -d
```

The audit database is stored at `/data/grab-audit.sqlite` in the private persistent volume. Back it up with the rest of the Pegarr data volume. Do not publish it: release titles and library target labels are intentionally retained for accountability.

Run only one Pegarr instance against an audit database. On startup, any event left `in_progress` by an interrupted process is conservatively recovered as `timeout_unknown` with reconciliation required; Pegarr never assumes an interrupted POST failed.

## API flow

All endpoints use `Authorization: Bearer <administrator token>`. The regular library token cannot authorize them.

- `POST /api/v1/library/items/{sonarr/episode|radarr/movie}/{itemId}/grab/prepare` accepts only `{ "releaseId": "..." }` and returns a short-lived challenge after revalidation.
- `POST /api/v1/library/items/{sonarr/episode|radarr/movie}/{itemId}/grab/execute` accepts only the returned `challengeId`, the exact `confirmation`, and a client-generated `idempotencyKey`.
- `GET /api/v1/grabs/history?limit=50` returns at most 100 public audit events and never returns idempotency keys or Arr handles.

Request bodies are JSON-only and limited to 16 KiB. Challenges live only in process memory, expire after two minutes, and are bounded to 100 entries. Restarting Pegarr invalidates outstanding challenges but preserves audit history.

## Timeouts and reconciliation

An Arr timeout is not a failure and is not permission to retry. The result is `timeout_unknown`, the audit event is marked `reconciliation_required`, and Pegarr blocks the same target/release for ten minutes. Check Sonarr or Radarr activity and download-client state before any later attempt.

The harness proves this behavior with synthetic services only. Live Grab compatibility and operational reconciliation remain `PEG-MANUAL-004`; automated tests must never mutate local services or the NAS.
