# Release-candidate roadmap

> [!IMPORTANT]
> Product discovery work revealed that the original sequence over-emphasized already-added missing items. The [discovery-first roadmap](discovery-first-roadmap.md) is now the P0 roadmap. Complete its authentication, catalog, subtitle-policy settings, and add-and-continue workflow before resuming the acceptance sequence below.

Pegarr's API-feasibility milestone and implementation Phases 1 through 3 are complete. This document retains the release-candidate validation sequence, but that work follows the discovery-first P0 cycle: proving the product can find a not-yet-added title, preview subtitle coverage, add it explicitly with automatic search disabled, and continue to exact release selection inside Pegarr.

At the start of this cycle, the repository had 228 deterministic automated scenarios and six explicit manual gaps. Discovery-first catalog add later introduced `PEG-MANUAL-007`; treat the scenario manifest and phase ledgers as authoritative for the current counts.

## Ordered work

### 1. Local read-only acceptance

Use the local Colima environment before touching the NAS. Exercise real, authenticated reads for every locally available integration:

- Sonarr status, missing inventory, release search, and item analysis;
- Radarr status, missing inventory, release search, and item analysis when a local instance is available;
- Bazarr profile listing and targeted series/movie assignment resolution;
- one bounded SubDL movie or episode search with an explicit Bazarr-to-provider language mapping;
- one bounded OpenSubtitles movie or episode search with an explicit language mapping;
- the authenticated dashboard from inventory selection through release comparison.

Success requires measured request shapes and safe outcomes, not copied provider bodies. Never retain API keys, authorization headers, private paths, download handles, raw provider responses, or unredacted media records in the repository or harness artifacts.

This work advances `PEG-MANUAL-001`, `PEG-MANUAL-002`, `PEG-MANUAL-005`, and `PEG-MANUAL-006`. Update a gap's reason with the observed version, date, and remaining boundary. Remove or close a gap only when its entire statement is proven.

### 2. Local controlled-Grab acceptance

Use a disposable or otherwise harmless local Sonarr/Radarr target. Do not use the NAS for the first mutation test.

Verify one complete operator-owned flow:

1. Controlled Grab is disabled by default.
2. Enabling it still requires the independent administrator secret.
3. Pegarr revalidates the exact release before preparation and execution.
4. An incorrect confirmation phrase causes no mutation.
5. The exact release-and-target phrase permits one Grab.
6. Audit history records the bounded outcome without selection handles or credentials.
7. A repeated idempotency key and a recent duplicate remain blocked.
8. A simulated or observed unknown outcome remains `timeout_unknown` until exact reconciliation.
9. Restart recovery keeps unresolved work Unknown and allows progress only after reconciliation.

This advances `PEG-MANUAL-004`. It never authorizes an automated live Grab, a production Grab, or an arbitrary download.

### 3. Portainer deployment refresh

Refresh the existing secret-safe example and live stack comparison showing Pegarr beside Sonarr, Radarr, and Bazarr, with SubDL and OpenSubtitles configured through Pegarr's persistent server-side settings. It must use the validated immutable image and must not make those services core runtime dependencies.

The guide must include:

- native read-only Arr/Bazarr application-config mounts and private persistent UI-managed provider credentials rather than credentials in environment values;
- an explicit persistent Pegarr data volume for provider cache and Grab audit data;
- internal service names and an authenticated browser route;
- the default read-only deployment and a visibly separate controlled-Grab opt-in;
- `linux/amd64` and `linux/arm64` compatibility without NAS-specific paths;
- first deployment, health checks, persistence checks, reversible update, and rollback steps;
- a warning to preserve the operator's existing Arr/Bazarr mounts, paths, and data.

This is deployment documentation, not ownership of the media stack. Never replace a live Portainer definition from an example without first exporting and comparing it.

### 4. NAS production smoke test

The NAS is the production environment and comes last. Start read-only, use the exact image digest already validated locally, and preserve a rollback unit.

Verify:

- image pull and expected architecture;
- non-root startup, read-only filesystem, health, and readiness;
- authentication before any upstream work;
- private secret-file permissions;
- persistence across a controlled restart;
- bounded Sonarr, Radarr, Bazarr, and provider reads;
- provider cache reuse without extra quota consumption;
- dashboard behavior through the private production route;
- logs and diagnostics remain redacted.

This advances `PEG-MANUAL-003` and may add installed-service evidence to the other gaps. It does not automatically authorize controlled Grab in production.

#### 2026-08-30 production checkpoint

The live `jellyfin` Portainer stack now runs the published multi-architecture image at immutable digest `sha256:d1822dcd9f3a0b187f0647699fa781d2794df55cb65797e0f35d337baa7ff063`. The update preserved the existing Jellyfin, Sonarr, Radarr, Bazarr, Lidarr, and Prowlarr services and changed only Pegarr from legacy API-key-file extraction to the native read-only application-config mounts. Catalog add remains disabled and controlled Grab remains absent.

