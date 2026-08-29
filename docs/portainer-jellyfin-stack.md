# Portainer Jellyfin-stack deployment

The [`compose.portainer-jellyfin.yaml`](../deploy/compose.portainer-jellyfin.yaml) overlay adds Pegarr to an existing Compose stack whose Sonarr, Radarr, and Bazarr services share the `jellyfin_net` network. Catalog add and controlled Grab both remain disabled by default, and the overlay does not configure a subtitle provider.

The checked-in overlay matches the live `jellyfin` stack deployment validated on 2026-08-28. Port `8080` was already occupied on that NAS, so Pegarr is published on host port `8088` by default. Override `PEGARR_PORT` only after confirming the replacement port is free.

## Environment variables and credentials

Portainer environment variables are appropriate for non-secret topology and behavior settings such as service URLs, allowed hosts, the published port, cache limits, time zone, and Pegarr username. They are not an appropriate place for API keys, the Pegarr password, or the legacy access token because container metadata, process inspection, support bundles, and diagnostics can expose them.

`PEGARR_ADD_ENABLED` is a non-secret behavior switch and may be set in Portainer. Leave it `false` for a read-only deployment. Set it to `true` only after deploying an image that includes `PEG-CONFIG-015` and the add scenarios, and only when the username/password login is active. This enables the explicit add button; it never enables automatic Arr search or controlled Grab.

The current published image predates Pegarr's native application-config support. To keep the live deployment secret-safe without publishing a new image, the overlay mounts only these existing files read-only:

- Sonarr `/config/config.xml`;
- Radarr `/config/config.xml`;
- Bazarr `/config/config/config.yaml`.

Its startup wrapper extracts only the three application API keys into the container's private `/tmp` filesystem, generates Pegarr's password and legacy access token in the private `pegarr-data` volume when absent, and then starts Pegarr. It does not read subtitle-provider credentials from Bazarr.

The pinned image digest in this overlay predates username/password login, so it continues to use the legacy access token until a new image containing `PEG-ACCESS-005` and `PEG-CONFIG-014` is published. After that update, the default username is `pegarr` and the generated password is used. To display either credential deliberately from the NAS terminal, put Docker's options before the container name:

```console
docker exec -it jellyfin-pegarr-1 /bin/sh -c 'cat /data/password'
docker exec -it jellyfin-pegarr-1 /bin/sh -c 'cat /data/access_token'
```

Treat the terminal output as a password, do not paste it into Portainer variables, and clear shared terminal history or captures when appropriate.

After an image containing `PEG-CONFIG-013` is published, replace the wrapper and temporary key-file variables with the native settings below while retaining the same read-only mounts:

```yaml
environment:
  PEGARR_SONARR_APP_CONFIG_FILE: /run/upstream/sonarr-config.xml
  PEGARR_RADARR_APP_CONFIG_FILE: /run/upstream/radarr-config.xml
  PEGARR_BAZARR_APP_CONFIG_FILE: /run/upstream/bazarr-config.yaml
```

Do not combine an `APP_CONFIG_FILE` setting with the corresponding `API_KEY_FILE` setting. The native loader reads at most 1 MiB, requires exactly one application API key, and reports only redacted configuration errors.

## Deploy in Portainer

1. Export or copy the current stack definition before editing it.
2. Merge the `pegarr` service and the `pegarr-data` volume from the overlay into the existing stack; do not replace or recreate the existing service definitions.
3. Keep Pegarr on the same `jellyfin_net` network as Sonarr, Radarr, and Bazarr.
4. Update the stack and confirm `jellyfin-pegarr-1` becomes healthy while the existing containers remain running.
5. Open `http://NAS_ADDRESS:8088/health/ready`. A successful response proves Pegarr itself is ready. Validate live upstream status separately because browser automation and repository tests do not cross the NAS boundary.

The live dashboard boundary is enabled by credentials stored in `pegarr-data`; they are never printed during startup or placed in Portainer. The pinned image currently uses the legacy bearer token; the next compatible image uses the generated username/password while retaining token compatibility. Provider evidence remains `Unknown` until a supported subtitle-provider key is mounted separately. Catalog add remains disabled unless `PEGARR_ADD_ENABLED=true`, and controlled Grab remains disabled unless it is independently configured and separately confirmed.

## Roll back

Restore the exported pre-change Compose definition in the Portainer editor and update the stack. This removes only the Pegarr service. The `pegarr-data` volume remains for a recoverable redeploy unless it is deliberately removed later.
