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

#### 2026-08-31 corrected-image production acceptance

The live stack now runs the corrected multi-architecture image at immutable digest `sha256:dc89826ebb3d699e8ac225c6019aad120ab8398a4710ee24807af11e5fe75340`. Portainer retained all seven services, the three read-only application-config mounts, secure session cookies, `PEGARR_ADD_ENABLED=false`, the read-only root filesystem, dropped capabilities, and `no-new-privileges`. The replacement Pegarr container became healthy, `/health/ready` returned `200`, and the persisted username/password authenticated successfully without exposing either secret. The password file was owned by `node:node` with mode `0600`.

Authenticated read-only acceptance returned four Sonarr matches for `The Expanse` and twenty Radarr matches for `Dune`; both selected titles were not already added. The corrected series preview made one SubDL request and returned `pt-br: Unknown` with a language-scoped `unauthorized` provider result. The corrected movie preview made one SubDL and one OpenSubtitles request and returned the same honest `Unknown` state with both failures scoped to `pt-br`. Repeating either preview made the provider requests again because authentication failures are intentionally not cached. This closes the incorrect `Unsupported` regression and proves that both live provider paths are invoked, but the saved provider credentials themselves must be replaced before successful result, quota, mapping, or cache-hit evidence is possible.

Later acceptance on 2026-08-31 superseded the credential conclusion. With actionable-discovery digest `sha256:bd9cacdf6935fbeba7bf4fb729ba42b88ccae5e520858fff6697762394992b60`, SubDL returned 30 `pt-br` title-level matches for Game of Thrones and one for The Adventures of Tintin, proving successful authenticated series and movie responses plus the live language mapping. A first transient series rejection remained **Could Not Check** and was not cached; retrying succeeded. The movie request also reached OpenSubtitles, whose temporary service unavailability remained distinct and did not hide SubDL's positive result. `PEG-MANUAL-005` now remains open only for sanitized quota and cache-hit evidence; `PEG-MANUAL-006` still needs a successful OpenSubtitles response, rate evidence, and cache reuse.

The same deployment set `PEGARR_ADD_ENABLED=true`. The catalog rendered separate **Not In Sonarr/Radarr** state and **Add to Sonarr/Radarr** actions. Opening Game of Thrones loaded the installed Sonarr root folder, quality profile, episode-monitoring choices, and exact confirmation phrase; the flow was canceled before submission. This proves live server-owned form loading while leaving `PEG-MANUAL-007` open for the separately authorized harmless POST and automatic-search suppression check.

Keep `PEG-MANUAL-003` open for installed Bazarr assignment reads and successful provider-cache evidence. Keep `PEG-MANUAL-005` and `PEG-MANUAL-006` open for valid provider credentials, successful sanitized responses, live language compatibility, quota evidence, and a cache hit. `PEG-MANUAL-004` and `PEG-MANUAL-007` remain open and separately authorized; this acceptance performed no add, automatic search, Grab, or download mutation.

#### 2026-08-31 discovery-navigation production acceptance

GitHub CI and the multi-platform container workflow passed for commit `f71b296`. Portainer then replaced only Pegarr with immutable digest `sha256:f4e60a22eff42c275f788b8f87c5552d0ad848de5c51b0805c85ecc87c1ea785`; the full stack definition was preserved byte-for-byte except for the one same-length image-digest replacement, and pruning plus forced re-pull remained disabled. Pegarr reached healthy state while Jellyfin, Sonarr, Radarr, Bazarr, Lidarr, and Prowlarr remained running.

The live HTTPS endpoint returned `ready`, and its delivered HTML/JavaScript contain the **Setup & settings** drawer, catalog-first page order, automatic first-run opening, page-memory-only dismissal, and `Credential saved (not verified)` provider wording. An authenticated local-browser acceptance covered automatic opening, close-and-reopen behavior, keyboard semantics, desktop layout, and a 390-pixel mobile layout without horizontal overflow. The NAS container replacement expired the prior browser session, so those interactions were not relabeled as fresh authenticated NAS evidence. This acceptance made no provider search, catalog add, automatic search, Grab, or download mutation.

#### 2026-08-31 single-button catalog-add production acceptance

Commit `95c794b` removed the catalog-add confirmation phrase from both the authenticated UI and the exact POST contract. Its multi-architecture image at immutable digest `sha256:ce7c4bac6c245e0c5e7f9dc17ed6a08028fd9430179be650fe234567542c4fe1` passed GitHub CI and container publication before Portainer replaced exactly one Pegarr image reference. Pegarr reached healthy state while all six sibling services remained running.

