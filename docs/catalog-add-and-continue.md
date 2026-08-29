# Catalog add and continue

Pegarr can add a catalog title to Sonarr or Radarr without opening either Arr UI. This is an opt-in mutation: the default installation remains read-only, and controlled Grab is a separate capability.

## Enable the capability

Catalog add requires the conventional Pegarr username/password login. Configure the existing `PEGARR_USERNAME` and `PEGARR_PASSWORD_FILE`, then set the non-secret behavior flag:

```dotenv
PEGARR_ADD_ENABLED=true
```

Pegarr refuses to start when catalog add is enabled without username/password login. A valid legacy bearer token may read add options but cannot perform the add.

## User flow

1. Search the catalog and preview subtitle coverage.
2. Select **Add to Sonarr** or **Add to Radarr**.
3. Choose a server-owned root folder and quality profile plus monitoring defaults.
4. Type the exact server-provided confirmation phrase.
5. Confirm the add.

Pegarr re-resolves the exact TVDB or TMDB catalog record, root folder, and quality profile immediately before the mutation. The browser never supplies a filesystem path or forwards a complete catalog object.

Sonarr adds always send `searchForMissingEpisodes: false` and `searchForCutoffUnmetEpisodes: false`. Radarr adds always send `searchForMovie: false` and use manual add mode. No successful add starts a release download.

## API

```text
GET /api/v1/catalog/sonarr/<instance>/tvdb/<id>/add-options
GET /api/v1/catalog/radarr/<instance>/tmdb/<id>/add-options

POST /api/v1/catalog/sonarr/<instance>/tvdb/<id>/add
POST /api/v1/catalog/radarr/<instance>/tmdb/<id>/add
```

The POST body is exact and bounded. Sonarr accepts root-folder/profile IDs, `monitored`, a supported monitor mode, and the confirmation. Radarr accepts root-folder/profile IDs, `monitored`, a supported minimum availability, and the confirmation. Extra fields—including any automatic-search request—are rejected.

A successful response returns only a safe Arr ID, title, application/instance identity, `automaticSearch: false`, and a short-lived opaque Pegarr continuation. Before issuing it, Pegarr re-reads the created Arr record by internal ID and verifies that its TVDB or TMDB identity still matches the selected catalog title.

For Radarr, the dashboard follows the continuation automatically and opens exact movie release analysis using the explicit Pegarr subtitle policy. The continuation expires after ten minutes, is held only in bounded server memory, and repeated reads share one analysis. It never enables controlled Grab. Sonarr still requires the user to choose a season or episode before exact analysis; that scope selector is the next delivery slice.

```text
GET /api/v1/catalog/continuations/<opaque-id>/analysis
```

If the upstream POST times out, Pegarr reports `timeout_unknown` and does not claim the title was absent or retry automatically. If Arr accepts the add but the identity re-read fails or mismatches, Pegarr reports `verification_unknown`; the user must check the Arr library before trying again.

## Verification boundary

The deterministic harness injects synthetic Arr responses and proves request bodies, authentication ordering, output redaction, and the UI safety language. It never mutates a live Sonarr or Radarr service. `PEG-MANUAL-007` records the remaining installed-service compatibility check.
