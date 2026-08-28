# Pegarr development harness

Pegarr treats the repository-owned harness as the authority for completion. An implementation claim is useful context; a passing sensor report is the evidence.

## Daily workflow

1. Read `AGENTS.md` and the research document before changing product or architecture behavior.
2. Add or update a scenario in `harness/manifest.json` before implementing new behavior.
3. Build the behavior against synthetic, sanitized fixtures and name its test with the scenario ID.
4. Use `npm run check:fast` while iterating.
5. Use `npm run check:affected` as the completion gate. It adds the Docker build when runtime or deployment paths changed.
6. Open `.artifacts/harness/latest.json` for the machine-readable verdict. Full command output lives beside the report.

`npm run check` forces every sensor, including the hardened container journey. CI runs that same full gate and uploads harness evidence even when a sensor fails. Pushes to `main` separately publish the multi-platform AMD64/ARM64 image.

## Guides and sensors

The guides are `AGENTS.md`, this document, the research record, the scenario ledger, and the contribution templates. They narrow the intended action before code changes.

The computational sensors currently enforce:

- scenario-to-test traceability and explicit manual gaps;
- completed Phase 1 and active Phase 2 criterion-to-scenario traceability;
- default-read-only, controlled-mutation, authentication, audit, and confidence-state architecture ratchets;
- core matching isolation from Node, adapters, and fixtures;
- local Markdown links and required contributor documentation;
- secret-safe tracked files and absence of browser credential storage;
- TypeScript strictness, production compilation, deterministic single-worker tests;
- a Docker build plus an ephemeral non-root, read-only, egress-disabled endpoint smoke test for runtime/deployment changes.

The runner transforms noisy command output into a short headline and next action. It retains complete logs and a JSON trajectory under `.artifacts/harness/<timestamp>/` so debugging does not depend on terminal history. Every report includes the current phase ID, completion state, automated-scenario count, and manual-gap count.

## Adding an integration

For Sonarr, Radarr, Bazarr, or a subtitle provider:

1. Capture the smallest sanitized response shape needed to answer one contract question.
2. Put provider-specific translation behind a narrow adapter; keep matching and confidence logic provider-independent.
3. Inject the transport so automated tests cannot reach the network.
4. Test failures, timeouts, quotas, malformed responses, and successful empty responses separately.
5. Preserve original evidence next to normalized fields.
6. Add the new scenario IDs and update the manual-gap boundary.
7. Run the affected completion gate before using a live read-only probe.

No harness test may perform Grab or another external mutation against a live service. Phase 2 tests inject synthetic Arr transports or run disposable fixture containers, and the controlled path must retain independent administration, exact confirmation, audit-before-mutation, idempotency, and timeout reconciliation semantics.

## Improving the harness

Treat a repeated failure as a missing affordance. Prefer, in order:

1. make the invalid state impossible through types, schemas, or a narrower adapter;
2. add a deterministic sensor with an actionable failure;
3. improve the synthetic fixture or tool output;
4. update a guide when judgment is genuinely required.

Do not hide flaky or environment-only coverage behind a green automated label. Add it to the manual gaps in the manifest until a hermetic sensor exists.