The live HTTPS endpoint returned `ready`, unauthenticated session access remained `401`, and the served dashboard JavaScript contained the single **Add to Sonarr/Radarr** action without the typed phrase, confirmation view, or confirmation payload. The independently guarded controlled-Grab phrase remains unchanged. `PEG-MANUAL-007` stays open because this acceptance intentionally did not press Add or claim that installed Sonarr/Radarr automatic-search suppression was live-proven.

#### 2026-08-31 live Sonarr add and continuation-race acceptance

The authenticated catalog preview returned **Pt-Br: Available (29 matches)** for Severance before any mutation. The explicit single-button add then created Severance in the installed Sonarr library with the selected `tv` root, `Any` quality profile, all episodes monitored, and automatic search disabled. Sonarr showed the new monitored series with seasons 1 and 2 populated. Title-scoped queue and history checks contained no Severance activity, proving that this Pegarr add did not launch an automatic release search or download; unrelated Game of Thrones activity initiated separately in Sonarr was deliberately excluded from that evidence.

The first continuation read raced Sonarr's episode population and received an empty scope list. Commit `bede482` now keeps that transient empty response out of Pegarr's scope cache and gives the browser bounded automatic retries plus an explicit **Retry loading seasons and episodes** action. GitHub CI and the multi-platform container workflow passed before Portainer replaced exactly one image digest with `sha256:03842df75d9778caf8c60f00b689dfd2e50670067b1ae6e886daea1a169d7c51`. Pegarr returned healthy, all six sibling services remained running, HTTPS readiness returned `200`, unauthenticated session access remained `401`, and the live dashboard asset contained the retry implementation.

This substantially advances `PEG-MANUAL-007`: installed Sonarr add compatibility and title-scoped automatic-search suppression are live-proven. Keep the gap open for a fresh post-fix Sonarr add-to-exact-analysis continuation and the equivalent harmless Radarr add. Keep `PEG-MANUAL-001` open because exact installed release analysis has not yet completed. No controlled Grab was prepared or executed.

#### 2026-09-01 restart-safe session production acceptance

Commits `a65b337` and `0d821b0` moved username/password sessions from process memory into private hashed state under the existing `/data` volume. The implementation and packaged image passed `PEG-SESSION-004` and `PEG-DOCKER-027`: only SHA-256 session and CSRF digests plus the fixed expiry are persisted, the database is mode `0600`, an unexpired login survives a real container restart without extending its expiry, and logout remains durable across a second restart. GitHub CI and the multi-platform container workflow passed before Portainer replaced exactly one image reference with `ghcr.io/squiter/pegarr@sha256:c16c6ccdb58d82a3885fbb737812049f7ccdfd30fcbaf6c0e83ba45f96537f8c`.

The replacement became healthy at revision `0d821b041d930a79e5d6950671a020a6ce4bfad1`; HTTPS readiness returned `200`, unauthenticated session access returned `401`, and Jellyfin, Sonarr, Radarr, Bazarr, Lidarr, and Prowlarr remained running with their earlier creation timestamps. After one expected migration login from the superseded memory-only release, Portainer restarted only `jellyfin-pegarr-1`. The bounded log sequence recorded `shutdown_started`, a fresh `server_started`, and then authenticated `session_status=200`; reloading the same browser tab showed **Sign out**, restored **Setup & settings: Ready**, and loaded the 50-item inventory without another login. A post-restart read-only catalog search returned 31 Game of Thrones matches and its series preview returned **Pt-Br: Available (30 Matches)** from SubDL. No catalog add, automatic search, controlled Grab, or download mutation was performed.

#### 2026-09-01 installed exact-analysis and provider-cache acceptance

The same authenticated deployment completed a read-only analysis of Severance S02E10 against installed Sonarr and Bazarr. It resolved the **PT-BR + English** Bazarr series profile and assignment, preserved the required and cutoff semantics, returned 29 exact Sonarr candidates, and kept every Arr decision and reason visible. SubDL successfully supplied Brazilian-Portuguese release evidence, reported 1,978 of 2,000 requests remaining, and stored the result in the private provider cache. An explicit analysis refresh re-read Sonarr and Bazarr, reused the SubDL cache entry, made no new SubDL quota request, and kept the quota value at 1,978. OpenSubtitles authentication failure and the missing English mapping remained separate Unknown/unsupported evidence instead of becoming Not found.

