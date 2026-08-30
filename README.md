# Pegarr

**Subtitle-aware release selection for Sonarr and Radarr.**

[![CI](https://github.com/squiter/pegarr/actions/workflows/ci.yml/badge.svg)](https://github.com/squiter/pegarr/actions/workflows/ci.yml)
[![Container](https://github.com/squiter/pegarr/actions/workflows/container.yml/badge.svg)](https://github.com/squiter/pegarr/actions/workflows/container.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Pegarr is a self-hosted companion for Sonarr, Radarr, and Bazarr. Its primary workflow is discovering a series or movie before it is added, previewing whether the desired subtitles exist, adding the selected title to Sonarr or Radarr, and choosing an exact subtitle-aware release without leaving Pegarr.

> [!IMPORTANT]
> Pegarr's Phase 1 read-only MVP, Phase 2 controlled Grab, and Phase 3 reliability/provider expansion are complete, while read-only remains the default. Controlled Grab stays behind a separate opt-in setting and administrator secret, revalidates twice, requires exact confirmation, audits every attempt, and never runs automatically. Live Grab compatibility remains a manual test boundary.

## Why Pegarr?

Sonarr and Radarr make strong catalog and video-release decisions. Bazarr manages subtitles after a file is imported. Pegarr targets the gap between them: helping a person understand subtitle availability before adding a title and before choosing a release.

Pegarr will keep these decisions separate and visible:

- whether Sonarr or Radarr accepts the video release;
- whether a matching subtitle is Confirmed, Likely, Possible, not found, or Unknown;
- why that subtitle confidence was assigned;
- whether a provider failed or exhausted its quota.

Provider failures are never treated as proof that subtitles do not exist.

## Project status

The API-feasibility milestone, implementation Phases 1 through 3, and the discovery-first P0 workflow are complete locally. Pegarr now supports username/password sessions, catalog search for unadded titles, UI-managed subtitle policy and provider settings, pre-add coverage, explicit add with automatic search disabled, exact release continuation, and administrator-confirmed controlled Grab. The active work is the [release-candidate roadmap](docs/release-candidate-roadmap.md): installed-service acceptance, a rollback-safe Portainer/NAS deployment, and the first immutable public release.

The current repository foundation includes:

- a dependency-light TypeScript service;
- `/health` and `/health/ready` endpoints;
- a deterministic `/api/v1/feasibility/demo` report backed by sanitized synthetic evidence;
- provider-independent normalization and explainable confidence results;
- a bounded, transport-injected Sonarr v3 episode release-search adapter proven with a sanitized contract fixture;
- a bounded, transport-injected Radarr v3 movie release-search adapter that retains edition evidence;
- a bounded, read-only Bazarr v1 language-profile adapter that preserves cutoff, subtitle type, audio conditions, and release filters beside normalized policy;
- a bounded SubDL v2 exact-search adapter with header-only authentication, explicit provider language codes, and local release matching;
- a durable SQLite provider-result cache that reuses only successful item/language windows, never failures or quota responses;
- a secret-file bearer boundary for live library APIs, with constant-time comparison and no browser storage;
- an authenticated `/api/v1/library/missing` route with 30-second single-flight caching and no mutation methods;
- a responsive missing-item dashboard with memory-only authentication and local search, filtering, and sorting;
- a discovery-first catalog search for series and movies not yet added to Sonarr or Radarr;
- a username/password sign-in foundation with legacy bearer-token compatibility;
- an atomic server-side default subtitle policy with per-language required, forced, and hearing-impaired controls in the dashboard;
- private server-side SubDL/OpenSubtitles credential and language-mapping setup from the dashboard, immediately usable by title-level pre-add coverage without returning stored keys;
- authenticated episode and movie selection routes that derive private matching identity from server-owned inventory;
- an interactive release table that preserves Arr decisions while explaining per-language subtitle confidence and provider state;
- local release filtering and sorting that reuse the in-memory analysis without new upstream requests;
- release rows with safe Arr size, age, peer, language, custom-format, group, and edition evidence;
- page-memory release search, protocol filtering, metadata sorting, and a three-candidate side-by-side comparison of Arr decisions, policy-language evidence, and release metadata;
- full resolved-language policy semantics plus per-release required-language fit and policy-derived language/confidence filters;
- a deterministic leading Arr-accepted candidate labeled as read-only decision support, never an automatic Grab;
- an opt-in administrator-only controlled Grab dialog with exact typed confirmation and a second release revalidation immediately before mutation;
- durable SQLite Grab audit history, idempotent replay, in-flight suppression, and timeout outcomes kept Unknown until reconciliation;
- page-memory item summaries with best Arr-accepted confidence, policy/freshness badges, and local attention filters;
- page-memory triage by application, exact Bazarr profile, policy language, and analysis age, with one-click filter clearing;
- per-required-language coverage computed only from Arr-accepted releases, with Unknown kept distinct from No match found;
- provider-evidence health that exposes available, partial, unavailable, and unknown search windows without changing match confidence;
- transparent analysis timing, provider counts, quota evidence, and separate item/provider cache freshness;
- bounded structured request logs that record only safe route categories, methods, status codes, and duration;
- bounded, visibly labeled stale item evidence when Arr or Bazarr cannot refresh;
- a host-allowlisted, redirect-free, size- and time-bounded read-only HTTP transport;
- secret-file-only Sonarr configuration and a browser-safe version/status route;
- a measured one-shot Sonarr probe with a 30-second status cache and single-flight protection;
- secret-file-only Radarr configuration with the same browser-safe status and measured probe contract;
- a secret-file-only Bazarr profile probe that reports measured counts without exposing policy contents;
- a secret-file-only SubDL exact-search probe that makes one cached-window-shaped request and reports only aggregate availability and quota evidence;
- packaged, one-shot Sonarr episode, Sonarr season, and Radarr movie reports that compose Arr releases, Bazarr policy, and scoped SubDL searches without exposing a quota-triggering browser route;
- a packaged missing-item inventory that reads one bounded page from Sonarr and Radarr while discarding paths, artwork, and overviews;
- a non-root, read-only Docker runtime;
- local and NAS-oriented Compose examples;
- CI checks and Docker builds on every pull request;
- multi-platform GHCR publishing for `linux/amd64` and `linux/arm64`.

## Run locally

Requirements: Node.js 24+ and npm 11+.

```console
npm ci
npm run check
npm start
```

Then open <http://localhost:8080/> for the dashboard, <http://localhost:8080/health> for liveness, or inspect the synthetic report at <http://localhost:8080/api/v1/feasibility/demo>. Sonarr and Radarr integration state is available at `/api/v1/integrations/<integration>/status`; each reports `disabled` until explicitly configured. Live missing-item data is available only after the access boundary documented in the [access-control guide](docs/access-control.md) is enabled.

The demo maps a sanitized synthetic Sonarr v3 response into four release candidates, then associates synthetic SubDL evidence with them. It intentionally includes a rejected video release and a rate-limited provider so clients can verify that video decisions remain separate and provider failures are reported honestly. Authenticated dashboard selections use the [item feasibility API](docs/item-feasibility-api.md); the explicit one-shot commands remain available for controlled diagnostics.

## Development harness

Pegarr uses a deterministic, repository-owned harness as its completion authority. Run `npm run check:affected` before proposing a change. The gate selects the relevant type, build, test, contract, and container sensors and stores complete evidence under `.artifacts/harness/` while keeping terminal failures concise. Every harness mode preserves the completed [Phase 1 criteria ledger](harness/phase-1.json), completed [Phase 2 criteria ledger](harness/phase-2.json), and completed [Phase 3 criteria ledger](harness/phase-3.json), including the explicit live-service gaps.

See the [discovery-first roadmap](docs/discovery-first-roadmap.md), [subtitle settings and catalog coverage guide](docs/subtitle-settings-and-catalog-coverage.md), [catalog add and continue guide](docs/catalog-add-and-continue.md), [release-candidate roadmap](docs/release-candidate-roadmap.md), [controlled Grab guide](docs/controlled-grab.md), [Phase 1 completion record](docs/phase-1-completion.md), [Phase 2 completion record](docs/phase-2-completion.md), [Phase 3 completion record](docs/phase-3.md), [Phase 3 supporting backlog](docs/phase-3-backlog.md), [harness guide](docs/harness.md), [scenario catalog](docs/harness-scenarios.md), [runtime configuration](docs/configuration.md), [access-control guide](docs/access-control.md), [missing-item dashboard guide](docs/missing-item-dashboard.md), [item feasibility API](docs/item-feasibility-api.md), [provider search cache guide](docs/provider-search-cache.md), [missing-item inventory guide](docs/missing-item-inventory.md), [episode feasibility report guide](docs/episode-feasibility-report.md), [season feasibility report guide](docs/season-feasibility-report.md), [movie feasibility report guide](docs/movie-feasibility-report.md), and the versioned integration contracts. Automated scenarios use synthetic fixtures and never call live Sonarr, Radarr, Bazarr, or subtitle providers.

To use Docker instead:

```console
docker compose up --build
```

## Run the image on a NAS

Images built from the default branch and version tags are published to `ghcr.io/squiter/pegarr`. The provided [NAS Compose file](deploy/compose.nas.yaml) uses conservative container permissions and a persistent volume.

```console
cp .env.example .env
docker compose -f deploy/compose.nas.yaml pull
docker compose -f deploy/compose.nas.yaml up -d
docker compose -f deploy/compose.nas.yaml ps
```

For repeatable deployments, set `PEGARR_IMAGE` to a version tag instead of `latest`. The optional [username/password login](deploy/compose.login.yaml), [legacy token access](deploy/compose.access.yaml), [Sonarr](deploy/compose.sonarr.yaml), [Radarr](deploy/compose.radarr.yaml), [Bazarr](deploy/compose.bazarr.yaml), [SubDL](deploy/compose.subdl.yaml), [OpenSubtitles](deploy/compose.opensubtitles.yaml), and [controlled Grab](deploy/compose.grab.yaml) Compose overlays mount credentials as Docker secrets; follow the [configuration guide](docs/configuration.md), and never put a password, token, or key in `.env`. An existing same-network Portainer media stack can instead use the [Jellyfin-stack overlay and runbook](docs/portainer-jellyfin-stack.md) to reuse read-only application config files without copying API keys into Portainer.

## Container publishing

GitHub Actions performs two distinct jobs:

- `CI` runs type checks, tests, and an unpushed Docker build for branches and pull requests.
- `Container` publishes GHCR images from `main`, `v*` tags, or a manual run. Images include branch, semantic-version, commit-SHA, and `latest` tags where applicable.

Both AMD64 and ARM64 images are built so the same release can be tested on common NAS hardware.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Security issues should be reported using [SECURITY.md](SECURITY.md), not a public issue.

## License

Pegarr is available under the [MIT License](LICENSE).
