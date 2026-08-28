# Pegarr

Subtitle-aware release selection for the *Arr ecosystem.

Status: research and implementation proposal
Research snapshot: 2026-08-25
Selected product name: **Pegarr**
Selected tagline: **Subtitle-aware release selection for Sonarr and Radarr.**

## Executive summary

The product should be a small, independent companion application for Sonarr, Radarr, and Bazarr.

Its purpose is to improve manual release selection by showing whether each Sonarr or Radarr release candidate is likely to have subtitles matching the user's Bazarr language policy. The user can then select the exact release to grab.

The core application should not depend on Jellyfin, Canopy, Jellyfin Enhanced, or Seerr. Those systems may become optional navigation or notification adapters later, but none is required to solve the problem.

The minimum useful workflow is:

1. List monitored or missing movies and episodes from Sonarr and Radarr.
2. Let the user choose an item and run an interactive release search.
3. Read the applicable subtitle requirements from Bazarr.
4. Search supported subtitle providers for the requested languages.
5. Compare subtitle release metadata with every video release candidate.
6. Display a confidence level and explanation for each match.
7. Let an authorized user tell Sonarr or Radarr to grab the selected release.

This is decision support, not a guarantee. Before the video file exists, subtitle matching normally relies on media identifiers and release-name metadata rather than a file hash.

## The problem

Sonarr and Radarr are excellent at selecting releases using quality profiles, custom formats, indexer results, and availability. Bazarr is excellent at acquiring and managing subtitles after a media file has been imported.

There is a gap between those stages:

- A video release may satisfy the desired video quality while having poor subtitle coverage.
- A subtitle may exist for the title but be synchronized for a different cut, source, frame rate, season pack, or release group.
- Release names containing `PT-BR`, `Brazilian`, `MULTi`, or `MULTiSUB` are useful hints, but they do not prove that a suitable external subtitle exists.
- Bazarr usually performs its strongest matching after the video file exists, which is too late to influence the initial release choice.
- Users currently need to inspect releases in Sonarr/Radarr and independently search subtitle providers.

The intended product closes that gap without replacing any existing *Arr application.

## Product objective

For every release returned by Sonarr or Radarr Interactive Search, answer:

> How likely is this exact release to have subtitles that satisfy the language and preference policy configured for this item?

The application should explain the answer instead of presenting an opaque score.

Example:

| Release | Video decision | Subtitle decision | Explanation |
| --- | --- | --- | --- |
| `Show.S03E05.1080p.WEB-DL-GROUP` | Accepted | Confirmed | PT-BR subtitle explicitly lists the same release group and episode |
| `Show.S03E05.1080p.WEB.H264-OTHER` | Accepted | Likely | PT-BR subtitle exists for the episode and WEB source, but the group differs |
| `Show.S03E05.720p.HDTV-OLD` | Rejected by profile | Available | Subtitle exists, but Sonarr rejects the video release |
| `Show.S03E05.2160p.WEB-DL-NEW` | Accepted | Unknown | Provider search was rate-limited; absence was not proven |

## Core principles

### Bazarr defines policy; the application evaluates availability

Languages must not be hardcoded to Portuguese (Brazil). The application should obtain the desired languages and preferences from the Bazarr profile applicable to the movie or series.

PT-BR is the motivating use case, but the design must support any Bazarr language profile, fallback language, forced-subtitle preference, hearing-impaired preference, and future profile option that can be represented safely.

### Sonarr and Radarr remain authoritative for video releases

The application must not duplicate indexer, quality-profile, rejection, or download-client logic. It should consume the release candidates and decisions returned by Sonarr/Radarr, enrich them, and send the selected candidate back through the supported Grab operation.

An *Arr-rejected release must remain visibly rejected. Subtitle availability must never silently override an *Arr rejection.

### Bazarr remains authoritative after import

The application does not replace Bazarr download, synchronization, upgrade, scoring, or sidecar management. After import, Bazarr continues its normal work.

### Honest confidence, not false certainty

`No result`, `provider unavailable`, and `confirmed unavailable` are different states. Provider errors or exhausted quotas must produce `Unknown`, never `No subtitles`.

### Independent core, optional adapters

The core product integrates directly with Sonarr, Radarr, Bazarr, and explicitly supported subtitle-provider APIs. Jellyfin and Seerr adapters may be added only when they solve a demonstrated workflow problem.

## Research findings

