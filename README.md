# Pegarr

**Find subtitle-ready series and movies before adding or downloading them.**

[![CI](https://github.com/squiter/pegarr/actions/workflows/ci.yml/badge.svg)](https://github.com/squiter/pegarr/actions/workflows/ci.yml)
[![Container](https://github.com/squiter/pegarr/actions/workflows/container.yml/badge.svg)](https://github.com/squiter/pegarr/actions/workflows/container.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Pegarr is a self-hosted companion for Sonarr, Radarr, and Bazarr. Search the Sonarr and Radarr catalogs, preview whether the subtitles you want are available, add the selected title with automatic search disabled, and compare exact release candidates with subtitle evidence inside Pegarr.

## How it works

1. Search for a series or movie that is not yet in Sonarr or Radarr.
2. Preview title-level subtitle availability from configured providers.
3. Add the title explicitly. Pegarr forces Sonarr or Radarr automatic search off.
4. Inspect exact episode, season, or movie releases with Arr decisions and subtitle confidence shown separately.
5. Optionally use administrator-enabled controlled Grab after reviewing and confirming one exact release.

Pegarr explains whether subtitle evidence is **Confirmed**, **Likely**, **Possible**, **Not found**, or **Unknown**. Provider errors, timeouts, and quota exhaustion stay Unknown; they are never presented as proof that subtitles do not exist.

## Safety boundaries

- Read-only analysis is the default.
- Catalog add and controlled Grab are independent opt-ins.
- Pegarr never automatically chooses or downloads a release.
- Sonarr and Radarr remain authoritative for video acceptance and rejection reasons.
- Bazarr or an explicit Pegarr policy defines the required subtitle languages; no language is hardcoded as a user default.
- Credentials stay server-side and are never returned to the browser, stored in browser storage, or placed in URLs and logs.

Controlled Grab is intended for deliberate operator use. It requires separate administrator configuration, fresh release revalidation, exact confirmation, and an audit record. Automated tests never Grab from a live service.

## Quick start

Requirements: Docker with Compose.

```console
git clone https://github.com/squiter/pegarr.git
cd pegarr
docker compose up --build -d
```

Open <http://localhost:8080/>. The default Compose file starts Pegarr without external integrations; use the configuration guide to connect your services and enable login.

For a repeatable NAS deployment, copy the example environment file and pin the released image:

```console
cp .env.example .env
# Set PEGARR_IMAGE=ghcr.io/squiter/pegarr:0.1.3 in .env
docker compose -f deploy/compose.nas.yaml pull
docker compose -f deploy/compose.nas.yaml up -d
```

The image supports `linux/amd64` and `linux/arm64`. Never put passwords, access tokens, or provider API keys in `.env`; the Compose overlays mount them as secret files.

## Configuration

- [Runtime configuration](docs/configuration.md): login, Sonarr, Radarr, Bazarr, providers, and feature flags.
- [Subtitle policy and provider setup](docs/subtitle-settings-and-catalog-coverage.md): configure languages and understand pre-add coverage.
- [Catalog add and exact-analysis continuation](docs/catalog-add-and-continue.md): safe add behavior and the next-step workflow.
- [Portainer media-stack deployment](docs/portainer-jellyfin-stack.md): add Pegarr to an existing same-network stack without copying Arr API keys into Portainer.
- [Controlled Grab](docs/controlled-grab.md): separately enable and operate the mutation boundary.

## Documentation

- [Latest release notes](docs/releases/v0.1.3.md), [v0.1.2 notes](docs/releases/v0.1.2.md), and [changelog](CHANGELOG.md)
- [Missing-item dashboard](docs/missing-item-dashboard.md) and [item feasibility API](docs/item-feasibility-api.md)
- [Provider cache](docs/provider-search-cache.md) and [integration contracts](docs/contracts/)
- [Release-candidate acceptance record](docs/release-candidate-roadmap.md) and [release guide](docs/releasing.md)
- [Harness guide](docs/harness.md) and [scenario catalog](docs/harness-scenarios.md)

Detailed phase history, implementation inventories, and manual acceptance evidence live in those engineering documents instead of this user-facing overview.

## Development

Requirements: Node.js 24+ and npm 11+.

```console
npm ci
npm run check:affected
npm run dev
```

Use `npm run check` for the full local release gate. Automated scenarios use synthetic fixtures and never call live Sonarr, Radarr, Bazarr, or subtitle providers.

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues through [SECURITY.md](SECURITY.md), not a public issue.

## License

Pegarr is available under the [MIT License](LICENSE).
