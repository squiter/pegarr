# Phase 1 completion

Phase 1 implementation is complete. Pegarr now satisfies the read-only MVP checklist from the research proposal with deterministic, repository-owned evidence. This is an implementation milestone, not permission to deploy to the NAS or begin Phase 2 Grab work.

`harness/phase-1.json` is the machine-readable completion ledger. `PEG-PHASE` runs in every harness mode and fails if a criterion stops being complete, references missing or manual evidence, drifts from the scenario manifest, or disappears from this guide.

## Completion criteria

| Criterion | Outcome | Representative evidence |
| --- | --- | --- |
| `P1-ARR-INSTANCES` | One independently configured Sonarr instance and one independently configured Radarr instance are supported through bounded read-only adapters. | Configuration, adapter, runtime-status, and missing-inventory scenarios |
| `P1-BAZARR-POLICY` | Bazarr profiles and targeted movie/series assignments resolve without assuming a language. | `PEG-BAZARR-001` through `PEG-BAZARR-005` |
| `P1-SUBDL-ADAPTER` | SubDL searches are authenticated by header, language-scoped, bounded, cached only after success, and stripped of download handles. | `PEG-SUBDL-001` through `PEG-SUBDL-006` |
| `P1-MISSING-DASHBOARD` | The authenticated dashboard lists safe missing-item evidence and performs search, filters, and sorting in page memory. | Access, inventory, dashboard, and packaged-container scenarios |
| `P1-RELEASE-TABLE` | Selected items produce an interactive release table and three-candidate comparison while preserving Arr decisions. | Item-feasibility and `PEG-DASH-*` scenarios |
| `P1-CONFIDENCE` | Confirmed, Likely, Possible, No match found, and Unknown remain deterministic and explainable. | `PEG-MATCH-001` through `PEG-MATCH-010` |
| `P1-OPERATIONS` | Health, bounded item/provider caches, stale fallback, and structured redacted request logs are operational. | `PEG-OPS-001` through `PEG-OPS-003`, cache, HTTP, and Docker scenarios |
| `P1-NO-GRAB` | No Grab route, client control, adapter mutation, or automated external mutation exists. | API, access, architecture, dashboard, and packaged-container sensors |

The ledger contains the exact scenario IDs for every criterion. The harness report repeats the phase ID, completion state, automated-scenario count, and manual-gap count so CI artifacts can be evaluated without reconstructing repository state.

## Remaining external validation

These gaps stay explicit and do not masquerade as automated coverage:

- `PEG-MANUAL-001`: live Radarr compatibility remains unverified; local Sonarr compatibility is already measured read-only.
- `PEG-MANUAL-002`: local Bazarr shapes are measured, but the installed NAS policy remains production validation.
- `PEG-MANUAL-003`: NAS pull, startup, persistence, and architecture smoke testing requires a separate deployment decision.
- `PEG-MANUAL-004`: any future Grab confirmation belongs to Phase 2 and requires a new mutation-specific design and harness.
- `PEG-MANUAL-005`: live authenticated SubDL response and language-code compatibility remain unverified.

The absence of local Radarr and SubDL services is not repaired with private fixtures, hidden network calls, or a false green label.

## Phase boundary

Normal development after this milestone may harden or correct the read-only MVP. Phase 2 must not begin implicitly. Release revalidation, confirmation, Grab, audit history, and duplicate protection require an explicit product decision and a new completion ledger before any mutation route is introduced.
