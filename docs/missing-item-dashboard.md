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
- The page has a skip link, labelled controls, a polite status region, keyboard focus styles, reduced-motion behavior, and a mobile layout.

The dashboard does not yet open release candidates. That is the next vertical slice: selecting one inventory item, requesting its read-only feasibility report, and showing the existing video and subtitle evidence without adding Grab.

## Web security

The HTML uses a same-origin Content Security Policy: scripts, styles, and API connections may come only from Pegarr; images, objects, framing, and external form actions are disabled. Assets never embed configuration or private library data. Inventory rows are built with DOM text nodes rather than HTML injection.

See [read-only API access control](access-control.md) for token setup and [missing-item inventory](missing-item-inventory.md) for upstream request bounds.

`PEG-DASH-001` through `PEG-DASH-003` and `PEG-DOCKER-012` are the deterministic evidence for this page.
