# Harness scenario catalog

`harness/manifest.json` is the machine-readable source of truth. This catalog explains the coverage boundary for contributors.

## Automated scenarios

| ID | Behavior | Evidence |
| --- | --- | --- |
| PEG-OPS-001 | Liveness is healthy | `src/app.test.ts` |
| PEG-OPS-002 | Readiness reflects data-directory access | `src/app.test.ts` |
| PEG-API-001 | Read-only routes reject mutations | `src/app.test.ts` |
| PEG-API-002 | The synthetic feasibility report is read-only and explainable | `src/app.test.ts` |
| PEG-API-003 | Unknown routes do not reflect request secrets | `src/app.test.ts` |
| PEG-MATCH-001 | Release aliases normalize while original evidence remains | `src/matching.test.ts` |
| PEG-MATCH-002 | Every Arr candidate retains video and subtitle decisions | `src/matching.test.ts` |
| PEG-MATCH-003 | Provider failure becomes Unknown | `src/matching.test.ts` |
| PEG-MATCH-004 | Successful empty search becomes No match found | `src/matching.test.ts` |
| PEG-MATCH-005 | Wrong episodes are rejected before scoring | `src/matching.test.ts` |
| PEG-MATCH-006 | Forced and hearing-impaired requirements filter candidates locally | `src/matching.test.ts` |
| PEG-MATCH-007 | Missing required subtitle-type metadata remains Unknown | `src/matching.test.ts` |
| PEG-MATCH-008 | Provider results apply only to the language window actually searched | `src/matching.test.ts` |
| PEG-HARNESS-001 | Changed paths select the intended sensors | `scripts/harness/run-checks.test.mjs` |
| PEG-HARNESS-002 | Noisy failures become compact signals | `scripts/harness/run-checks.test.mjs` |
| PEG-HARNESS-003 | Docker frontend timeouts use one bounded fallback | `scripts/harness/run-checks.test.mjs` |
| PEG-DOCKER-001 | The built image starts hardened and serves core routes without egress | `scripts/harness/docker-build.mjs` |
| PEG-DOCKER-002 | The packaged runtime reads a Sonarr secret file on an internal-only network | `scripts/harness/docker-build.mjs` |
| PEG-SONARR-001 | Episode search is bounded, read-only, and authenticates by header | `src/adapters/sonarr.test.ts` |
| PEG-SONARR-002 | Sonarr rows preserve Arr decisions and safe evidence | `src/adapters/sonarr.test.ts` |
| PEG-SONARR-003 | Successful empty and malformed responses stay distinct | `src/adapters/sonarr.test.ts` |
| PEG-SONARR-004 | Authentication, quota, outage, and transport failures are classified | `src/adapters/sonarr.test.ts` |
| PEG-SONARR-005 | Unsafe upstream URLs and selection handles do not reach release evidence | `src/adapters/sonarr.test.ts` |
| PEG-HTTP-001 | Requests remain on an explicit allowlisted base URL | `src/adapters/fetch-json-transport.test.ts` |
| PEG-HTTP-002 | Timeouts and network failures are stable and redacted | `src/adapters/fetch-json-transport.test.ts` |
| PEG-HTTP-003 | Declared and streamed oversized bodies are blocked | `src/adapters/fetch-json-transport.test.ts` |
| PEG-HTTP-004 | Invalid success JSON stays distinct from safe error metadata | `src/adapters/fetch-json-transport.test.ts` |
| PEG-HTTP-005 | Bazarr array query keys are encoded without widening the URL boundary | `src/adapters/fetch-json-transport.test.ts` |
| PEG-CONFIG-001 | Disabled Sonarr configuration stays disabled and partial input fails safely | `src/config.test.ts` |
| PEG-CONFIG-002 | Sonarr credentials load only from a bounded secret file | `src/config.test.ts` |
| PEG-SONARR-006 | System status is bounded and private upstream metadata is discarded | `src/adapters/sonarr.test.ts` |
| PEG-RUNTIME-001 | Configured Sonarr status returns only safe read-only evidence | `src/runtime.test.ts` |
| PEG-RUNTIME-002 | Sonarr status is read-only and disabled without configuration | `src/app.test.ts` |
| PEG-RUNTIME-003 | Upstream failures remain distinct and redact private details | `src/runtime.test.ts` |
| PEG-RUNTIME-004 | Concurrent and repeated status reads use one bounded probe window | `src/runtime.test.ts` |
| PEG-PROBE-001 | The one-shot Sonarr probe reports measured safe evidence | `src/probe-sonarr.test.ts` |
| PEG-PROBE-002 | Probe exit states remain distinct and configuration failures stay redacted | `src/probe-sonarr.test.ts` |
| PEG-RADARR-001 | Movie search is bounded, read-only, and authenticates by header | `src/adapters/radarr.test.ts` |
| PEG-RADARR-002 | Radarr rows preserve Arr decisions, editions, and safe evidence | `src/adapters/radarr.test.ts` |
| PEG-RADARR-003 | Successful empty and malformed Radarr responses stay distinct | `src/adapters/radarr.test.ts` |
| PEG-RADARR-004 | Radarr authentication, quota, outage, and transport failures are classified | `src/adapters/radarr.test.ts` |
| PEG-RADARR-005 | Radarr selection secrets never enter release evidence | `src/adapters/radarr.test.ts` |
| PEG-RADARR-006 | Radarr system status is bounded and private metadata is discarded | `src/adapters/radarr.test.ts` |
| PEG-CONFIG-003 | Radarr credentials use an independent bounded secret file | `src/config.test.ts` |
| PEG-CONFIG-004 | Bazarr credentials use an independent bounded secret file | `src/config.test.ts` |
| PEG-CONFIG-005 | SubDL credentials use an independent bounded secret file | `src/config.test.ts` |
| PEG-RUNTIME-005 | Configured Radarr status returns measured browser-safe evidence | `src/runtime.test.ts` |
| PEG-RUNTIME-006 | Radarr failures and refreshes stay classified and bounded | `src/runtime.test.ts` |
| PEG-RUNTIME-007 | Radarr status is read-only and disabled without configuration | `src/app.test.ts` |
| PEG-PROBE-003 | The one-shot Radarr probe reports measured safe evidence | `src/probe-radarr.test.ts` |
| PEG-PROBE-004 | Radarr probe exit states stay distinct and redacted | `src/probe-radarr.test.ts` |
| PEG-DOCKER-003 | The packaged runtime reads a Radarr secret file on an internal-only network | `scripts/harness/docker-build.mjs` |
| PEG-DOCKER-004 | The packaged Bazarr profile probe uses a secret file on an internal-only network | `scripts/harness/docker-build.mjs` |
| PEG-DOCKER-005 | The packaged SubDL probe makes one redacted search on an internal-only network | `scripts/harness/docker-build.mjs` |
| PEG-DOCKER-006 | The packaged episode report composes three integrations on an internal-only network | `scripts/harness/docker-build.mjs` |
| PEG-DOCKER-007 | The packaged movie report composes three integrations on an internal-only network | `scripts/harness/docker-build.mjs` |
| PEG-DOCKER-008 | The packaged missing inventory reads both Arr services on an internal-only network | `scripts/harness/docker-build.mjs` |
| PEG-DOCKER-009 | The packaged season report preserves full-season coverage on an internal-only network | `scripts/harness/docker-build.mjs` |
| PEG-DOCKER-010 | Packaged reports reuse provider windows from a persistent data volume | `scripts/harness/docker-build.mjs` |
| PEG-BAZARR-001 | Policy reads are bounded GETs authenticated only by header | `src/adapters/bazarr.test.ts` |
| PEG-BAZARR-002 | Profiles retain original multilingual and conditional semantics | `src/adapters/bazarr.test.ts` |
| PEG-BAZARR-003 | Targeted assignments discard private library metadata | `src/adapters/bazarr.test.ts` |
| PEG-BAZARR-004 | Missing and unassigned policies remain explicitly unresolved | `src/adapters/bazarr.test.ts` |
| PEG-BAZARR-005 | Failures are classified and malformed responses stay distinct | `src/adapters/bazarr.test.ts` |
| PEG-SUBDL-001 | Exact searches are bounded GETs with header-only authentication | `src/adapters/subdl.test.ts` |
| PEG-SUBDL-002 | Release evidence remains local-matchable while download handles are discarded | `src/adapters/subdl.test.ts` |
| PEG-SUBDL-003 | Successful empty and malformed searches remain distinct | `src/adapters/subdl.test.ts` |
| PEG-SUBDL-004 | Quota, timeout, outage, auth, and malformed data stay classified | `src/adapters/subdl.test.ts` |
| PEG-SUBDL-005 | One stable item-language window uses one request until expiry | `src/adapters/subdl.test.ts` |
| PEG-PROBE-005 | The one-shot Bazarr profile probe reports only measured counts | `src/probe-bazarr.test.ts` |
| PEG-PROBE-006 | Bazarr probe exit states stay distinct and redacted | `src/probe-bazarr.test.ts` |
| PEG-PROBE-007 | The one-shot SubDL search reports only bounded aggregate evidence | `src/probe-subdl.test.ts` |
| PEG-PROBE-008 | SubDL probe states stay distinct and invalid input remains redacted | `src/probe-subdl.test.ts` |
| PEG-FLOW-001 | Resolved Bazarr policy drives one SubDL search per language and one report | `src/episode-feasibility.test.ts` |
| PEG-FLOW-002 | Missing provider language mappings stay scoped without extra requests | `src/episode-feasibility.test.ts` |
| PEG-FLOW-003 | Unresolved Bazarr assignment stops provider work without assumed policy | `src/episode-feasibility.test.ts` |
| PEG-FLOW-004 | Provider failure stops further searches and keeps every language Unknown | `src/episode-feasibility.test.ts` |
| PEG-REPORT-001 | Packaged episode report composes all three read-only integrations | `src/report-sonarr-episode.test.ts` |
| PEG-REPORT-002 | Invalid report configuration fails before network access | `src/report-sonarr-episode.test.ts` |
| PEG-MOVIEFLOW-001 | Radarr releases and Bazarr movie policy produce one report | `src/movie-feasibility.test.ts` |
| PEG-MOVIEFLOW-002 | Unassigned Bazarr movie stops provider work without assumed policy | `src/movie-feasibility.test.ts` |
| PEG-MOVIEFLOW-003 | Radarr failures remain classified and stop provider work | `src/movie-feasibility.test.ts` |
| PEG-MOVIEREPORT-001 | Packaged movie report composes all three read-only integrations | `src/report-radarr-movie.test.ts` |
| PEG-MOVIEREPORT-002 | Invalid movie report configuration fails before network access | `src/report-radarr-movie.test.ts` |
| PEG-SONARR-007 | Missing episodes are bounded, monitored, and mapped into safe item evidence | `src/adapters/sonarr.test.ts` |
| PEG-SONARR-008 | Malformed missing episodes stay distinct and private metadata is discarded | `src/adapters/sonarr.test.ts` |
| PEG-RADARR-007 | Missing movies are bounded, monitored, and mapped into safe item evidence | `src/adapters/radarr.test.ts` |
| PEG-RADARR-008 | Malformed missing movies stay distinct and private metadata is discarded | `src/adapters/radarr.test.ts` |
| PEG-INVENTORY-001 | Packaged inventory reads one bounded page from each configured Arr | `src/inventory-missing.test.ts` |
| PEG-INVENTORY-002 | One unavailable Arr produces usable partial inventory | `src/inventory-missing.test.ts` |
| PEG-INVENTORY-003 | Disabled and invalid inventory configuration fails before network access | `src/inventory-missing.test.ts` |
| PEG-SONARR-009 | Season search preserves full-season and episode coverage evidence | `src/adapters/sonarr.test.ts` |
| PEG-SUBDL-006 | Season searches omit episode and retain explicit pack coverage | `src/adapters/subdl.test.ts` |
| PEG-MATCH-009 | Full-season subtitle packs cover episodes with explicit evidence | `src/matching.test.ts` |
| PEG-MATCH-010 | Season matching requires explicit full-season coverage | `src/matching.test.ts` |
| PEG-SEASONFLOW-001 | Season releases and full-season subtitle evidence produce one report | `src/season-feasibility.test.ts` |
| PEG-SEASONFLOW-002 | Unresolved series policy stops season provider work | `src/season-feasibility.test.ts` |
| PEG-SEASONFLOW-003 | Sonarr season failure remains classified and stops provider work | `src/season-feasibility.test.ts` |
| PEG-SEASONREPORT-001 | Packaged season report composes all three read-only integrations | `src/report-sonarr-season.test.ts` |
| PEG-SEASONREPORT-002 | Incomplete season report configuration fails before network access | `src/report-sonarr-season.test.ts` |
| PEG-CACHE-001 | Successful provider results survive cache reopen | `src/provider-search-cache.test.ts` |
| PEG-CACHE-002 | Expired and failed provider searches are not reused | `src/provider-search-cache.test.ts` |
| PEG-CACHE-003 | Concurrent identical misses share one provider request | `src/provider-search-cache.test.ts` |
| PEG-CACHE-004 | Cache keys omit titles and raw media identifiers | `src/provider-search-cache.test.ts` |
| PEG-CACHE-005 | Packaged reports reuse cached provider windows after reopen | `src/report-sonarr-season.test.ts` |
| PEG-CACHE-006 | Unsafe packaged cache configuration fails before network access | `src/report-sonarr-season.test.ts` |
| PEG-CACHE-007 | The cache prunes the oldest windows at its configured bound | `src/provider-search-cache.test.ts` |
| PEG-CACHE-008 | Corrupt cache rows are discarded and fetched again | `src/provider-search-cache.test.ts` |
| PEG-ACCESS-001 | Bearer authentication uses one bounded in-memory token | `src/access-control.test.ts` |
| PEG-CONFIG-006 | Browser API access uses only a bounded secret file | `src/config.test.ts` |
| PEG-ACCESS-002 | Hidden and unauthorized inventory requests perform no upstream work | `src/app.test.ts` |
| PEG-ACCESS-003 | Authorized inventory is read-only and rejects mutation methods | `src/app.test.ts` |
| PEG-INVENTORY-004 | Runtime inventory reads share one bounded cache window | `src/runtime.test.ts` |
| PEG-DOCKER-011 | Packaged authentication blocks unauthorized upstream work | `scripts/harness/docker-build.mjs` |
| PEG-DASH-001 | Inventory view-model mapping preserves display-safe fields | `src/dashboard-model.test.ts` |
| PEG-DASH-002 | Dashboard search, filtering, and sorting stay local | `src/dashboard-model.test.ts` |
| PEG-DASH-003 | Dashboard routes are accessible, responsive, and secret-safe | `src/app.test.ts` |
| PEG-DOCKER-012 | Packaged dashboard assets and controls cause no upstream requests | `scripts/harness/docker-build.mjs` |
| PEG-CONFIG-007 | Runtime provider language mappings are explicit and canonical | `src/config.test.ts` |
| PEG-ACCESS-004 | Item feasibility authenticates before work and rejects mutations | `src/app.test.ts` |
| PEG-ITEM-001 | Item reports derive identity from server-owned inventory | `src/item-feasibility.test.ts` |
| PEG-ITEM-002 | Disabled, unavailable, and missing item states remain distinct | `src/item-feasibility.test.ts` |
| PEG-ITEM-003 | Repeated selections share one bounded report window | `src/item-feasibility.test.ts` |
| PEG-ITEM-004 | Runtime selection composes Arr, Bazarr, and one provider window | `src/runtime.test.ts` |
| PEG-DASH-004 | Release view preserves Arr decisions and honest evidence | `src/dashboard-model.test.ts` |
| PEG-DOCKER-013 | Packaged item analysis is authenticated, cached, and read-only | `scripts/harness/docker-build.mjs` |
| PEG-ITEM-005 | Explicit refresh bypasses only the bounded item cache | `src/item-feasibility.test.ts` |
| PEG-DASH-005 | Analysis diagnostics preserve safe request, quota, and cache evidence | `src/dashboard-model.test.ts` |
| PEG-DOCKER-014 | Packaged refresh reuses the provider window | `scripts/harness/docker-build.mjs` |
| PEG-ITEM-006 | Transient integration failures use a bounded labeled stale report | `src/item-feasibility.test.ts` |
| PEG-DASH-006 | Stale analysis stays visibly distinct from fresh evidence | `src/dashboard-model.test.ts` |
| PEG-DOCKER-015 | Packaged integration outage retains labeled stale evidence | `scripts/harness/docker-build.mjs` |
| PEG-DASH-007 | Release filtering and sorting stay local while preserving Arr decisions | `src/dashboard-model.test.ts` |
| PEG-DOCKER-016 | Packaged release controls make no additional upstream requests | `scripts/harness/docker-build.mjs` |
| PEG-DASH-008 | Item summaries use the best Arr-accepted confidence and retain freshness | `src/dashboard-model.test.ts` |
| PEG-DASH-009 | Analyzed-item filtering and ordering are deterministic page-memory operations | `src/dashboard-model.test.ts` |
| PEG-DASH-010 | Analyzed-item cards and controls remain page-memory-only assets | `src/app.test.ts` |
| PEG-DOCKER-017 | Packaged item summaries and dashboard analysis controls cause no upstream requests | `scripts/harness/docker-build.mjs` |
| PEG-DASH-011 | Required-language coverage uses only Arr-accepted releases and preserves Unknown | `src/dashboard-model.test.ts` |
| PEG-DASH-012 | Provider-evidence health distinguishes available, partial, unavailable, and unknown | `src/dashboard-model.test.ts` |
| PEG-DASH-013 | Required-language and provider-health controls remain page-memory-only assets | `src/app.test.ts` |
| PEG-DOCKER-018 | Packaged required-language and provider-health controls cause no upstream requests | `scripts/harness/docker-build.mjs` |

## Explicit manual gaps

| ID | Not yet proven automatically | Why |
| --- | --- | --- |
| PEG-MANUAL-001 | Live Sonarr/Radarr compatibility | Local Colima verified the authenticated Sonarr 4.0.16.2944 packaged status probe and a 100-row episode release search on 2026-08-26; Radarr remains fixture-proven only, and NAS production validation is intentionally separate |
| PEG-MANUAL-002 | Live Bazarr policy resolution | Local Colima verified authenticated profile-list and targeted series-assignment shapes on 2026-08-26 without retaining policy contents; installed NAS compatibility remains intentionally untested |
| PEG-MANUAL-003 | NAS runtime smoke test | Multi-architecture CI does not reproduce the NAS environment |
| PEG-MANUAL-004 | Future Grab confirmation | Mutations are outside the read-only MVP and require explicit confirmation |
| PEG-MANUAL-005 | Live SubDL v2 compatibility | The live authentication boundary is proven; an authenticated sanitized response and Bazarr-to-SubDL language mapping remain unverified |

When a gap becomes automated, move it into `automatedScenarios`, add its deterministic evidence, and update this catalog in the same change.
