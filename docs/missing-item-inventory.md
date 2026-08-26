# Missing-item inventory

Status: packaged, read-only Phase 0 discovery foundation; Sonarr live-compatible and Radarr fixture-proven

`npm run inventory:missing` reads one bounded page of monitored missing episodes from Sonarr and monitored missing movies from Radarr. It creates the common item identity needed by a future dashboard and interactive release table without exposing a browser route before authentication exists.

The command cannot search providers, Grab releases, update monitoring, or mutate either Arr application.

## Configuration and execution

Configure either or both Arr integrations through the secret-file overlays described in [runtime configuration](configuration.md). The optional `PEGARR_MISSING_PAGE_SIZE` accepts an integer from `1` through `100` and defaults to `50`.

```console
docker compose \
  -f deploy/compose.nas.yaml \
  -f deploy/compose.sonarr.yaml \
  -f deploy/compose.radarr.yaml \
  run --rm \
  -e PEGARR_MISSING_PAGE_SIZE=50 \
  pegarr npm run --silent inventory:missing
```

At least one Arr integration must be configured. Each configured integration receives exactly one paginated GET. The two reads run concurrently and a failure from one produces a usable `partial` result when the other succeeds.

Exit code `0` means a complete or partial inventory was built. Exit code `1` means every configured Arr integration failed. Exit code `2` means both integrations were disabled or configuration was invalid.

## Output boundary

Each item retains only:

- application and safe instance label;
- Arr item and parent identifiers;
- movie, series, and episode identity needed for later selection;
- monitored/file state and release or air timestamp;
- IMDb, TMDB, and TVDB identifiers when available.

Paths, overviews, artwork, ratings, tags, and upstream configuration are discarded. Titles and identifiers are still private library data, so sanitize output before attaching it to a public issue.

No missing-item browser route is exposed yet. That waits for an explicit Phase 1 authentication and privacy boundary.

`PEG-SONARR-007`, `PEG-SONARR-008`, `PEG-RADARR-007`, `PEG-RADARR-008`, `PEG-INVENTORY-001` through `PEG-INVENTORY-003`, and `PEG-DOCKER-008` are the deterministic evidence for this path.