### Jellyfin Canopy

Repository: <https://github.com/4eh5xitv6787h645ebv/Jellyfin-Canopy>

Facts observed on 2026-08-25:

- The repository was created on 2026-07-07.
- It had 3 stars, 0 forks, and 119 open issue/PR entries.
- The maintainer's profile identifies the person as Jake; the account dates to 2018.
- The README explicitly says Canopy is developed entirely with AI coding tools under human direction and curation.
- Its normal build/test and security workflows passed for the latest release, and it has active security, E2E, release, and dependency workflows.
- Recent development and merged pull requests are overwhelmingly maintainer-authored, so its community and bus-factor remain unproven.
- The latest advisory Jellyfin compatibility workflow and nightly refresh automation were failing during the research snapshot, while the normal build and security workflows were passing.
- Canopy is GPL-3.0.

Relevant feature:

- [PR #17](https://github.com/4eh5xitv6787h645ebv/Jellyfin-Canopy/pull/17) added Sonarr/Radarr Search, Interactive Search, and Grab actions.
- It contains the exact UI concept needed: an item-level modal with normalized release rows and a Grab button.
- Its release model includes title, quality, size, age, seeders/leechers, protocol, approval, rejection reasons, release group, custom-format score, languages, and indexer flags.
- The server exposes normalized search and grab operations to the client while keeping *Arr credentials server-side.
- [Issue #680](https://github.com/4eh5xitv6787h645ebv/Jellyfin-Canopy/issues/680) concerns downloading subtitle files already attached to a Jellyfin item; it is not this feature.
- [Issue #56](https://github.com/4eh5xitv6787h645ebv/Jellyfin-Canopy/issues/56) is a general integrations audit; it is not this feature.
- No exact Canopy issue was found for subtitle-aware release selection based on Bazarr profiles.

Contribution posture:

- Canopy's contributing guide explicitly accepts AI-assisted contributions when the contributor discloses the assistance, understands the code, tests it, and can respond to review.
- PR #17 itself disclosed AI assistance and was merged, although it was authored by the repository owner.

Decision:

- Do not make Canopy a runtime dependency.
- Use its behavior and API normalization as research material.
- Copy code only if we intentionally accept GPL-3.0 obligations and preserve attribution; otherwise implement independently.

### Jellyfin Enhanced

Repository: <https://github.com/n00bcodr/Jellyfin-Enhanced>

Facts observed on 2026-08-25:

- It is the original project on which Canopy was based.
- It had approximately 1,688 stars and 87 forks.
- It was actively maintained and had released Jellyfin 12-compatible versions, including a release on 2026-08-23.
- Its current code did not contain Canopy's Interactive Search release picker or equivalent search/grab routes.
- It contains many unrelated enhancements that are unnecessary for this product.

Decision:

- Do not use Jellyfin Enhanced as the product base.
- Its stronger community does not compensate for needing to add a large feature inside an unrelated enhancement suite.

### A dedicated Jellyfin plugin

Official plugin documentation: <https://jellyfin.org/docs/general/server/plugins/>
Official template: <https://github.com/jellyfin/jellyfin-plugin-template>

Facts:

- Jellyfin supports server plugins, server APIs, scheduled tasks, and plugin web/configuration pages.
- Jellyfin 12 does not expose a stable native hook for adding arbitrary actions to an item detail menu.
- Canopy adds its item action by injecting a script into Jellyfin Web's `index.html` response through ASP.NET middleware. Its implementation documents the absence of a native injection hook: [ScriptInjectionStartupFilter.cs](https://github.com/4eh5xitv6787h645ebv/Jellyfin-Canopy/blob/main/Jellyfin.Plugin.JellyfinCanopy/Services/ScriptInjectionStartupFilter.cs).
- A similar injected action would mainly work in Jellyfin Web and clients embedding that web interface. Native clients would not automatically gain the UI.

Decision:

- A focused Jellyfin plugin is technically possible but should not be the core product.
- An optional Jellyfin adapter could later add an item-menu link to the independent application.
- The application must remain usable without Jellyfin UI injection.

### Seerr

Repository: <https://github.com/seerr-team/seerr>

Facts observed on 2026-08-25:

- Seerr had approximately 12,381 stars, 995 forks, several major contributors, active CI/security workflows, and frequent releases.
- Seerr does not currently expose a plugin or extension system.
- [Issue #2133](https://github.com/seerr-team/seerr/issues/2133) requested almost exactly the basic Interactive Search feature: show Sonarr/Radarr releases and let a user choose which one to grab.
- A maintainer closed #2133 as not planned and stated that download/file handling is outside Seerr's request-management scope.
- [Issue #1047](https://github.com/seerr-team/seerr/issues/1047) requests a per-request `Search Automatically` option. That narrower behavior remains open and has related implementation work.
- Seerr already has a global [Enable Automatic Search](https://docs.seerr.dev/using-seerr/settings/services/#enable-automatic-search-optional) option for Sonarr/Radarr services.
- Seerr supports [custom webhooks](https://docs.seerr.dev/using-seerr/notifications/webhook/) containing media and request data.
- Its contribution guide permits AI assistance but explicitly rejects primarily AI-generated or AI-driven contributions.

Decision:

- Do not propose a duplicate Interactive Search PR to Seerr.
- Do not maintain a Seerr fork for this feature.
- Do not add a Seerr integration to the first version merely because Seerr can emit webhooks.
- If a real workflow later requires instant handling of newly approved Seerr requests, add a small optional webhook adapter. Items already added by Seerr can otherwise be discovered directly in Sonarr/Radarr.

### Live subtitle-system observations motivating the product

Historical NAS snapshot from 2026-08-07; verify again before implementation because versions and provider state can change:

- Bazarr 1.6.0 was connected correctly to Sonarr and Radarr, with valid media path mappings.
- Seven configured providers reported healthy: Gestdown, Legendas.net, OpenSubtitles.com, SubDL, SubSource, Supersubtitles, and YIFY Subtitles.
- Corrected path mappings enabled successful PT-BR subtitle downloads, proving that the stack itself could work.
- Representative searches still produced zero PT-BR results for some titles despite healthy providers. Those cases were catalog gaps, not necessarily configuration failures.
- OpenSubtitles quota exhaustion had occurred during an earlier bulk search.
- Repeated provider connection resets appeared under heavier search pressure.
- A Sonarr/Radarr custom format named `PT-BR or Multi subtitles` was enabled with positive score `100`, matching PT-BR/Brazilian/BR and multi-sub release markers.
- Positive scoring was chosen instead of a hard requirement so otherwise usable releases would not be rejected.
- Subtitle sidecars were preserved with `srt,ass,ssa,sub` extra-file extensions.

These observations imply:

- Provider health does not guarantee catalog coverage.
- Aggressive per-release provider searches could exhaust quotas or cause throttling.
- The product needs caching, concurrency limits, targeted searches, and an explicit `Unknown` state.
- Release-name custom formats remain useful but are only one input to the decision.

## Final architectural decision

Build a standalone companion application with no mandatory integration beyond:

- Sonarr and/or Radarr
- Bazarr
- At least one supported subtitle-provider API

The browser communicates only with this application's backend. The backend owns all API credentials and performs all external calls.

```text
Browser
   |
   v
Pegarr API
   |-- Sonarr/Radarr: items, release search, release grab
   |-- Bazarr: language profiles and item/profile assignments
   `-- Subtitle providers: availability and release metadata
```

Optional future adapters:

```text
Jellyfin item action --------> opens the corresponding Pegarr item
Seerr webhook ---------------> marks a newly requested item for attention
Notifications ---------------> sends a link when manual selection is needed
```

None of the optional adapters may become a prerequisite for the core workflow.

## Proposed user experience

### Dashboard

Show:

- Missing monitored movies from Radarr
- Missing monitored episodes/seasons from Sonarr
- Items recently added without a file
- Items explicitly queued for manual release selection
- Items whose last search returned only uncertain subtitle matches

Filters:

- Application: Sonarr or Radarr
- Series/movie
- Language profile
- Missing required subtitle language
- Best subtitle confidence
- Search age/status

### Item page

Display:

- Title, year, season/episode, and external identifiers
- Sonarr/Radarr quality profile and monitored state
- Applicable Bazarr language profile and how it was resolved
- Last provider search time and quota/error state
- Interactive release results

Each release row should include existing *Arr data plus:

- Desired subtitle languages
- Best subtitle confidence
- Provider count
- Best matching subtitle release name
- Match explanation
- Provider search status
- Cached-at timestamp
- Grab button with confirmation

### Confidence levels

Recommended initial vocabulary:

- **Confirmed**: subtitle metadata names the same normalized release or has an equally strong release-specific identifier.
- **Likely**: media, episode, language, source, and major technical attributes match, but the exact release group is absent or differs.
- **Possible**: the language exists for the correct title/episode, but release compatibility is weak or unspecified.
- **No match found**: providers responded successfully and returned no acceptable candidate.
- **Unknown**: no supported provider, quota exhaustion, timeout, provider failure, unsupported profile, or incomplete identifiers.

The UI must always expose the evidence behind the label.

## Matching and scoring model

### Inputs from Sonarr/Radarr

- Internal item IDs
- IMDb, TMDb, and TVDb identifiers where available
- Series, season, and episode identity
- Release title
- Quality and source
- Resolution
- Codec and audio markers when parseable
- Release group
- Protocol
- Size and age
- Seeders/leechers when available
- Approval/download-allowed status
- Rejection reasons
- Custom-format score and matches
- Language and indexer flags returned by *Arr

Official Radarr API documentation confirms `GET /api/v3/release` and `POST /api/v3/release` for release search/grab behavior: <https://radarr.video/docs/api/>. Sonarr exposes the analogous release workflow. Exact request shapes must be generated or verified against the installed versions during the implementation spike.

### Inputs from Bazarr

- Available language profiles
- Default movie and series profiles
- Per-movie/per-series profile assignment when present
- Required, optional, fallback, forced, and hearing-impaired preferences when exposed
- Language codes and variants

Bazarr API details are version-sensitive. The implementation should discover and test the installed OpenAPI surface rather than assume undocumented endpoints. If an item has not reached Bazarr yet, use an explicitly configured movie/series default or display `Profile unresolved`; never silently assume PT-BR.

### Inputs from subtitle providers

At minimum:

- Media identifiers
- Language
- Movie or episode identity
- Subtitle release names
- Full-season-pack information
- Hearing-impaired/forced metadata when available
- Frame rate, source, and format when available
- Provider response and quota status

SubDL is a strong first direct adapter because its documented API supports IMDb/TMDb IDs, movie/TV type, season/episode, language filtering, release lists, full-season packs, and release filenames. Its current documentation states that free API keys receive 2,000 requests per day: <https://subdl.com/api-doc>.

OpenSubtitles is another candidate but requires a separate adapter with explicit rate-limit and account handling. Provider support must be added one adapter at a time and validated against current terms and quotas.

### Normalization

Normalize without destroying evidence:

- Case and punctuation
- Common aliases for WEB-DL/WEBRip/BluRay/HDTV
- Codec spellings such as H.264/x264 and H.265/x265/HEVC
- Release-group suffixes
- Season/episode and full-season notation
- Edition/cut markers
- Frame-rate markers
- Language aliases such as the provider-specific forms of Portuguese (Brazil)

Keep both the original string and normalized tokens so every decision is explainable.

### Suggested scoring

Do not reduce all state to one unexplained number. Use a structured result and calculate a sortable score only as a secondary presentation aid.

Possible evidence weights:

- Exact normalized release name: very strong
- Same release group plus source/resolution: strong
- Same media ID, episode, language, source, and frame rate: strong
- Same media ID, episode, and language only: moderate
- Full-season subtitle covering the requested episode: moderate to strong
- Conflicting edition/source/frame rate: penalty
- Wrong episode or season: hard rejection
- Missing desired language: hard rejection for that language result
- Provider timeout or quota failure: unknown, not a negative match

Video quality and subtitle confidence should remain separate columns. A combined recommended ordering may use:

1. *Arr download allowed
2. Subtitle confidence
3. *Arr custom-format score
4. Quality weight
5. Seeder availability
6. Age/size according to the user's selected sort

## API and component boundaries

### Arr adapter

Responsibilities:

- Connect to multiple Sonarr/Radarr instances
- Validate version and capabilities
- List relevant items
- Run bounded interactive searches
- Normalize release DTOs
- Grab a selected release
- Preserve rejection reasons and upstream errors

The Grab operation must be isolated, authenticated, confirmed, logged, and idempotent where possible.

### Bazarr policy adapter

Responsibilities:

- Read profiles and assignments
- Resolve the effective profile for an item
- Normalize language identifiers without changing meaning
- Refresh on configuration changes or a short cache TTL
- Report unresolved/unsupported policy honestly

This adapter should not attempt to reuse Bazarr's private internal Python provider objects remotely.

### Subtitle-provider adapter

Common interface:

```text
search(media identity, episode identity, desired languages, candidate release metadata)
    -> provider results + quota/error metadata
```

Every adapter must define:

- Authentication method
- Search capabilities
- Supported identifiers
- Release-name fidelity
- Rate limits and quotas
- Cache policy
- Timeout and retry policy
- Terms-of-service constraints
- Whether results may be stored and for how long

### Matching engine

The matching engine must be deterministic and provider-independent. Provider adapters return normalized evidence; the engine produces confidence, reasons, warnings, and a sortable score.

### Web application

Responsibilities:

- Authentication and authorization
- Dashboard and item selection
- Release table and evidence display
- Search progress and partial results
- Grab confirmation
- Search history and diagnostic status without exposing credentials

## Storage and configuration

Recommended deployment shape:

- One container
- One SQLite database for cache, history, and non-secret state
- Configuration through environment variables, secret files, or an encrypted settings store
- No API keys in browser storage, logs, URLs, or committed files
- Health and readiness endpoints
- Structured logs with secrets and private topology redacted

Suggested persisted data:

- Configured service identities and non-secret labels
- Item identity mappings
- Provider query cache and expiry
- Normalized match evidence
- Manual-selection history
- Grab audit entries
- Provider health/quota snapshots

Do not persist downloaded subtitle content in the first version.

## Security and operational requirements

- Default to read-only behavior; Grab is the only initial mutation.
- Restrict Grab to authorized administrators.
- Require confirmation containing the exact release title and target item.
- Use server-side API calls exclusively.
- Prevent arbitrary URL fetching through configuration validation and an explicit host allowlist.
- Bound response sizes, concurrent provider requests, retries, and total search duration.
- Add stable per-install request jitter for scheduled refreshes.
- Identify the application with a clear User-Agent where provider policies permit.
- Cache provider searches so sorting or refreshing the browser does not repeat external requests.
- Apply exponential backoff for `429`, transient network failures, and provider outages.
- Never convert an error into `No match found`.
- Redact API keys, authorization headers, subtitle download URLs containing tokens, and private internal hostnames from logs.
- Keep an audit trail for every Grab request and its result.

## Performance and quota model

A naive implementation could query every provider once for every video release. That is unacceptable.

Instead:

1. Search each provider once per media item, episode, language set, and stable query window.
2. Retrieve release-aware subtitle results in a bounded batch.
3. Match the returned subtitle candidates locally against all Sonarr/Radarr releases.
4. Cache the provider response with a provider-specific TTL.
5. Reuse it across users, sorting changes, and repeated views.

The implementation spike must quantify:

- Requests per item search
- Worst-case requests for a season
- Cache hit ratio
- Provider and total latency
- Memory and SQLite growth
- Behavior at free-tier quotas
- Behavior when one or every provider is unavailable

## Failure behavior

| Failure | Required behavior |
| --- | --- |
| Sonarr/Radarr unavailable | Disable search/grab for that instance; retain cached read-only results with a stale label |
| Bazarr unavailable | Show profile unresolved or last-known profile with timestamp; do not assume a language |
| One provider unavailable | Continue with partial results and identify the missing provider |
| All providers unavailable | Mark subtitle status Unknown |
| Provider quota exhausted | Show reset/quota information when available; do not retry aggressively |
| Release result changes before Grab | Revalidate the selected release and fail clearly if it is no longer valid |
| Grab times out | Query *Arr state before offering another attempt to reduce duplicate grabs |
| Item absent from Bazarr | Use an explicit configured default or require user selection |

## Implementation phases

### Phase 0: API feasibility spike

- Verify installed Sonarr, Radarr, and Bazarr versions.
- Export or inspect their current OpenAPI specifications.
- Prove Radarr movie release search and Grab against a harmless test target.
- Prove Sonarr episode and season release search and Grab against a harmless test target.
- Resolve Bazarr profile assignments for one movie and one series.
- Query SubDL for one movie and one episode using identifiers and desired language.
- Measure request counts and latency.
- Do not build the full UI until these contracts are proven.

Exit condition: one end-to-end read-only report can associate subtitle candidates with *Arr release rows. A live Grab is a separate explicitly confirmed validation.

### Phase 1: Read-only MVP

- Single Sonarr and Radarr instance support
- Bazarr profile discovery
- SubDL adapter
- Missing-item dashboard
- Interactive release table
- Deterministic confidence and explanations
- Cache, health status, and redacted logs
- No Grab action yet

### Phase 2: Controlled Grab

- Authenticated administrator access
- Release revalidation
- Confirmation dialog
- Sonarr/Radarr Grab
- Audit history
- Duplicate/timeout protection

### Phase 3: Reliability and more providers

- Multiple *Arr instances
- OpenSubtitles adapter
- Provider-specific rate limiting and quota display
- Quota-aware provider ordering with asymmetric positive, empty, and failure cache windows
- Season-pack matching
- Forced/hearing-impaired preferences
- Better release parsing and matching fixtures

### Phase 4: Optional workflow adapters

Only after real usage demonstrates the need:

- Jellyfin item-menu link
- Seerr request webhook
- Notifications containing a deep link
- Browser extension or userscript

The optional adapters should contain no matching logic.

## Testing strategy

### Contract fixtures

Store sanitized response fixtures for:

- Radarr movie releases
- Sonarr episode releases
- Sonarr full-season releases
- Bazarr profiles and assignments
- Each subtitle provider
- Quota, timeout, malformed response, and empty-result cases

### Deterministic matching tests

Cover:

- Exact release-group match
- Different group but same source/frame rate
- Movie editions and alternate cuts
- Full-season subtitle packs
- Anime absolute numbering
- Multi-episode files
- PT-BR language aliases
- Multi-language markers
- Forced and hearing-impaired preferences
- Provider disagreement
- Unknown caused by outage versus real no-result

### Integration tests

- Mocked Sonarr/Radarr/Bazarr/provider servers
- Authentication and redaction
- Cache and expiry behavior
- Concurrency and retry bounds
- Grab idempotency and timeout reconciliation

### Browser tests

- Search and partial-progress rendering
- Sorting without new provider requests
- Evidence/details expansion
- Grab confirmation
- Accessible keyboard navigation and status announcements
- Mobile-sized layout

## Non-goals for the first release

- Replacing Sonarr/Radarr indexers or quality profiles
- Replacing Bazarr subtitle downloads or synchronization
- Automatically grabbing the highest-scored release
- Downloading or translating subtitles
- Managing qBittorrent directly
- Becoming a Jellyfin enhancement suite
- Becoming a Seerr fork or plugin
- Hardcoding PT-BR
- Promising that a pre-download subtitle match will synchronize perfectly
- Supporting every Bazarr provider through undocumented internal APIs

## Open questions

- Does the installed Bazarr version expose stable profile-assignment endpoints suitable for this use?
- What profile should apply before Bazarr has synchronized a newly added movie or series?
- Should a missing required language suppress the recommendation or only lower it?
- How should fallback languages affect the confidence label?
- Which exact release properties are reliable across both Sonarr and Radarr versions?
- How well do SubDL and OpenSubtitles release names correspond to the indexer release names seen in the live library?
- Is a full-season selection required in the MVP, or can the first version focus on movies and episodes?
- Should the app list all monitored missing items or require an explicit manual-selection tag?
- Which authentication boundary will be used on the NAS: application login, reverse-proxy authentication, or private-network access plus an application token?
- Which implementation stack best balances a small container with fast UI development?

## Implementation stack options

No language decision is required before the API spike.

### TypeScript backend plus React/Vite

Advantages:

- One language across API types and UI
- Good fit for a release-table interface
- Easy OpenAPI client generation
- Familiar patterns available from Seerr research without depending on Seerr

Tradeoff: a larger runtime and container than a compiled single binary.

### Go backend plus a small web UI

Advantages:

- Small runtime footprint and simple container deployment
- Strong concurrency primitives for bounded provider calls
- Easy single-binary distribution with embedded static assets

Tradeoff: more manual modeling and UI/build integration.

### .NET backend plus a small web UI

Advantages:

- Natural ecosystem fit with Sonarr/Radarr
- Strong typed HTTP clients and background-service support
- Potential reuse of architectural knowledge from Canopy without copying its code

Tradeoff: larger runtime footprint than Go and a separate frontend build remains likely.

Provisional recommendation: use TypeScript for the feasibility spike and MVP unless NAS resource measurements justify Go. Keep provider and *Arr contracts isolated so the implementation language can change without changing product semantics.

## Naming research

The name should communicate selection, release quality, or subtitle readiness while fitting the *Arr ecosystem.

Names found already in use on GitHub during the 2026-08-25 check:

- Siftarr
- Pickarr
- Selectarr
- Releasarr
- Matcharr
- Grabarr
- Subarr
- Inspectarr
- Scorarr
- Decidarr
- Curatarr

Candidates with no obvious exact GitHub repository-name collision during that check:

| Candidate | Meaning | Concern |
| --- | --- | --- |
| **Pegarr** | Portuguese `pegar`—to get, fetch, or grab—plus the *Arr naming pattern | Meaning needs a tagline for non-Portuguese speakers |
| **Qualarr** | Quality + *Arr; also evokes Portuguese `qual?`/“which one?” | Does not explicitly say subtitles |
| **Availarr** | Availability + *Arr | Could be mistaken for general media availability |
| **Captionarr** | Captions/subtitles + *Arr | “Captions” is not identical to subtitles in every language |
| **Subpickarr** | Subtitle-aware picking | Precise but awkward to pronounce |
| **Submatcharr** | Match subtitles to releases | Descriptive but long |
| **Verifarr** | Verify a release before grabbing | Broad and slightly abstract |
| **Releasearr** | Release selection | Easily confused with the existing `Releasarr` name |

### Selected name: Pegarr

Why:

- In Portuguese, `pegar` naturally means to get, fetch, or grab.
- Grab is the exact final action Pegarr asks Sonarr or Radarr to perform after the user chooses a release.
- The additional `r` connects the word naturally to the *Arr ecosystem.
- It is short, distinctive, and pronounceable as “pe-GARR.”
- It does not lock the product to PT-BR or a single subtitle provider.
- It describes the action without claiming to replace Sonarr/Radarr quality profiles or Bazarr.
- It preserves the product's Portuguese origin while remaining usable internationally with a clear tagline.

Recommended tagline:

> **Pegarr — Subtitle-aware release selection for Sonarr and Radarr.**

Suggested description:

> Pegarr is a self-hosted, subtitle-aware release selector for Sonarr and Radarr. It reads language policy from Bazarr, checks supported subtitle providers, explains match confidence, and lets an authorized user grab the best-informed release.

Suggested project identifiers:

- Product: `Pegarr`
- Repository: `pegarr`
- Container: `ghcr.io/<owner>/pegarr`
- Default executable/service name: `pegarr`

No exact GitHub software repository named `Pegarr` was found during the 2026-08-25 collision check. The `pegarr` GitHub username is occupied, but that does not prevent using `pegarr` as a repository name under another user or organization.

Before publishing, also check organization names, container registries, package registries, domains, and trademarks. The GitHub search is only an initial collision check.

## Recommended next decision

Create a clean standalone Pegarr repository and perform only Phase 0. The feasibility spike should answer the uncertain API and matching questions before committing to a frontend framework or full product build.

## Primary research links

- Canopy repository: <https://github.com/4eh5xitv6787h645ebv/Jellyfin-Canopy>
- Canopy Interactive Search PR: <https://github.com/4eh5xitv6787h645ebv/Jellyfin-Canopy/pull/17>
- Canopy contribution guide: <https://github.com/4eh5xitv6787h645ebv/Jellyfin-Canopy/blob/main/CONTRIBUTING.md>
- Canopy script injection: <https://github.com/4eh5xitv6787h645ebv/Jellyfin-Canopy/blob/main/Jellyfin.Plugin.JellyfinCanopy/Services/ScriptInjectionStartupFilter.cs>
- Jellyfin Enhanced: <https://github.com/n00bcodr/Jellyfin-Enhanced>
- Jellyfin plugin documentation: <https://jellyfin.org/docs/general/server/plugins/>
- Jellyfin plugin template: <https://github.com/jellyfin/jellyfin-plugin-template>
- Seerr repository: <https://github.com/seerr-team/seerr>
- Seerr Interactive Search rejection: <https://github.com/seerr-team/seerr/issues/2133>
- Seerr per-request automatic-search request: <https://github.com/seerr-team/seerr/issues/1047>
- Seerr contribution guide: <https://github.com/seerr-team/seerr/blob/develop/CONTRIBUTING.md>
- Seerr service settings: <https://docs.seerr.dev/using-seerr/settings/services/>
- Seerr webhooks: <https://docs.seerr.dev/using-seerr/notifications/webhook/>
- Radarr API: <https://radarr.video/docs/api/>
- SubDL API: <https://subdl.com/api-doc>
