# Pegarr contributor guidance

## Product boundary

Pegarr is a standalone, subtitle-aware release selector for Sonarr and Radarr. Bazarr defines subtitle policy; Sonarr and Radarr remain authoritative for video release decisions; subtitle providers supply availability evidence.

Read `ARR-SUBTITLE-RELEASE-PICKER-RESEARCH.md` before making architectural or product changes.

## Current phase

The repository is in Phase 0, the API feasibility spike. Prefer small contract probes, sanitized fixtures, and deterministic matching experiments over a broad UI or production feature set.

## Non-negotiable behavior

- Keep the default behavior read-only. A live Grab requires a separate, explicit confirmation.
- Never turn provider errors, timeouts, or quota exhaustion into "No match found".
- Never put API keys in browser storage, URLs, logs, fixtures, or committed files.
- Preserve Sonarr and Radarr rejection decisions and reasons.
- Do not hardcode PT-BR; derive language policy from Bazarr or an explicit default.
- Query a provider once per stable item/language window and match candidates locally.
- Keep original release metadata alongside normalized evidence so decisions remain explainable.
- Do not add Jellyfin, Seerr, qBittorrent, or Bazarr provider internals as core runtime dependencies.

## Verification

Run `npm run check` and build the Docker image for changes that affect runtime or deployment. Keep NAS deployment examples secret-safe and architecture-neutral (`linux/amd64` and `linux/arm64`).
