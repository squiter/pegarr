# Missing-item dashboard

Pegarr's first user-facing read-only MVP page is served at `/`. It shows monitored missing episodes from Sonarr and missing movies from Radarr after the user enters the separately configured Pegarr access token.

The page deliberately does not contain or receive Sonarr, Radarr, Bazarr, or subtitle-provider credentials. The Pegarr token is held only in the JavaScript module's memory, removed from the input immediately, and cleared by reload or tab closure. It is sent only in the `Authorization` header with cookies omitted. It is never placed in a URL, browser storage, HTML, diagnostics, or the inventory view model.

## Current behavior

- An explicit connect panel explains the memory-only token boundary.
- Missing episodes and movies are shown with application, title, episode or year context, and availability date.
- Search matches title, series context, and application.
- Type filtering switches between all items, episodes, and movies.
- Sorting supports newest availability, oldest availability, title, and type.
- Filtering and sorting operate on already loaded rows and do not call Pegarr or the Arr services.
- Refresh is explicit. Pegarr's server-side 30-second cache prevents repeated refreshes from repeatedly calling the Arr services.
- Partial inventory identifies the unavailable integration without hiding usable results.
- Selecting an item opens its interactive release table and requests one protected read-only feasibility report.
- Video acceptance and Arr rejection reasons remain separate from subtitle confidence.
- Each release exposes per-language confidence, provider state, matching evidence, and warnings.
- Successful item views are reused in page memory; an explicit refresh uses Pegarr's bounded server cache.
- The page has a skip link, labelled controls, a polite status region, keyboard focus styles, reduced-motion behavior, and a mobile layout.

The dashboard deliberately has no Grab control. Phase 1 ends at explainable decision support; mutation remains a separately confirmed Phase 2 boundary.

## Web security

The HTML uses a same-origin Content Security Policy: scripts, styles, and API connections may come only from Pegarr; images, objects, framing, and external form actions are disabled. Assets never embed configuration or private library data. Inventory rows are built with DOM text nodes rather than HTML injection.

See [read-only API access control](access-control.md) for token setup and [missing-item inventory](missing-item-inventory.md) for upstream request bounds.

`PEG-DASH-001` through `PEG-DASH-004`, `PEG-ITEM-001` through `PEG-ITEM-004`, `PEG-DOCKER-012`, and `PEG-DOCKER-013` are the deterministic evidence for this page.
