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
| PEG-RUNTIME-005 | Configured Radarr status returns measured browser-safe evidence | `src/runtime.test.ts` |
| PEG-RUNTIME-006 | Radarr failures and refreshes stay classified and bounded | `src/runtime.test.ts` |
| PEG-RUNTIME-007 | Radarr status is read-only and disabled without configuration | `src/app.test.ts` |
| PEG-PROBE-003 | The one-shot Radarr probe reports measured safe evidence | `src/probe-radarr.test.ts` |
| PEG-PROBE-004 | Radarr probe exit states stay distinct and redacted | `src/probe-radarr.test.ts` |
| PEG-DOCKER-003 | The packaged runtime reads a Radarr secret file on an internal-only network | `scripts/harness/docker-build.mjs` |

## Explicit manual gaps

| ID | Not yet proven automatically | Why |
| --- | --- | --- |
| PEG-MANUAL-001 | Live Sonarr/Radarr compatibility | Sonarr version, Docker runtime, routes, authentication enforcement, and unauthenticated latency are verified; its authenticated packaged probe and release response remain open, while Radarr release and status contracts are fixture-proven but not yet checked against the NAS |
| PEG-MANUAL-002 | Live Bazarr policy resolution | Needs a sanitized contract capture first |
| PEG-MANUAL-003 | NAS runtime smoke test | Multi-architecture CI does not reproduce the NAS environment |
| PEG-MANUAL-004 | Future Grab confirmation | Mutations are outside Phase 0 and require explicit confirmation |

When a gap becomes automated, move it into `automatedScenarios`, add its deterministic evidence, and update this catalog in the same change.
