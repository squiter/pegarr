# Missing-item dashboard

Pegarr's first user-facing read-only MVP page is served at `/`. It shows monitored missing episodes from Sonarr and missing movies from Radarr after the user enters the separately configured Pegarr access token.

The page deliberately does not contain or receive Sonarr, Radarr, Bazarr, or subtitle-provider credentials. The Pegarr token is held only in the JavaScript module's memory, removed from the input immediately, and cleared by reload or tab closure. It is sent only in the `Authorization` header with cookies omitted. It is never placed in a URL, browser storage, HTML, diagnostics, or the inventory view model.

## Current behavior

- An explicit connect panel explains the memory-only token boundary.
- Missing episodes and movies are shown with application, title, episode or year context, and availability date.
- Search matches title, series context, and application.
- After an item is analyzed, search also matches its Bazarr profile name and language codes.
- Application and type filtering switch between Sonarr/Radarr and episodes/movies. Analysis filters distinguish not analyzed, analyzed or attempted, needs-attention, and stale items; best-confidence filtering uses only completed reports and Arr-accepted releases.
- After reports are analyzed, exact Bazarr-profile and policy-language options are derived from the safe page-memory summaries. No profile or language is hardcoded or fetched again for these controls.
- Analysis-age filtering distinguishes reports generated within the last hour, older reports, and items without a generation timestamp. The boundary uses the report's safe generation time and the current page clock.
- The dashboard counts active filters and clears all filters in one action without changing the selected sort order.
- Required-language coverage is summarized independently for every language Bazarr marks required, using only Arr-accepted releases. A rejected release cannot satisfy coverage, missing or failed evidence remains Unknown, and a successful empty search remains No match found.
- Provider-evidence health distinguishes fully available, partial, unavailable, and unknown searches. It stays separate from match confidence, so a timeout or quota failure cannot be presented as subtitle absence.
- Sorting supports availability, title, type, best Arr-accepted subtitle confidence, and most recent analysis.
- Filtering and sorting operate on already loaded rows and do not call Pegarr or the Arr services.
- Refresh is explicit. Pegarr's server-side 30-second cache prevents repeated refreshes from repeatedly calling the Arr services.
- Partial inventory identifies the unavailable integration without hiding usable results.
- Selecting an item opens its interactive release table and requests one protected read-only feasibility report.
- Video acceptance and Arr rejection reasons remain separate from subtitle confidence.
- The resolved policy states whether it came from Bazarr or an explicit default and shows every language's required/optional, forced, hearing-impaired, audio-applicability, and cutoff semantics without guessing missing values.
- Each release exposes per-language confidence, contributing provider count, provider state, matching evidence, and warnings.
- Each release also gets an honest required-language fit: Strong, Possible, No match found, Unknown, or No required languages. Unknown wins whenever required evidence is incomplete, so an outage cannot masquerade as absence.
- Release rows also show safe Arr size, age, seeders/leechers when supplied, release group/edition, language names, and matched custom formats. Download handles and credentials never enter the browser model.
- Release search matches the loaded title, indexer, quality, protocol, group, edition, Arr languages, and custom-format names. Protocol filtering keeps torrent and Usenet decisions separate without hiding Arr rejection state.
- Release controls sort by the combined decision order, subtitle confidence, custom-format score, seeders, size, age, or title. Missing numeric evidence is always placed last.
- Required-language fit, policy-language, and language-confidence filters are derived from the current policy and operate only on loaded assessments. A confidence filter without a selected language matches any policy language with that confidence.
- A clearly labeled leading Arr-accepted candidate shows the first row in the deterministic recommended ordering. It is decision support only, never promotes an Arr-rejected release, and cannot trigger a Grab.
- A page-memory shortlist holds up to three release candidates in selection order. Its side-by-side table preserves Arr decisions and rejection reasons, aligns each Bazarr-derived policy language across candidates, and compares quality, protocol, group, custom-format score, size, age, and seeder evidence.
- Relative markers identify the strongest available subtitle confidence, required-language fit, custom-format score, seeder count, release age, and per-language confidence in the current shortlist. Ties remain marked together, unavailable or negative subtitle evidence is never labeled strongest, and the table does not collapse these independent fields into an automatic winner.
- Each comparison column can be removed independently. “Show release” clears only the local release filters, preserves the selected sort, and focuses the corresponding source row without requesting a new Arr, Bazarr, or provider report.
- The shortlist clears when the item or page changes and never persists to browser storage.
- Release filtering and sorting operate only on the analysis already in page memory. They never repeat Arr, Bazarr, or provider requests, and rejected releases remain available through the Arr-decision filter.
- Analysis timing and safe Arr, Bazarr, and provider request counts stay visible beside provider quota and cache timestamps.
- Successful item views are reused in page memory. An explicit refresh re-reads Arr and Bazarr while retaining the stable provider-language cache window.
- If a transient Arr or Bazarr failure prevents refresh, the last successful in-process report remains available for a bounded period with a prominent stale warning, original generation time, expiry, and affected integration names.
- Safe per-item summaries remain only in page memory. Analyzed cards show the best Arr-accepted confidence, per-required-language coverage, provider health, Bazarr policy, accepted/total release counts, generation time, and a stale or failure label when applicable.
- Inventory refresh preserves summaries only for items still present, while authentication loss or page reload clears them. No analysis summary enters browser storage.
- The page has a skip link, labelled controls, a polite status region, keyboard focus styles, reduced-motion behavior, and a mobile layout.

The dashboard deliberately has no Grab control. Phase 1 ends at explainable decision support; mutation remains a separately confirmed Phase 2 boundary.

## Web security

The HTML uses a same-origin Content Security Policy: scripts, styles, and API connections may come only from Pegarr; images, objects, framing, and external form actions are disabled. Assets never embed configuration or private library data. Inventory rows are built with DOM text nodes rather than HTML injection.

See [read-only API access control](access-control.md) for token setup and [missing-item inventory](missing-item-inventory.md) for upstream request bounds.

`PEG-DASH-001` through `PEG-DASH-036`, `PEG-ITEM-001` through `PEG-ITEM-006`, and `PEG-DOCKER-012` through `PEG-DOCKER-022` are the deterministic evidence for this page.
