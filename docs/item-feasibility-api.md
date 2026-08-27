# Item feasibility API

The protected Phase 1 item route turns one row from the bounded missing inventory into an explainable, read-only release analysis:

```text
GET /api/v1/library/items/sonarr/episode/<episode-id>/feasibility
GET /api/v1/library/items/radarr/movie/<movie-id>/feasibility
Authorization: Bearer <Pegarr access token>
```

The browser sends only the application, item kind, and positive Arr item ID already returned by the inventory. Pegarr resolves the title, parent ID, episode coordinates, year, and media identifiers again from its server-side inventory window. It does not accept those private matching fields from the browser.

For a resolved item, Pegarr performs one interactive Arr release search, two Bazarr policy reads, and at most one SubDL request per unique Bazarr policy language with an explicit mapping. Successful reports share one in-flight request and a 30-second, 100-entry in-memory window. The durable provider cache remains authoritative for longer successful item/language reuse.

Every ready response includes `analysis.source`, `analysis.generatedAt`, and `analysis.expiresAt`. `computed` means Pegarr performed the Arr/Bazarr analysis for that response; `memory_cache` means it reused the bounded 30-second item report. Provider cache evidence remains separate in `report.providerStatus[].cache`, together with safe quota metadata when the provider supplies it.

An authenticated user can deliberately refresh the release and policy evidence with `?refresh=1`. This bypasses only Pegarr's item-report cache and still coalesces concurrent refreshes. It does not bypass the provider cache: a stable SubDL item/language window is reused until its provider TTL expires, so refreshing Arr releases or Bazarr policy does not spend another provider request unnecessarily.

## Bounded stale fallback

After the 30-second fresh item window, Pegarr retains the last successful report in process memory for up to six additional hours. If Sonarr, Radarr, or Bazarr cannot refresh during that interval, the API returns the previous ready report with `analysis.source: "stale_cache"`, its original generation time, `staleUntil`, a coarse `refreshFailure`, and the affected integration names. No upstream error body or private topology enters that evidence.

The stale result is never presented as current. Failed automatic retries are throttled by the same 30-second item window, while an authenticated `?refresh=1` remains an explicit retry. Expired stale entries are discarded. `disabled`, `not_found`, and genuinely unresolved policies replace old evidence rather than falling back, while subtitle-provider failures continue through the current report as `Unknown` instead of reviving an older answer.

## Honest result states

- `ready`: release candidates include separate Arr and subtitle decisions plus evidence.
- `disabled`: one or more required integrations are not configured.
- `inventory_unavailable`: the selected Arr inventory could not be read.
- `not_found`: the item is no longer in the current bounded missing inventory.
- `policy_unresolved`: Bazarr did not provide an applicable policy, so Pegarr assumed no language.
- `integration_failure`: Arr or Bazarr failed during the report; provider availability remains Unknown.

Provider rate limits, timeouts, unsupported mappings, and outages remain visible in `report.providerStatus` and language warnings. They never become `No match found`.

Each release also retains the safe Arr evidence needed for a manual decision: quality, protocol, indexer, size, age, seeders/leechers when supplied, Arr language and custom-format names, plus normalized release-group or edition traits. Download URLs, magnet links, info hashes, and upstream credentials are never copied into the report.

Only `GET` is accepted. Missing or invalid credentials are rejected before inventory, release, Bazarr, or provider work. No Grab route exists in Phase 1.

`PEG-ACCESS-004`, `PEG-ITEM-001` through `PEG-ITEM-006`, `PEG-MATCH-011`, and `PEG-DOCKER-013` through `PEG-DOCKER-015` are the deterministic evidence for this route.
