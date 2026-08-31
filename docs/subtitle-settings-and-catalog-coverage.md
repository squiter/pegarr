# Subtitle settings and pre-add catalog coverage

Pegarr now has a server-owned explicit default subtitle policy and a read-only pre-add coverage route. This is the second discovery-first implementation slice; it does not add a title or Grab a release.

## Dashboard behavior

After username/password sign-in, catalog discovery is the first content in the normal page flow. First-run guidance, subtitle policy, and provider configuration live in the **Setup & settings** drawer in the signed-in header. Pegarr opens that drawer automatically while a prerequisite is incomplete; the user can close it for the rest of the page session, and it remains available from the header. Once onboarding reports ready, later page loads keep the drawer collapsed by default. This state is page-memory-only and does not add browser storage. While the drawer is open, keyboard focus stays inside its modal boundary and the page behind it cannot scroll; Escape closes it and restores focus to the menu button.

The drawer lets the user enter up to 16 comma-separated language codes. Each language gets explicit controls for required versus optional coverage, forced-only subtitles, and hearing-impaired subtitles with either, prefer, require, or avoid semantics. New languages start as required, non-forced, and either; saved values round-trip through the same server-owned policy model used by matching.

The settings panel reports whether SubDL and OpenSubtitles credentials are saved and how many explicit language mappings each provider has. A saved credential is explicitly labeled **not verified** until a coverage preview proves that the provider accepts it; storage alone is not presented as provider health. A username/password login can paste or replace a provider API key and edit mappings directly in Pegarr. The key input clears immediately after submission, a stored key is never returned to the browser, and leaving the field blank preserves the current UI-managed or deployment-managed credential.

UI-managed provider credentials use the official HTTPS service endpoints. They become available immediately without a container restart for pre-add catalog coverage, post-add continuation analysis, and existing missing-item analysis. A settings revision rebuilds the existing-item analysis boundary so cached results from an older provider configuration are not reused. The existing deployment secret-file variables remain supported and remain the source for packaged probes and one-shot report commands, which intentionally run independently of the web application's data store.

Catalog results expose **Preview subtitles** when they have a safe TVDB identity for Sonarr or TMDB identity for Radarr. Pegarr re-runs an exact catalog lookup server-side before spending provider quota, then returns only aggregate language coverage and provider health.

The preview presents an answer, not an unexplained state: **Available** includes the aggregate match count, **Not found** means a configured provider completed the search successfully with no evidence, and **Could not check** is followed by the provider-level reason and action. An authentication rejection asks the operator to retry once because provider rejection can be transient, then directs them to replace the API key in **Setup & settings** only if it persists. Rate limits, timeouts, service unavailability, invalid responses, and missing language mappings remain distinct. Pegarr never changes one of those failures into **Not found**.

For series, the current preview is title-level SubDL evidence with no season or episode restriction. It proves that the provider has matching title evidence, not that every episode or cut is covered. Movie previews may use both configured providers. Exact release compatibility is still evaluated only after the explicit add-and-continue step creates an Arr internal ID.

## API

```text
GET /api/v1/settings/subtitles
PUT /api/v1/settings/subtitles
PUT /api/v1/settings/providers/subdl
PUT /api/v1/settings/providers/opensubtitles

GET /api/v1/catalog/sonarr/<instance-id>/tvdb/<tvdb-id>/coverage
GET /api/v1/catalog/radarr/<instance-id>/tmdb/<tmdb-id>/coverage
```

Settings reads and coverage previews accept any configured Pegarr library credential. Settings writes require username/password login; the legacy bearer token remains read-only. PUT accepts exactly:

```json
{
  "languages": [
    {
      "code": "pt-BR",
      "required": true,
      "forced": false,
      "hearingImpaired": "either"
    }
  ]
}
```

The policy is stored atomically at `DATA_DIR/subtitle-settings.json` with mode `0600`. The file contains only normalized policy fields and a revision; no credential, authorization value, media title, identifier, release name, provider response, or URL is persisted there.

Provider PUT accepts exactly a `languageMappings` array and an optional `apiKey`:

```json
{
  "apiKey": "replace-with-a-provider-key",
  "languageMappings": [
    { "policyCode": "pt-BR", "providerCode": "PT-BR" }
  ]
}
```

Provider mapping metadata is stored in `DATA_DIR/provider-settings.json`. Credentials are stored separately at `DATA_DIR/provider-secrets/<provider>-api-key`; the directory is mode `0700` and each file is mode `0600`. Both writes are atomic. Public settings responses return only `configured`, `origin`, and language mappings. Provider PUT is username/password-only; a legacy bearer token receives `403 login_required`.

## Honest coverage states

- `available`: at least one configured provider returned subtitle evidence for the language.
- `no_match_found`: a supported provider search succeeded and returned no evidence.
- `unknown`: a provider failed, timed out, rejected authentication, or exhausted quota and no positive evidence was available.
- `unsupported`: no configured provider mapping supports that policy language.

The response includes aggregate subtitle counts and safe provider status/quota/cache evidence. It deliberately omits provider subtitle IDs and release names because exact release matching is not yet possible at this stage.

`PEG-SETTINGS-001` through `PEG-SETTINGS-004`, `PEG-PROVIDERSETTINGS-001` through `PEG-PROVIDERSETTINGS-003`, `PEG-CATALOG-003` through `PEG-CATALOG-005`, `PEG-DASH-042` through `PEG-DASH-044`, `PEG-DASH-049`, and `PEG-DASH-051` through `PEG-DASH-053` are the deterministic evidence for this slice.
