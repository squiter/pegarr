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
| PEG-SONARR-001 | Episode search is bounded, read-only, and authenticates by header | `src/adapters/sonarr.test.ts` |
| PEG-SONARR-002 | Sonarr rows preserve Arr decisions and safe evidence | `src/adapters/sonarr.test.ts` |
| PEG-SONARR-003 | Successful empty and malformed responses stay distinct | `src/adapters/sonarr.test.ts` |
| PEG-SONARR-004 | Authentication, quota, outage, and transport failures are classified | `src/adapters/sonarr.test.ts` |
| PEG-SONARR-005 | Unsafe upstream URLs and selection handles do not reach release evidence | `src/adapters/sonarr.test.ts` |

## Explicit manual gaps

| ID | Not yet proven automatically | Why |
| --- | --- | --- |
| PEG-MANUAL-001 | Live Sonarr/Radarr compatibility | Sonarr is fixture-proven only; installed versions remain unverified and Radarr has no adapter |
| PEG-MANUAL-002 | Live Bazarr policy resolution | Needs a sanitized contract capture first |
| PEG-MANUAL-003 | NAS runtime smoke test | Multi-architecture CI does not reproduce the NAS environment |
| PEG-MANUAL-004 | Future Grab confirmation | Mutations are outside Phase 0 and require explicit confirmation |

When a gap becomes automated, move it into `automatedScenarios`, add its deterministic evidence, and update this catalog in the same change.
