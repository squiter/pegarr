# Runtime configuration

Pegarr starts with every external integration disabled. Sonarr and Radarr become available independently only when all required settings for that integration are present and valid. Partial configuration stops startup with a redacted error instead of silently running with an unexpected boundary.

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

Pegarr deliberately does not accept `PEGARR_SONARR_API_KEY` or `PEGARR_RADARR_API_KEY`. Environment variables can be exposed by process inspection, container metadata, support bundles, or accidental diagnostics. Each API key file is capped at 4096 bytes, parsed as one value, kept server-side, and serialized as `[redacted]` if the configuration object is accidentally encoded as JSON.

The base URL may use a Sonarr URL base, such as `https://media.example.invalid/sonarr`. The allowlist entry for that URL is only `media.example.invalid`.

## Docker secret deployment

Create the secret outside the repository and restrict it to the account managing the container:

```console
install -m 600 /dev/null /absolute/private/path/sonarr_api_key
install -m 600 /dev/null /absolute/private/path/radarr_api_key
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
```

Enable the opt-in overlay alongside either Compose base:

```console
docker compose -f deploy/compose.nas.yaml -f deploy/compose.sonarr.yaml -f deploy/compose.radarr.yaml up -d
```

The host secrets are mounted at `/run/secrets/sonarr_api_key` and `/run/secrets/radarr_api_key`; only those in-container paths are passed to Pegarr. Host paths and API keys must never be committed.

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
```

Each command prints one compact JSON record. Exit code `0` means its integration was available; `1` means a configured upstream failure such as unauthorized or unavailable; `2` means disabled or invalid configuration. The output is designed to be safe to attach to an issue, but review diagnostics before publishing it as a general precaution.