This closes `PEG-MANUAL-005` and proves the Sonarr side of `PEG-MANUAL-001`, the installed Bazarr series side of `PEG-MANUAL-002`, the cache-reuse portion of `PEG-MANUAL-003`, and the post-fix Sonarr continuation portion of `PEG-MANUAL-007`. Exact installed Radarr analysis/add, installed Bazarr movie assignment, successful OpenSubtitles evidence, remaining provider-secret permissions, and an operator-owned harmless controlled Grab stay open. No catalog add, automatic search, controlled Grab, or download mutation was performed during this acceptance.

### 5. First public release — completed

After local acceptance and the read-only NAS smoke test:

- run `npm run check` on the exact release commit;
- require the GitHub CI and multi-architecture container workflows to pass for that commit;
- record unresolved manual boundaries in the release notes;
- choose and apply the first semantic version tag;
- deploy the immutable version tag or digest rather than relying on `latest`;
- verify the published release and container metadata.

Do not call the build production-proven before the relevant manual evidence exists.

Pegarr `v0.1.0` was published on 2026-09-01 from commit `f8d97eb332c93b672bc8ac42ed69b8183f773253`. The exact release commit passed the full local harness plus GitHub CI and multi-platform container publication. The public GHCR image was deployed by immutable digest and returned the expected `0.1.0` version and Git revision without weakening the remaining manual boundaries.

The `v0.1.1` patch keeps the same product and safety boundary while canonicalizing Bazarr's `pb` display alias as `pt-BR`. Its post-release acceptance sequence is: publish and deploy the immutable patch image, verify the authenticated read-only dashboard and restart-safe session, then attempt the installed Radarr movie/add/exact-analysis path and successful OpenSubtitles evidence. A controlled Grab remains a separate operator-owned acceptance action and is never automated.

#### 2026-09-01 v0.1.1 release and installed Radarr acceptance

Pegarr `v0.1.1` was published from commit `f79b9d8247cf4596433a7210ceb138bfb4f211d0`. The exact commit passed 299 deterministic automated scenarios and six recorded manual gaps locally, then both GitHub workflows passed. The stable multi-architecture image was published at immutable digest `sha256:674d08386f05657a1d686979f451357897ed773d95e85ea304c0c698d17cd2a0`.

Portainer preserved the complete stack definition and replaced only the Pegarr image digest. The new container reported version `0.1.1`, exact release revision `f79b9d8247cf4596433a7210ceb138bfb4f211d0`, and healthy readiness while all six sibling services retained their existing creation timestamps. The persisted browser session survived the replacement.

The authenticated catalog preview found one SubDL `pt-BR` match for **The Adventures of Tintin**. The explicit Radarr add created the monitored movie with root `movies`, quality profile `Any`, minimum availability `Released`, and automatic search disabled. Pegarr immediately evaluated 11 installed Radarr release candidates. Radarr's queue stayed empty and its history contained no Tintin activity, closing installed Sonarr/Radarr API compatibility and catalog-add/automatic-search gaps `PEG-MANUAL-001` and `PEG-MANUAL-007`. Controlled Grab stayed disabled and no release was downloaded.

A bounded manual Bazarr sync completed and named the new movie, but Bazarr's movie inventory remained at 13 file-backed titles and omitted Tintin. This is Bazarr's documented behavior: it stores only Radarr movies whose video file already exists. The subsequent dashboard refresh exposed a Pegarr routing defect by leaving the server-owned continuation and opening ordinary Bazarr-backed missing-item analysis. `PEG-DASH-057` fixes that defect: continuation refresh preserves the explicit Pegarr pre-download policy. The installed Bazarr movie-assignment gap remains open for a file-backed movie, and OpenSubtitles still reports temporary service unavailability honestly rather than `No match found`.

The follow-up `v0.1.2` patch contains only that continuation-refresh fix and the resulting acceptance ledger updates. Commit `cf846794d167034341c39e733b2323f6da5d5f65` passed the 300-scenario full harness and both exact-commit GitHub workflows. The stable AMD64/ARM64 image was published at `sha256:fca18d1dfb9bcab34ab4ba57b1f9d2f7f6e3c625a6d7e06a79d71ed1fcc2b48f` and released publicly.

Portainer again preserved the exact 5,277-character stack definition and changed only the Pegarr digest. The replacement became healthy at version `0.1.2` and the exact release revision while every sibling container retained its earlier timestamp. The existing login survived, the 51-item inventory restored, and the served browser asset contained the continuation-specific refresh route. A sanitized node-user console check recorded mode `0700` on `/data/provider-secrets` and mode `0600` on both provider API-key files, provider settings, subtitle settings, and the session database; no value was read. This closes `PEG-MANUAL-003`. The deployment did not repeat the catalog add, start automatic search, prepare a Grab, or download a release.

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
