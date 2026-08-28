# Phase 3 supporting backlog

This record preserves supporting work identified during the now-complete Phase 3 reliability and provider-expansion cycle. Entries state their own shipped or proposed status; proposed entries are not implied product behavior. Completed Phase 3 authority lives in `harness/phase-3.json` and `docs/phase-3.md`.

## Portainer example for a combined media stack

**Status:** proposed for later documentation work

Execution order and acceptance boundaries now live in the [release-candidate roadmap](release-candidate-roadmap.md).

Create a secret-safe Portainer stack example showing Pegarr deployed beside Sonarr, Radarr, Bazarr, and the supported subtitle-provider configuration. The example should reuse the existing Compose overlays, private data volume, secret-file mounts, internal service names, read-only container hardening, and explicit controlled-Grab opt-in.

This is documentation and deployment composition only. Pegarr must remain independently deployable, must not take ownership of the Arr/Bazarr containers, and must not require Portainer at runtime. The guide should cover both first deployment and a reversible update without embedding API keys, NAS paths, hostnames, or architecture assumptions.

## Quota-aware provider scheduling and cache retention

**Status:** implemented in the Phase 3 provider planner

**Priority:** active now that the second subtitle-provider adapter is available

### Why

Subtitle providers have different quotas, reset windows, latency, and reliability. Repeating equivalent searches wastes quota, while calling a tightly metered provider before a lower-cost source may spend a scarce request unnecessarily.

Pegarr already has a bounded SQLite provider cache and single-flight request sharing. It currently reuses successful item/language windows—including successful empty results—for a provider-specific window that defaults to 15 minutes. Failures, timeouts, malformed responses, and quota responses are not persisted as subtitle evidence.

### Intended behavior

1. Resolve the stable media identity, requested Bazarr policy languages, and current cached evidence before calling any provider.
2. Model provider cost and availability explicitly: quota-limited, reset time, temporarily backed off, or lower-cost according to the provider's current documented policy. Do not assume that a provider is permanently unlimited.
3. Search lower-cost healthy providers first.
4. Stop before spending a metered request only when the accumulated evidence already satisfies every required policy language at the configured confidence threshold.
5. Continue to a metered provider when coverage is missing, partial, stale, or ambiguous. A cheap weak match must not hide stronger evidence.
6. Match every returned subtitle candidate against the Arr release rows locally; sorting and comparison must never create provider requests.
7. Preserve provider provenance, observation time, quota state, and cache age so the decision remains explainable.

### Asymmetric cache policy

- Positive release-aware matches may receive a substantially longer provider-specific TTL because they are usually stable.
- Successful empty searches need a shorter TTL so newly uploaded subtitles can appear without a forced cache deletion.
- Quota and transient failures remain `Unknown`, never `No match found`. Their retry suppression belongs in bounded backoff/circuit state, not durable negative subtitle evidence.
- Authentication and malformed-response failures must not become reusable evidence.
- An explicit refresh may bypass the item-report cache but must continue to respect provider quota, backoff, and single-flight protection.
- Positive evidence is not permanent: providers can remove or correct records. Long-lived entries therefore retain an expiry and a stale label instead of becoming timeless truth.

### Harness acceptance ideas

- Cached sufficient coverage causes zero provider calls.
- A lower-cost provider satisfying all required languages prevents a metered call.
- Partial or weak lower-cost evidence still calls the next eligible provider.
- Positive, empty, and backoff windows expire independently under a deterministic clock.
- A quota response remains `Unknown` and never overwrites older positive evidence as a negative result.
- Concurrent requests share one scheduling plan and one call per provider window.
- Provider ordering never changes Arr acceptance or rejection decisions.
- Diagnostics expose only safe quota, provenance, and freshness metadata; credentials and provider download handles remain server-side.

### Decisions made

- The current sufficiency threshold is fixed at Likely for every required Bazarr-policy language on at least one Arr-accepted release. Exact Confirmed evidence also satisfies it; Possible does not.
- Candidate-bearing successes default to 24 hours and empty successes to 15 minutes. Both are independently configurable and always expire.
- Expired provider evidence is refreshed synchronously inside the already bounded item-analysis flow. The existing labeled item-level stale fallback remains separate.
- Quota failures are not persisted as subtitle evidence. Measured safe quota headers remain attached to the current result; persistent circuit state is deferred until provider behavior demonstrates that it is needed.
