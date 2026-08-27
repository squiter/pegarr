# Item feasibility API

The protected Phase 1 item route turns one row from the bounded missing inventory into an explainable, read-only release analysis:

```text
GET /api/v1/library/items/sonarr/episode/<episode-id>/feasibility
GET /api/v1/library/items/radarr/movie/<movie-id>/feasibility
Authorization: Bearer <Pegarr access token>
```

The browser sends only the application, item kind, and positive Arr item ID already returned by the inventory. Pegarr resolves the title, parent ID, episode coordinates, year, and media identifiers again from its server-side inventory window. It does not accept those private matching fields from the browser.

For a resolved item, Pegarr performs one interactive Arr release search, two Bazarr policy reads, and at most one SubDL request per unique Bazarr policy language with an explicit mapping. Successful reports share one in-flight request and a 30-second, 100-entry in-memory window. The durable provider cache remains authoritative for longer successful item/language reuse.

## Honest result states

- `ready`: release candidates include separate Arr and subtitle decisions plus evidence.
- `disabled`: one or more required integrations are not configured.
- `inventory_unavailable`: the selected Arr inventory could not be read.
- `not_found`: the item is no longer in the current bounded missing inventory.
- `policy_unresolved`: Bazarr did not provide an applicable policy, so Pegarr assumed no language.
- `integration_failure`: Arr or Bazarr failed during the report; provider availability remains Unknown.

Provider rate limits, timeouts, unsupported mappings, and outages remain visible in `report.providerStatus` and language warnings. They never become `No match found`.

Only `GET` is accepted. Missing or invalid credentials are rejected before inventory, release, Bazarr, or provider work. No Grab route exists in Phase 1.

`PEG-ACCESS-004`, `PEG-ITEM-001` through `PEG-ITEM-004`, and `PEG-DOCKER-013` are the deterministic evidence for this route.
