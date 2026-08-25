# Pegarr

**Subtitle-aware release selection for Sonarr and Radarr.**

[![CI](https://github.com/squiter/pegarr/actions/workflows/ci.yml/badge.svg)](https://github.com/squiter/pegarr/actions/workflows/ci.yml)
[![Container](https://github.com/squiter/pegarr/actions/workflows/container.yml/badge.svg)](https://github.com/squiter/pegarr/actions/workflows/container.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Pegarr is a self-hosted companion for Sonarr, Radarr, and Bazarr. It is designed to compare interactive-search releases with subtitle-provider evidence, explain the confidence of each match, and eventually let an authorized user grab the best-informed release.

> [!IMPORTANT]
> Pegarr is in its API-feasibility phase. The container exposes a synthetic, read-only feasibility report and an opt-in Sonarr status probe. It does not perform Grab operations.

## Why Pegarr?

Sonarr and Radarr make strong video-release decisions. Bazarr manages subtitles after a file is imported. Pegarr targets the gap between them: helping a person understand subtitle availability before choosing a release.

Pegarr will keep these decisions separate and visible:

- whether Sonarr or Radarr accepts the video release;
- whether a matching subtitle is Confirmed, Likely, Possible, not found, or Unknown;
- why that subtitle confidence was assigned;
- whether a provider failed or exhausted its quota.

Provider failures are never treated as proof that subtitles do not exist.

## Project status

The first milestone is a read-only feasibility spike that will verify the live Sonarr, Radarr, Bazarr, and SubDL contracts using sanitized fixtures. See [the research and implementation proposal](ARR-SUBTITLE-RELEASE-PICKER-RESEARCH.md) for the product decisions, phases, non-goals, and open questions.

The current repository foundation includes:

- a dependency-light TypeScript service;
- `/health` and `/health/ready` endpoints;
- a deterministic `/api/v1/feasibility/demo` report backed by sanitized synthetic evidence;
- provider-independent normalization and explainable confidence results;
- a bounded, transport-injected Sonarr v3 episode release-search adapter proven with a sanitized contract fixture;
- a host-allowlisted, redirect-free, size- and time-bounded read-only HTTP transport;
- secret-file-only Sonarr configuration and a browser-safe version/status route;
- a measured one-shot Sonarr probe with a 30-second status cache and single-flight protection;
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

Then open <http://localhost:8080/health> or inspect the Phase 0 report at <http://localhost:8080/api/v1/feasibility/demo>. Sonarr integration state is available at <http://localhost:8080/api/v1/integrations/sonarr/status> and reports `disabled` until explicitly configured.

The demo maps a sanitized synthetic Sonarr v3 response into four release candidates, then associates synthetic SubDL evidence with them. It intentionally includes a rejected video release and a rate-limited provider so clients can verify that video decisions remain separate and provider failures are reported honestly. Live release searches are not runtime-enabled yet.

## Development harness

Pegarr uses a deterministic, repository-owned harness as its completion authority. Run `npm run check:affected` before proposing a change. The gate selects the relevant type, build, test, contract, and container sensors and stores complete evidence under `.artifacts/harness/` while keeping terminal failures concise.

See [the harness guide](docs/harness.md), [scenario catalog](docs/harness-scenarios.md), [runtime configuration](docs/configuration.md), [HTTP transport contract](docs/contracts/http-transport.md), [Sonarr release-search contract](docs/contracts/sonarr-v3-release-search.md), and [Sonarr status contract](docs/contracts/sonarr-v3-system-status.md). Automated scenarios use synthetic fixtures and never call live Sonarr, Radarr, Bazarr, or subtitle providers.

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

For repeatable deployments, set `PEGARR_IMAGE` to a version tag instead of `latest`. The optional [Sonarr Compose overlay](deploy/compose.sonarr.yaml) mounts the API key as a Docker secret; follow the [configuration guide](docs/configuration.md) to run the one-shot status probe, and never put the key in `.env`.

## Container publishing

GitHub Actions performs two distinct jobs:

- `CI` runs type checks, tests, and an unpushed Docker build for branches and pull requests.
- `Container` publishes GHCR images from `main`, `v*` tags, or a manual run. Images include branch, semantic-version, commit-SHA, and `latest` tags where applicable.

Both AMD64 and ARM64 images are built so the same release can be tested on common NAS hardware.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Security issues should be reported using [SECURITY.md](SECURITY.md), not a public issue.

## License

Pegarr is available under the [MIT License](LICENSE).
