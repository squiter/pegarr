# Changelog

All notable changes to Pegarr are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/squiter/pegarr/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/squiter/pegarr/releases/tag/v0.1.0
