# Portainer Jellyfin-stack deployment

The [`compose.portainer-jellyfin.yaml`](../deploy/compose.portainer-jellyfin.yaml) overlay adds Pegarr to an existing Compose stack whose Sonarr, Radarr, and Bazarr services share the `jellyfin_net` network. It does not replace or recreate those services. Catalog add and controlled Grab remain disabled by default.

The live `jellyfin` stack was first validated with an older Pegarr image on 2026-08-28. Before updating it, export the current Portainer definition and compare it with this overlay. The release-candidate overlay deliberately has no default image: `PEGARR_IMAGE` must name the exact immutable digest already validated locally and published by CI.

On 2026-08-30, the live stack was updated to `ghcr.io/squiter/pegarr@sha256:d1822dcd9f3a0b187f0647699fa781d2794df55cb65797e0f35d337baa7ff063`. Portainer confirmed the saved definition uses the three native application-config mounts, secure session cookies, and `PEGARR_ADD_ENABLED=false`; Pegarr became healthy while Sonarr, Radarr, and Bazarr stayed running. The private `pegarr.brikas.net` proxy then passed HTTPS readiness, authentication-gate, redirect, controlled-restart, and bounded startup-log checks. On 2026-08-31, the authenticated dashboard also passed operator-session restore, missing-inventory load, Sonarr catalog search, and server-side settings restore. The first bounded SubDL-backed series preview returned `Pt-Br: Unsupported`; `PEG-CATALOG-009` subsequently fixed failed-provider language attribution.

Later on 2026-08-31, Portainer deployed the corrected image at `ghcr.io/squiter/pegarr@sha256:dc89826ebb3d699e8ac225c6019aad120ab8398a4710ee24807af11e5fe75340` without changing the other services or safety controls. The new container became healthy, HTTPS readiness returned `200`, persisted login and provider settings survived the replacement, and the password file remained private at mode `0600`. Bounded Sonarr-series and Radarr-movie previews reported `pt-br: Unknown`, not `Unsupported`, when the configured providers initially rejected authentication. Those failures were deliberately not cached and were superseded by the successful provider acceptance below.

The discovery-first navigation update was then deployed at `ghcr.io/squiter/pegarr@sha256:f4e60a22eff42c275f788b8f87c5552d0ad848de5c51b0805c85ecc87c1ea785`. Portainer preserved the full 5,278-character stack definition and changed only that immutable Pegarr image reference, with pruning and forced re-pull disabled. The replacement became healthy while Jellyfin, Sonarr, Radarr, Bazarr, Lidarr, and Prowlarr remained running. HTTPS readiness returned `ready`, and the live dashboard assets exposed the collapsible setup drawer, page-memory-only first-run dismissal, catalog-first markup, and the honest `Credential saved (not verified)` label.

Authenticated desktop and 390-pixel mobile acceptance then exposed two modal-behavior gaps: reverse tabbing could escape to the header, and the background page remained scrollable behind the drawer. `PEG-DASH-052` ratchets both fixes. The final image at `ghcr.io/squiter/pegarr@sha256:1ea99e80957749eab141cf471c0507d8bd64c7d5c917c1bdf38b7f3a365b65f1` became healthy with every sibling service still running. Live acceptance confirmed the ready installation keeps setup collapsed, catalog discovery remains first, Sonarr and Radarr report ready, both provider secret fields remain blank, Tab and Shift+Tab wrap inside the modal, Escape restores focus to the menu, and the body scroll lock is added only while the drawer is open. HTTPS readiness remained `ready`, unauthenticated session access remained `401`, and bounded container logs contained startup and readiness success with no error or `5xx` event. No credential change, provider search, catalog add, automatic search, Grab, or download mutation was performed.

The actionable discovery update was then deployed at `ghcr.io/squiter/pegarr@sha256:bd9cacdf6935fbeba7bf4fb729ba42b88ccae5e520858fff6697762394992b60` with `PEGARR_ADD_ENABLED=true`. Portainer changed only the Pegarr image and that one behavior flag; Pegarr returned healthy while Jellyfin, Sonarr, Radarr, Bazarr, Lidarr, and Prowlarr remained running. The live catalog replaced the ambiguous status with **Not In Sonarr/Radarr** plus a separate **Add to Sonarr/Radarr** action. Opening Game of Thrones loaded Sonarr's real `tv` root folder, `Any` quality profile, monitoring choices, and exact confirmation phrase; the form was canceled before confirmation, so Sonarr was not changed and no automatic search ran.

Live subtitle acceptance also succeeded. A bounded Game of Thrones series preview returned **Pt-Br: Available (30 matches)** from SubDL, and The Adventures of Tintin movie preview returned **Pt-Br: Available (1 match)** from SubDL. OpenSubtitles independently reported temporary service unavailability without hiding SubDL's positive movie evidence. The first Game of Thrones attempt received a transient provider rejection and correctly remained **Could Not Check**; a retry succeeded. Commit `29508c7` therefore changes the rejection guidance to retry once and update the API key only if the rejection persists. Successful live SubDL language compatibility is proven; quota and cache-hit evidence remain open, as does a successful OpenSubtitles response.

Portainer then replaced only Pegarr with the `29508c7` image at `ghcr.io/squiter/pegarr@sha256:108b07b774c5a8d00059465de6a632c97f6c15c3be9fab41ed332b8b7fb3d7ad`. The new container returned HTTPS readiness `200`, the unauthenticated session route remained `401`, and the served dashboard asset contained the corrected transient-rejection guidance. The proxy returned a brief `502` while the container was being replaced and recovered to `ready`; no catalog add, automatic search, Grab, or download mutation occurred during this wording-only redeploy.

