# Runtime configuration

Pegarr starts with every external integration disabled. Sonarr becomes available only when all required settings are present and valid. Partial configuration stops startup with a redacted error instead of silently running with an unexpected boundary.

## Sonarr settings

| Variable | Required when enabled | Meaning |
| --- | --- | --- |
| `PEGARR_SONARR_URL` | Yes | Sonarr base URL, including an existing URL base when used |
| `PEGARR_SONARR_ALLOWED_HOSTS` | Yes | Comma-separated hostnames Pegarr may contact, without schemes, paths, credentials, or ports |
| `PEGARR_SONARR_API_KEY_FILE` | Yes | Absolute in-container path to a file containing only the Sonarr API key |
| `PEGARR_SONARR_INSTANCE_ID` | No | Safe non-secret label; defaults to `sonarr` |
| `PEGARR_SONARR_ALLOW_INSECURE_HTTP` | No | Must be explicitly `true` to permit HTTP; defaults to `false` |

Pegarr deliberately does not accept `PEGARR_SONARR_API_KEY`. Environment variables can be exposed by process inspection, container metadata, support bundles, or accidental diagnostics. The API key file is capped at 4096 bytes, parsed as one value, kept server-side, and serialized as `[redacted]` if the configuration object is accidentally encoded as JSON.

The base URL may use a Sonarr URL base, such as `https://media.example.invalid/sonarr`. The allowlist entry for that URL is only `media.example.invalid`.

## Docker secret deployment

Create the secret outside the repository and restrict it to the account managing the container:

```console
install -m 600 /dev/null /absolute/private/path/sonarr_api_key
```

Place the API key in that file using an editor that does not store it in shell history. Then set the non-secret variables in `.env`, including the host path used only by Docker Compose:

```dotenv
PEGARR_SONARR_URL=http://sonarr:8989
PEGARR_SONARR_ALLOWED_HOSTS=sonarr
PEGARR_SONARR_ALLOW_INSECURE_HTTP=true
PEGARR_SONARR_API_KEY_HOST_FILE=/absolute/private/path/sonarr_api_key
```

Enable the opt-in overlay alongside either Compose base:

```console
docker compose -f deploy/compose.nas.yaml -f deploy/compose.sonarr.yaml up -d
```

The host secret is mounted at `/run/secrets/sonarr_api_key`; only that in-container path is passed to Pegarr. The host path and API key must never be committed.

## Read-only verification

After startup, request:

```text
GET /api/v1/integrations/sonarr/status
```

The response states whether Sonarr is disabled, available, unauthorized, rate limited, unavailable, or invalid. An available response includes only Sonarr's application name, version, and container flag. It never includes the API key, configured URL, hostname, instance name, filesystem paths, OS details, branch, URL base, or database metadata.

This endpoint performs only `GET /api/v3/system/status`. It does not search releases or expose a Grab operation.
