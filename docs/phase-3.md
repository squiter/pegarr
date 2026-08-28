# Phase 3: reliability and more providers

Phase 3 is in progress. Its completion authority is `harness/phase-3.json`; Phase 1 and Phase 2 remain immutable completed baselines.

The first slices establish instance-safe identity and bounded multiple-instance runtime support. Secret-reference configuration files can define up to 16 Sonarr and 16 Radarr connections; inventory fans out over them, item analysis selects the exact client, and controlled Grab mutates only the confirmed instance. Inventory rows, dashboard routes, duplicate protection, and audit history preserve that explicit Arr instance ID. Existing single-instance variables and API routes remain compatible, but unscoped item routes fail closed when an item ID is ambiguous across instances.

## Current criteria

- `P3-MULTI-ARR` is in progress. Instance-scoped identity, configuration, client registries, inventory fan-out, analysis, controlled Grab, and Compose overlays are implemented. Per-instance status presentation and live compatibility remain.
- `P3-OPENSUBTITLES` is pending.
- `P3-PROVIDER-QUOTA` is pending. The design backlog includes quota-aware ordering and asymmetric cache windows.
- `P3-SEASON-PACKS` is pending.
- `P3-SUBTITLE-PREFERENCES` is complete because forced and hearing-impaired semantics already have deterministic evidence.
- `P3-RELEASE-PARSING` is pending.

No Phase 3 work changes the default read-only mode. Controlled Grab remains separately enabled, administrator-authenticated, exact-confirmation-bound, audit-first, idempotent, and never exercised automatically against a live service.

The combined Portainer media-stack example is tracked as later deployment documentation in `docs/phase-3-backlog.md`. It does not make Portainer, Sonarr, Radarr, or Bazarr runtime dependencies of Pegarr.
