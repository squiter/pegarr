# Phase 3: reliability and more providers

Phase 3 is in progress. Its completion authority is `harness/phase-3.json`; Phase 1 and Phase 2 remain immutable completed baselines.

The first slices establish instance-safe identity and bounded multiple-instance runtime support. Secret-reference configuration files can define up to 16 Sonarr and 16 Radarr connections; inventory and authenticated status fan out over them, item analysis selects the exact client, and controlled Grab mutates only the confirmed instance. Inventory rows, dashboard routes, duplicate protection, status results, and audit history preserve that explicit Arr instance ID. Existing single-instance variables and API routes remain compatible, but unscoped item routes fail closed when an item ID is ambiguous across instances.

## Current criteria

- `P3-MULTI-ARR` is complete. Instance-scoped identity, configuration, client registries, inventory and status fan-out, analysis, controlled Grab, and Compose overlays have deterministic evidence. Live service and NAS compatibility remain explicitly manual under `PEG-MANUAL-001` and `PEG-MANUAL-003`; they do not weaken the completed code contract.
- `P3-OPENSUBTITLES` is complete at the provider-adapter boundary. Exact movie and episode searches use the official REST search route, API key and required application identity stay in headers, responses are bounded, download handles are discarded, and failures remain distinct from a successful empty result. Runtime provider scheduling is intentionally owned by `P3-PROVIDER-QUOTA`; live credential and language compatibility remains `PEG-MANUAL-006`.
- `P3-PROVIDER-QUOTA` is in progress. The OpenSubtitles adapter now preserves measured per-second limit evidence, and the next slice owns quota-aware ordering plus asymmetric cache windows.
- `P3-SEASON-PACKS` is pending.
- `P3-SUBTITLE-PREFERENCES` is complete because forced and hearing-impaired semantics already have deterministic evidence.
- `P3-RELEASE-PARSING` is pending.

No Phase 3 work changes the default read-only mode. Controlled Grab remains separately enabled, administrator-authenticated, exact-confirmation-bound, audit-first, idempotent, and never exercised automatically against a live service.

The combined Portainer media-stack example is tracked as later deployment documentation in `docs/phase-3-backlog.md`. It does not make Portainer, Sonarr, Radarr, or Bazarr runtime dependencies of Pegarr.
