# Pegarr contributor guidance

## Product boundary

Pegarr is a standalone, subtitle-aware release selector for Sonarr and Radarr. Bazarr defines subtitle policy; Sonarr and Radarr remain authoritative for video release decisions; subtitle providers supply availability evidence.

Read `ARR-SUBTITLE-RELEASE-PICKER-RESEARCH.md` before making architectural or product changes.

## Current phase

The Phase 1 read-only MVP, Phase 2 controlled Grab, and Phase 3 reliability/provider expansion are complete and ratcheted by their ledgers under `harness/`. Phase 4 optional workflow adapters have not started. Keep the default read-only, live routes authenticated, caches bounded, logs redacted, and behavior deterministic. Never execute an automated Grab against a live service.

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

`harness/manifest.json` is the machine-readable coverage ledger. Every behavior change must add or update a stable scenario there and reference its ID in the deterministic test that proves it. Record live-service and NAS-only validation as manual gaps instead of implying automated coverage.

Use `npm run check:affected` as the local completion gate. It always runs repository contracts and selects compiled checks and the Docker build from the changed paths. Use `npm run check` for the full local gate and `npm run check:fast` only for quick feedback while work is still in progress.

Harness failures write compact remediation guidance to the terminal and full evidence under `.artifacts/harness/`. Fix recurring failures by improving the relevant guide, fixture, tool, or sensor rather than adding prompt-only instructions.

Keep NAS deployment examples secret-safe and architecture-neutral (`linux/amd64` and `linux/arm64`).
