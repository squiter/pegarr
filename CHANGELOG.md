# Changelog

All notable changes to Pegarr are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.3] - 2026-09-01

### Fixed

- Active username/password sessions now renew a bounded 30-day inactivity window when Pegarr restores the authenticated app, avoiding repeated daily sign-ins while preserving server-side expiry, private hashed storage, CSRF rotation, and durable logout.

### Acceptance

- The installed Bazarr listed a file-backed Radarr movie with the `PT-BR + English` profile and exposed the same assignment in its edit view, completing the live movie side of the Bazarr policy boundary.
- OpenSubtitles successful-response, rate-header, language-mapping, and cache-reuse evidence remains an explicit manual gap; provider failure is still kept distinct from no subtitle matches.

## [0.1.2] - 2026-09-01

### Fixed

- Refreshing an exact post-add catalog continuation now stays on that continuation and preserves the explicit Pegarr subtitle policy instead of falling through to Bazarr's file-backed library view.

### Acceptance

- Installed Radarr accepted a monitored movie add with automatic search disabled, returned 11 exact release candidates, and showed no title-scoped queue or history activity.
- Bazarr's installed Radarr sync processed the new title but correctly excluded it from its library because no video file exists; Pegarr therefore continues using the explicit pre-download policy.

## [0.1.1] - 2026-09-01

### Changed

- Exact analysis now displays Bazarr language aliases as canonical BCP 47-style labels, including `pb` as `pt-BR`, without changing the original matching identity.

## [0.1.0] - 2026-09-01

### Added

- Username/password sessions and a collapsible first-run setup experience.
- Restart-safe username/password sessions backed by private hashed state in the persistent data volume.
- Sonarr and Radarr catalog discovery for titles that are not yet in the library.
- Explicit subtitle policy plus private server-side SubDL and OpenSubtitles settings.
- Honest title-level subtitle availability that keeps provider failures distinct from no matches.
- Single-button catalog add with automatic release search forced off, followed by exact movie, season, or episode analysis in Pegarr.
- Read-only release comparison that preserves Arr decisions and explains subtitle confidence.
- Independently enabled, administrator-confirmed controlled Grab with revalidation, audit history, idempotency, and Unknown-outcome reconciliation.
- Hardened non-root AMD64 and ARM64 container images, secret-safe Compose overlays, and a Portainer deployment runbook.
- A public build-info endpoint at `/api/v1/version` for release and support traceability.

### Safety and known boundaries

- Read-only remains the default. Catalog add and controlled Grab are separate opt-ins; Pegarr never automatically chooses or downloads a release.
- Provider errors, timeouts, and quota exhaustion remain `Unknown`, never `No match found`.
- OpenSubtitles supports exact movie and episode searches but not season packs.
- Specials season `0` remains unsupported until provider season identity is validated.
- Synthetic coverage does not prove installed-service compatibility. A successful OpenSubtitles response, installed Radarr exact analysis and catalog add, installed Bazarr movie assignment, and an operator-owned harmless controlled Grab remain explicit manual acceptance boundaries.

[Unreleased]: https://github.com/squiter/pegarr/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/squiter/pegarr/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/squiter/pegarr/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/squiter/pegarr/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/squiter/pegarr/releases/tag/v0.1.0
