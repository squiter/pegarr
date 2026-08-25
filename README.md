# Pegarr

**Subtitle-aware release selection for Sonarr and Radarr.**

[![CI](https://github.com/squiter/pegarr/actions/workflows/ci.yml/badge.svg)](https://github.com/squiter/pegarr/actions/workflows/ci.yml)
[![Container](https://github.com/squiter/pegarr/actions/workflows/container.yml/badge.svg)](https://github.com/squiter/pegarr/actions/workflows/container.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Pegarr is a self-hosted companion for Sonarr, Radarr, and Bazarr. It is designed to compare interactive-search releases with subtitle-provider evidence, explain the confidence of each match, and eventually let an authorized user grab the best-informed release.

> [!IMPORTANT]
> Pegarr is in its API-feasibility phase. The current container exposes a synthetic, read-only feasibility report; it does not connect to live services or perform Grab operations yet.

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

Then open <http://localhost:8080/health> or inspect the Phase 0 report at <http://localhost:8080/api/v1/feasibility/demo>.

The demo associates synthetic SubDL evidence with four Sonarr-style releases. It intentionally includes a rejected video release and a rate-limited provider so clients can verify that video decisions remain separate and provider failures are reported honestly.

## Development harness

Pegarr uses a deterministic, repository-owned harness as its completion authority. Run `npm run check:affected` before proposing a change. The gate selects the relevant type, build, test, contract, and container sensors and stores complete evidence under `.artifacts/harness/` while keeping terminal failures concise.

See [the harness guide](docs/harness.md) and [scenario catalog](docs/harness-scenarios.md). Automated scenarios use synthetic fixtures and never call live Sonarr, Radarr, Bazarr, or subtitle providers.

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

For repeatable deployments, set `PEGARR_IMAGE` to a version tag instead of `latest`. No Sonarr, Radarr, Bazarr, or provider credentials are accepted by this initial scaffold. When those integrations are added, secrets will remain server-side and will not be committed to `.env` files.

## Container publishing

GitHub Actions performs two distinct jobs:

- `CI` runs type checks, tests, and an unpushed Docker build for branches and pull requests.
- `Container` publishes GHCR images from `main`, `v*` tags, or a manual run. Images include branch, semantic-version, commit-SHA, and `latest` tags where applicable.

Both AMD64 and ARM64 images are built so the same release can be tested on common NAS hardware.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Security issues should be reported using [SECURITY.md](SECURITY.md), not a public issue.

## License

Pegarr is available under the [MIT License](LICENSE).
