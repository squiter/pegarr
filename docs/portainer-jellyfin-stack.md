# Portainer Jellyfin-stack deployment

The [`compose.portainer-jellyfin.yaml`](../deploy/compose.portainer-jellyfin.yaml) overlay adds Pegarr to an existing Compose stack whose Sonarr, Radarr, and Bazarr services share the `jellyfin_net` network. It does not replace or recreate those services. Catalog add and controlled Grab remain disabled by default.

The live `jellyfin` stack was first validated with an older Pegarr image on 2026-08-28. Before updating it, export the current Portainer definition and compare it with this overlay. The release-candidate overlay deliberately has no default image: `PEGARR_IMAGE` must name the exact immutable digest already validated locally and published by CI.

On 2026-08-30, the live stack was updated to `ghcr.io/squiter/pegarr@sha256:d1822dcd9f3a0b187f0647699fa781d2794df55cb65797e0f35d337baa7ff063`. Portainer confirmed the saved definition uses the three native application-config mounts, secure session cookies, and `PEGARR_ADD_ENABLED=false`; Pegarr became healthy while Sonarr, Radarr, and Bazarr stayed running. The private `pegarr.brikas.net` proxy then passed HTTPS readiness, authentication-gate, redirect, controlled-restart, and bounded startup-log checks. On 2026-08-31, the authenticated dashboard also passed operator-session restore, missing-inventory load, Sonarr catalog search, and server-side settings restore. The first bounded SubDL-backed series preview returned `Pt-Br: Unsupported`, so live provider compatibility and cache reuse remain open rather than being reported as successful.

Port `8080` was occupied on the NAS, so the overlay publishes Pegarr on host port `8088` by default. Override `PEGARR_PORT` only after confirming the replacement port is free.

## Configuration and credentials

Portainer environment variables are appropriate for non-secret topology and behavior settings such as service URLs, allowed hosts, the published port, cache limits, time zone, and Pegarr username. Never place API keys, provider keys, Pegarr passwords, access tokens, or administrator tokens in Portainer variables.

Pegarr reads the existing applications' credentials through three narrowly mounted files:

- Sonarr `/config/config.xml`;
- Radarr `/config/config.xml`;
- Bazarr `/config/config/config.yaml`.

The native bounded configuration loader extracts only the required application API key in memory. The files remain mounted read-only, and Pegarr never reads subtitle-provider credentials from Bazarr.

On first startup, the overlay generates a Pegarr password and a legacy API access token inside the private `pegarr-data` volume. It never prints them during startup. Username/password sessions are the browser path; the bearer token remains only for compatible API clients. The image is intentionally slim and provides `/bin/sh`, not `/bin/bash`; Docker options must precede the container name.

```console
docker exec -it jellyfin-pegarr-1 /bin/sh
docker exec jellyfin-pegarr-1 /bin/sh -c 'cat /data/password'
```

After signing in, configure SubDL and OpenSubtitles from Pegarr's settings page. Provider keys are written under `/data/provider-secrets` with private permissions, mappings stay in `/data/provider-settings.json`, and neither value is returned to the browser. This configuration immediately powers pre-add coverage, post-add continuation, and existing-item analysis.

To display the generated login password deliberately from the NAS terminal:

```console
docker exec -it jellyfin-pegarr-1 /bin/sh -c 'cat /data/password'
```

Treat that output as a password. Do not paste it into Portainer variables, screenshots, issues, or shared terminal captures.

## Required Portainer variables

Set:

```text
PEGARR_IMAGE=ghcr.io/squiter/pegarr@sha256:<validated-digest>
SONARR_CONFIG_PATH=<existing Sonarr config directory>
RADARR_CONFIG_PATH=<existing Radarr config directory>
BAZARR_CONFIG_PATH=<existing Bazarr config directory>
```

Optional non-secret controls include `PEGARR_PORT`, `PEGARR_USERNAME`, `TZ`, and `PEGARR_ADD_ENABLED`. Leave `PEGARR_ADD_ENABLED=false` during the first deployment and read-only smoke test.

When the browser route is protected by verified HTTPS, set `PEGARR_SESSION_COOKIE_SECURE=true`. Keep it `false` only while testing a direct private HTTP route. Changing this flag before HTTPS works prevents the browser from returning the session cookie over HTTP.

Controlled Grab is intentionally absent from this overlay. Enable it only through a separately reviewed configuration with an independent administrator secret and after local controlled-Grab acceptance succeeds.

## First deployment or update

1. Export or copy the current Portainer stack definition as the rollback unit.
2. Record the currently deployed Pegarr image digest and confirm the existing Sonarr, Radarr, and Bazarr containers are healthy.
3. Set `PEGARR_IMAGE` to the exact validated digest. Never use `latest` for the acceptance deployment.
4. Merge only the `pegarr` service and `pegarr-data` volume changes into the existing stack. Preserve every existing media-service image, mount, path, network, and environment value.
5. Update the stack and confirm `jellyfin-pegarr-1` becomes healthy while the existing containers remain running.
6. Open `/health/ready`, then sign in and verify the onboarding page before configuring providers.

The overlay retains a read-only root filesystem, dropped capabilities, `no-new-privileges`, a bounded temporary filesystem, and the persistent `/data` volume.

## Read-only smoke test

Before enabling catalog add, verify:

- authentication is required before upstream work;
- Sonarr, Radarr, and Bazarr report safe available states;
- SubDL and OpenSubtitles settings survive one controlled Pegarr restart;
- a repeated stable provider window uses cached evidence rather than another provider request;
- the catalog and existing-item dashboards preserve Arr rejection reasons and honest provider failures;
- container logs contain no credentials, URLs with secrets, private media paths, provider response bodies, or download handles.

This advances the manual NAS and installed-service gaps but does not authorize an add, automatic search, controlled Grab, or arbitrary download.

## Rollback

Restore the exported pre-change Compose definition in the Portainer editor and update the stack. This returns the prior Pegarr service definition without changing Sonarr, Radarr, Bazarr, or their data.

Keep the `pegarr-data` volume for a recoverable redeploy unless its private settings and audit data have been backed up and the user explicitly decides to remove it. If the new image started successfully and migrated persistent data, retain a backup of that volume before rolling forward again.
