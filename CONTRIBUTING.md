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
npm run check
docker build -t pegarr:check .
```

Commits should be focused and use clear imperative subjects. Pull requests should describe the contract or behavior being proven, the evidence collected, and any remaining uncertainty.
