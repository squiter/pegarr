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

Before upgrading Pegarr, stop the running instance and back up the private data volume, including `grab-audit.sqlite`. Startup migrates an older supported audit schema in place. If startup follows an interrupted Grab, open **Grab history** before attempting that release again: the recovered event remains Unknown until an administrator verifies Arr and records the exact attestation.

## API flow

All endpoints use `Authorization: Bearer <administrator token>`. The regular library token cannot authorize them.

- `POST /api/v1/library/items/{application}/{instanceId}/{kind}/{itemId}/grab/prepare` accepts only `{ "releaseId": "..." }` and returns a short-lived, instance-bound challenge after revalidation.
- `POST /api/v1/library/items/{application}/{instanceId}/{kind}/{itemId}/grab/execute` accepts only the returned `challengeId`, the exact `confirmation`, and a client-generated `idempotencyKey`.
- `GET /api/v1/grabs/history?limit=50` returns at most 100 public audit events and never returns idempotency keys or Arr handles.
- `POST /api/v1/grabs/{eventId}/reconcile` accepts only an outcome (`grabbed` or `not_grabbed`) and its exact event-specific confirmation phrase.

Request bodies are JSON-only and limited to 16 KiB. Challenges live only in process memory, expire after two minutes, and are bounded to 100 entries. Restarting Pegarr invalidates outstanding challenges but preserves audit history.

The earlier single-instance item routes remain compatible. An instance-scoped request is required when an item ID would otherwise be ambiguous, and challenge binding, duplicate protection, and audit history are isolated by instance.

## Timeouts and reconciliation

An Arr timeout is not a failure and is not permission to retry. The result is `timeout_unknown`, the audit event is marked `reconciliation_required`, and Pegarr blocks the same target/release until it is reconciled. Open **Grab history**, authenticate with the independent administrator token, and check Sonarr or Radarr activity plus download-client state before reconciling the event.

Reconciliation never rewrites the original Unknown result. It appends a durable `grabbed` or `not_grabbed` operator attestation with its own timestamp and requires an exact release-and-target phrase. A verified `not_grabbed` outcome releases duplicate protection; a verified `grabbed` outcome keeps it. This is an operational assertion, so do not use it until the exact release has been checked in Arr.

The retry sequence is deliberately strict:

1. inspect the exact release in Sonarr or Radarr activity and in the download client;
2. open Pegarr's Grab history with the independent administrator token;
3. choose the observed outcome and type the exact event-specific phrase;
4. refresh the missing item before preparing another Grab;
5. if the item is still missing and the attestation was `not_grabbed`, prepare a new explicit Grab.

`PEG-DOCKER-025` boots the packaged image from a legacy synthetic audit database containing an interrupted Grab, verifies recovery as Unknown, proves the duplicate remains blocked, requires exact reconciliation, and permits exactly one later synthetic Arr mutation. Live Grab compatibility and operational reconciliation remain `PEG-MANUAL-004`; automated tests must never mutate local services or the NAS.