The catalog-confirmation UX fix at commit `143b7d9` was deployed as `ghcr.io/squiter/pegarr@sha256:022b19b6984e14d8b8e0bf41b3a239e28f08c9e547c2adc37c7e42713b06b3b4`. Portainer preserved the 5,277-character stack definition and changed only the Pegarr digest. Pegarr became healthy while all six sibling services stayed running. HTTPS readiness returned `ready`, the session route stayed authenticated with an unauthenticated `401`, and the served assets contained the focused confirmation field, explanatory disabled state, mismatch guidance, exact-match success state, and visibly disabled button styling. The container replacement expired the prior Pegarr browser session, so this acceptance did not submit a catalog add or claim a fresh authenticated interaction.

The simpler catalog-add flow at commit `95c794b` superseded that typed-confirmation design and was deployed as `ghcr.io/squiter/pegarr@sha256:ce7c4bac6c245e0c5e7f9dc17ed6a08028fd9430179be650fe234567542c4fe1`. Portainer reported exactly one image-reference replacement and preserved the rest of the stack. Pegarr became healthy while Jellyfin, Sonarr, Radarr, Bazarr, Lidarr, and Prowlarr remained running. HTTPS readiness returned `ready`, unauthenticated session access remained `401`, and the served dashboard asset contained the single **Add to Sonarr/Radarr** submit label while the typed phrase, confirmation view, and confirmation payload were absent. This acceptance deliberately stopped before the Add action, so it performed no catalog add, automatic search, Grab, or download mutation.

The first authorized live Sonarr add then created Severance with the selected `tv` root, `Any` quality profile, all episodes monitored, and automatic search disabled. Sonarr populated the series and both seasons while title-scoped queue and history checks contained no Severance activity. The immediate Pegarr continuation exposed a transient empty-episode race. Commit `bede482` fixed that race, and Portainer replaced exactly one Pegarr digest with `ghcr.io/squiter/pegarr@sha256:03842df75d9778caf8c60f00b689dfd2e50670067b1ae6e886daea1a169d7c51`. The replacement became healthy, all six sibling services remained running, HTTPS readiness returned `ready`, the unauthenticated session route remained `401`, and the served dashboard asset contained bounded scope retries plus the explicit retry button. The container restart expired the browser session before fresh exact-analysis interaction, so installed exact release compatibility and the equivalent Radarr add remain open. No controlled Grab was attempted.

On 2026-09-01, Portainer replaced only Pegarr with restart-safe-session digest `ghcr.io/squiter/pegarr@sha256:c16c6ccdb58d82a3885fbb737812049f7ccdfd30fcbaf6c0e83ba45f96537f8c`. The new container became healthy at revision `0d821b041d930a79e5d6950671a020a6ce4bfad1`, HTTPS readiness returned `ready`, unauthenticated session access remained `401`, and all six sibling containers retained their running state and earlier creation timestamps. After the one unavoidable migration login from the previous memory-only release, Portainer restarted only `jellyfin-pegarr-1`; its log recorded a graceful `SIGTERM`, fresh server start, and authenticated session restore. Reloading the same browser tab remained signed in, restored settings and the 50-item inventory, and a read-only Game of Thrones preview returned `Pt-Br: Available (30 Matches)` from SubDL. No catalog add, automatic search, controlled Grab, or download mutation occurred.

The same deployment then completed exact read-only Severance S02E10 analysis with the installed `PT-BR + English` Bazarr series assignment and 29 Sonarr candidates. The first analysis stored successful SubDL evidence with 1,978 of 2,000 provider requests remaining; an explicit refresh reported a provider-cache hit and the unchanged quota value while still refreshing Sonarr and Bazarr. OpenSubtitles authentication failure and the unmapped English policy language stayed separately visible. This closes live SubDL compatibility and cache reuse while leaving Radarr exact analysis/add, Bazarr movie assignment, successful OpenSubtitles evidence, and controlled Grab as manual boundaries.

The published `v0.1.1` image at `ghcr.io/squiter/pegarr@sha256:674d08386f05657a1d686979f451357897ed773d95e85ea304c0c698d17cd2a0` then replaced only Pegarr. The saved Portainer definition contained the new digest exactly once and no longer contained the previous digest. Pegarr became healthy at version `0.1.1` and revision `f79b9d8247cf4596433a7210ceb138bfb4f211d0`; the existing login survived, and all six sibling containers retained their earlier creation timestamps.

The authorized live Radarr flow added **The Adventures of Tintin** as monitored with automatic search disabled, immediately returned 11 exact Radarr release candidates, and left controlled Grab disabled. Radarr's queue remained empty and its history contained no Tintin event. A manual Bazarr Radarr-sync job completed and named Tintin, but Bazarr correctly kept it out of the movie inventory because no video file exists. Pegarr must therefore retain its explicit pre-download policy across continuation refreshes. `PEG-DASH-057` ratchets the discovered refresh-routing fix for the `v0.1.2` follow-up; no second add, automatic search, Grab, or download is required for that deployment check.

The stable `v0.1.2` image at `ghcr.io/squiter/pegarr@sha256:fca18d1dfb9bcab34ab4ba57b1f9d2f7f6e3c625a6d7e06a79d71ed1fcc2b48f` then replaced only Pegarr in the saved 5,277-character definition. It became healthy at version `0.1.2` and revision `cf846794d167034341c39e733b2323f6da5d5f65`; the existing login and 51-item inventory survived, the corrected refresh route was served, and all six sibling containers retained their earlier creation times. A sanitized console check as the `node` user reported `/data/provider-secrets` at mode `0700` and its two API-key files, provider settings, subtitle settings, and session database at mode `0600`, all owned by `node:node`. No secret value, second catalog add, automatic search, controlled Grab, or download was involved.

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
