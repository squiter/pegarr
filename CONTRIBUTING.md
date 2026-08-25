# Contributing to Pegarr

Pegarr is currently validating its external API contracts. Small, evidence-backed changes are easier to review than broad feature implementations at this stage.

## Before opening a change

1. Read `ARR-SUBTITLE-RELEASE-PICKER-RESEARCH.md` and `AGENTS.md`.
2. Open an issue before introducing a new runtime dependency, provider adapter, or product integration.
3. Remove API keys, internal hostnames, media-library details, and account data from fixtures and logs.
4. Keep external mutations disabled in tests. A Sonarr or Radarr Grab must never occur in an automated test against a live instance.

## Local checks

```console
npm ci
npm run check:affected
```

The affected gate is the normal completion command. It runs the deterministic repository sensors and adds the compiled checks and Docker build when the changed paths require them. Use `npm run check:fast` for quick feedback and `npm run check` to force every local sensor.

Each behavior change must update [the scenario ledger](harness/manifest.json), name its deterministic test with the scenario ID, and keep [the human-readable catalog](docs/harness-scenarios.md) current. If behavior can only be checked against a live service or NAS, record it as a manual gap rather than weakening the automated suite or using private data.

Commits should be focused and use clear imperative subjects. Pull requests should describe the contract or behavior being proven, the harness evidence collected, and any remaining uncertainty.