The refreshed container reached healthy state, survived a controlled Pegarr-only restart, and returned ready through `https://pegarr.brikas.net/health/ready`. The private Nginx Proxy Manager route uses the existing wildcard certificate, forces HTTP to HTTPS, leaves HSTS disabled, and requires authentication before catalog access. Startup and readiness logs contained only bounded event metadata.

Keep `PEG-MANUAL-003` open. Runtime architecture and user identity, secret-file permissions, authenticated Sonarr/Radarr/Bazarr reads, provider-setting persistence, and provider-cache reuse still need sanitized live evidence. `PEG-MANUAL-004` and `PEG-MANUAL-007` remain wholly open; this checkpoint performed no add, automatic search, Grab, or download mutation.

#### 2026-08-31 authenticated production follow-up

Portainer inspection confirmed that the running Pegarr container uses the `node` user, a read-only root filesystem, `CapDrop: ALL`, `no-new-privileges`, and only the persistent `/data` mount as writable. The Sonarr, Radarr, and Bazarr application-config mounts are read-only. Sonarr `4.0.19.2979` and Radarr `6.3.0.10514` each returned an available, read-only status without exposing their URLs or credentials.

The authenticated production dashboard restored an operator session, loaded seven monitored-and-missing items, reported one ready Sonarr and one ready Radarr instance, and returned four bounded Sonarr catalog matches for a fresh query. The UI also restored one required `pt-br` language and server-side SubDL and OpenSubtitles settings, each with one explicit language mapping. A bounded Sonarr series preview nevertheless rendered `Pt-Br: Unsupported`. Treat that result as a failed provider-acceptance checkpoint: it does not prove a provider request, successful language compatibility, or cache reuse, and it must not be rewritten as `No match found`.

The follow-up implementation identified that failed provider results had lost their `searchedLanguages` association before catalog summarization. `PEG-CATALOG-009` now proves that an authenticated provider rejection remains associated with the requested language and renders as `Unknown`, not `Unsupported`. The production digest above predates that correction, so the same bounded preview must be repeated after publishing and deploying the corrected image.

Keep `PEG-MANUAL-003` open for private secret-file permissions, installed Bazarr assignment reads, provider-setting survival across a post-configuration container restart, and provider-cache evidence. Keep `PEG-MANUAL-005` open until the configured SubDL mapping produces a sanitized live provider result and a repeated preview proves a cache hit. Keep `PEG-MANUAL-006` open because title-level Sonarr series previews do not exercise OpenSubtitles; use a bounded movie or exact episode acceptance case. No add, automatic search, Grab, or download mutation was performed.

### 5. First public release

After local acceptance and the read-only NAS smoke test:

- run `npm run check` on the exact release commit;
- require the GitHub CI and multi-architecture container workflows to pass for that commit;
- record unresolved manual boundaries in the release notes;
- choose and apply the first semantic version tag;
- deploy the immutable version tag or digest rather than relying on `latest`;
- verify the published release and container metadata.

Do not call the build production-proven before the relevant manual evidence exists.

## Known implementation limitations

These are honest follow-up candidates, not regressions in the completed Phase 3 contract:

- OpenSubtitles season-pack search is not implemented; its adapter currently supports exact movie and episode searches.
- Specials season `0` remains unsupported until provider season identity is validated.
- Provider credentials and Bazarr-to-provider language mappings are configured independently in Pegarr. A future onboarding helper may reduce duplication, but Pegarr must not depend on Bazarr provider internals.
- Release-name parsing will need new sanitized fixtures when real providers expose previously unseen notation.

## Phase 4 boundary

Optional workflow adapters have not started:

- Jellyfin item-menu link;
- Seerr request webhook;
- notifications containing a Pegarr deep link;
- browser extension or userscript.

Start one only when real usage demonstrates its value. Optional adapters must contain no matching logic and must not become core dependencies.

## Handoff for the next agent

Start with local read-only acceptance. Read `AGENTS.md`, the research document, the relevant integration contract, and `harness/manifest.json` before acting. Prefer the packaged probes and existing injected boundaries over ad hoc requests.

For every result:

- distinguish implementation evidence from installed-environment evidence;
- preserve all manifest manual gaps until their complete claims are proven;
- improve a fixture, guide, tool, or sensor when a failure would otherwise recur;
- add a stable harness scenario for every behavior change;
- use `npm run check:affected` as the local completion gate;
- never execute an automated Grab against a live service;
- never mutate the NAS without explicit authority for that exact operation.

If local credentials or a required service are unavailable, move to the Portainer documentation slice instead of weakening a validation claim.
