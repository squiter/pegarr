# Sonarr season feasibility report

Status: packaged, read-only, fixture-proven, and compatible with the installed Sonarr season-search contract; live SubDL verification remains manual

`npm run report:sonarr-season` performs one Sonarr season release search, reads the Bazarr series assignment and language profile, searches SubDL once per mapped policy language for season-level results, and evaluates explicit full-season subtitle packs against every video release.

It cannot Grab, download, update, or delete anything and is not exposed as a browser route.

When the [provider search cache](provider-search-cache.md) is enabled, successful item/language windows are reused across command invocations. Cache hits are visible in `report.providerStatus` and count as zero provider requests. Failures and quota responses are never cached.

## Coverage semantics

- Sonarr's `fullSeason`, season number, and episode-number coverage remain attached to each release row.
- A subtitle marked `fullSeason: true` may satisfy a season or an episode in that season.
- Individual and bounded multi-episode subtitle evidence can satisfy only the episodes it explicitly lists; neither can satisfy an entire season.
- Mixed provider results do not inflate partial coverage: a full-season pack may win, while individual episode rows remain local evidence only.
- If a provider omits full-season coverage metadata, season confidence is `Unknown` rather than `No match found`.
- Provider failures and quota exhaustion remain `Unknown`.
- Bazarr's installed Brazilian Portuguese code `pb` canonicalizes to `pt-BR`, so the normal `pt-BR` mapping works without a second alias entry.

## Request file

The command reads `PEGARR_SEASON_REPORT_REQUEST_FILE`, which must be an absolute in-container JSON path no larger than 64 KiB:

```json
{
  "sonarrSeriesId": 42,
  "seasonNumber": 3,
  "item": {
    "kind": "season",
    "title": "Example Show — Season 3",
    "season": 3,
    "ids": {
      "imdb": "tt1234567",
      "tmdb": "12345"
    }
  },
  "subdlLanguages": [
    { "policyCode": "en", "providerCode": "EN" },
    { "policyCode": "pt-BR", "providerCode": "PT-BR" }
  ]
}
```

`seasonNumber` and `item.season` must match. Specials season `0` is intentionally unsupported in this initial contract because the provider's season identity needs separate validation.

Keep the request file outside the repository with mode `0600`.

## Packaged execution

Configure Sonarr, Bazarr, and SubDL through the secret-file overlays in [runtime configuration](configuration.md):

```console
docker compose \
  -f deploy/compose.nas.yaml \
  -f deploy/compose.sonarr.yaml \
  -f deploy/compose.bazarr.yaml \
  -f deploy/compose.subdl.yaml \
  run --rm \
  --mount type=bind,source=/absolute/private/path/season-report.json,target=/run/pegarr/season-report.json,readonly \
  -e PEGARR_SEASON_REPORT_REQUEST_FILE=/run/pegarr/season-report.json \
  pegarr npm run --silent report:sonarr-season
```

Exit code `0` means a report was built. Exit code `1` means policy resolution or an upstream integration failed. Exit code `2` means integrations were disabled or configuration was invalid.

The output includes private titles, identifiers, release names, and policy evidence. Sanitize it before sharing publicly.

`PEG-SONARR-009`, `PEG-SUBDL-006`, `PEG-SUBDL-007`, `PEG-MATCH-009`, `PEG-MATCH-010`, `PEG-MATCH-012`, `PEG-SEASONFLOW-001` through `PEG-SEASONFLOW-004`, `PEG-SEASONREPORT-001`, `PEG-SEASONREPORT-002`, `PEG-CACHE-001` through `PEG-CACHE-008`, `PEG-DOCKER-009`, and `PEG-DOCKER-010` are the deterministic evidence for this path.
