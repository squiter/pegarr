# Missing-item dashboard

Pegarr's first user-facing read-only MVP page is served at `/`. It shows monitored missing episodes from Sonarr and missing movies from Radarr after the user enters the separately configured Pegarr access token.

The page deliberately does not contain or receive Sonarr, Radarr, Bazarr, or subtitle-provider credentials. The Pegarr token is held only in the JavaScript module's memory, removed from the input immediately, and cleared by reload or tab closure. It is sent only in the `Authorization` header with cookies omitted. It is never placed in a URL, browser storage, HTML, diagnostics, or the inventory view model.

## Current behavior

- An explicit connect panel explains the memory-only token boundary.
- Missing episodes and movies are shown with application, title, episode or year context, and availability date.
- Search matches title, series context, and application.
- After an item is analyzed, search also matches its Bazarr profile name and language codes.
- Type filtering switches between all items, episodes, and movies. Analysis filters distinguish not analyzed, analyzed or attempted, needs-attention, and stale items; best-confidence filtering uses only completed reports and Arr-accepted releases.
- Required-language coverage is summarized independently for every language Bazarr marks required, using only Arr-accepted releases. A rejected release cannot satisfy coverage, missing or failed evidence remains Unknown, and a successful empty search remains No match found.
- Provider-evidence health distinguishes fully available, partial, unavailable, and unknown searches. It stays separate from match confidence, so a timeout or quota failure cannot be presented as subtitle absence.
- Sorting supports availability, title, type, best Arr-accepted subtitle confidence, and most recent analysis.
- Filtering and sorting operate on already loaded rows and do not call Pegarr or the Arr services.
- Refresh is explicit. Pegarr's server-side 30-second cache prevents repeated refreshes from repeatedly calling the Arr services.
- Partial inventory identifies the unavailable integration without hiding usable results.
- Selecting an item opens its interactive release table and requests one protected read-only feasibility report.
- Video acceptance and Arr rejection reasons remain separate from subtitle confidence.
- Each release exposes per-language confidence, contributing provider count, provider state, matching evidence, and warnings.
- Release controls filter by Arr decision or subtitle confidence and sort by the combined decision order, subtitle confidence, custom-format score, or title.
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

`PEG-DASH-001` through `PEG-DASH-013`, `PEG-ITEM-001` through `PEG-ITEM-006`, and `PEG-DOCKER-012` through `PEG-DOCKER-018` are the deterministic evidence for this page.
