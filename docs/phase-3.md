# Phase 3 completion: reliability and more providers

Phase 3 implementation is complete. Its completion authority is `harness/phase-3.json`; Phase 1 and Phase 2 remain immutable completed baselines.

The first slices establish instance-safe identity and bounded multiple-instance runtime support. Secret-reference configuration files can define up to 16 Sonarr and 16 Radarr connections; inventory and authenticated status fan out over them, item analysis selects the exact client, and controlled Grab mutates only the confirmed instance. Inventory rows, dashboard routes, duplicate protection, status results, and audit history preserve that explicit Arr instance ID. Existing single-instance variables and API routes remain compatible, but unscoped item routes fail closed when an item ID is ambiguous across instances.

## Current criteria

- `P3-MULTI-ARR` is complete. Instance-scoped identity, configuration, client registries, inventory and status fan-out, analysis, controlled Grab, and Compose overlays have deterministic evidence. Installed Sonarr and Radarr read/add compatibility is live-proven; the remaining NAS checks stay explicit under `PEG-MANUAL-003` and do not weaken the completed code contract.
- `P3-OPENSUBTITLES` is complete at the provider-adapter boundary. Exact movie and episode searches use the official REST search route, API key and required application identity stay in headers, responses are bounded, download handles are discarded, and failures remain distinct from a successful empty result. Runtime provider scheduling is intentionally owned by `P3-PROVIDER-QUOTA`; live credential and language compatibility remains `PEG-MANUAL-006`.
- `P3-PROVIDER-QUOTA` is complete. Provider windows are namespaced, single-flight, and successful-only; positive and empty evidence have independently bounded lifetimes; fallback calls stop only after an Arr-accepted release reaches Likely or Confirmed coverage for every required language; quota failures remain Unknown; and the dashboard preserves measured reset or rate-window evidence.
- `P3-SEASON-PACKS` is complete. SubDL season searches preserve explicit full-season, individual-episode, and bounded multi-episode evidence; only an explicit full-season candidate can satisfy a season release. Mixed pack and episode fixtures prove that stronger coverage wins without inflating partial evidence. OpenSubtitles remains honestly outside the season-pack path because its current adapter supports exact movie and episode searches only.
- `P3-SUBTITLE-PREFERENCES` is complete because forced and hearing-impaired semantics already have deterministic evidence.
- `P3-RELEASE-PARSING` is complete. Multi-episode, season-word, anime absolute-number, checksum, multilingual, edition, and frame-rate syntax have deterministic fixtures. Conflicts cannot become Confirmed, and provider disagreement selects the strongest local evidence without extra provider calls.

No Phase 3 work changes the default read-only mode. Controlled Grab remains separately enabled, administrator-authenticated, exact-confirmation-bound, audit-first, idempotent, and never exercised automatically against a live service.

The combined Portainer media-stack example remains tracked as later deployment documentation in `docs/phase-3-backlog.md`. It does not make Portainer, Sonarr, Radarr, or Bazarr runtime dependencies of Pegarr. Optional Phase 4 workflow adapters have not started and remain evidence-driven rather than implied by Phase 3 completion.
