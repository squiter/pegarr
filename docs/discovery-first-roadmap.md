# Discovery-first product roadmap

This roadmap is Pegarr's highest-priority product work. It corrects the original implementation sequence: the missing-library dashboard is a useful secondary workflow, but it is not the primary product experience.

## Product promise

Pegarr is the place where a person can:

1. search the Sonarr or Radarr catalog for a series or movie that has not been added yet;
2. see whether the configured subtitle policy is likely to be satisfiable before committing to that title;
3. select the title in Pegarr and have Pegarr add it to the appropriate Arr application;
4. inspect the exact Arr release candidates, with subtitle evidence and Arr rejection reasons preserved;
5. explicitly select the release to Grab without opening Sonarr or Radarr.

The existing missing-item workflow remains supported, but it must not be the landing-page purpose or the only way into release analysis.

## P0 requirements

### Catalog discovery

- Search every configured Sonarr and Radarr instance through their supported lookup APIs.
- Return display-safe title, year, media kind, stable provider identifiers, and whether the title is already present.
- Keep catalog search authenticated, bounded, cache-safe, and read-only.
- Never expose Arr API keys, filesystem paths, private hostnames, or complete upstream objects to the browser.

### Subtitle policy and provider settings

- Provide an authenticated settings page for choosing the desired subtitle languages and preferences.
- Show which policy source is active: Bazarr profile, explicit Pegarr default, or unresolved.
- Allow subtitle-provider credentials and language mappings to be configured from the UI.
- Accept secrets only over an authenticated same-origin request, store them server-side with restricted permissions or encryption, and return only configured/not-configured state. Never return a stored secret to the browser.
- Distinguish no result from provider failure, timeout, and quota exhaustion everywhere.

### Add to Sonarr or Radarr

- A title selected in Pegarr must be addable to the selected Arr instance without requiring the user to repeat the action in Sonarr or Radarr.
- The UI must collect or expose the required root folder, quality profile, monitoring, and availability choices before the mutation.
- Adding is a separate authenticated and explicitly enabled mutation. The default installation remains read-only.
- Pegarr must add with Sonarr/Radarr automatic search disabled. Selecting a title adds the catalog record; it does not silently choose or download a video release.
- Pegarr must re-read the returned Arr identity before continuing.

### Exact release selection

Sonarr and Radarr's supported interactive-release APIs require an internal episode, series, or movie ID. They do not provide exact arbitrary-title release search through the catalog lookup endpoint. Therefore the seamless Pegarr workflow is:

```text
catalog lookup
  -> pre-add title/season/episode subtitle-coverage preview
  -> explicit add to Arr with automatic search disabled
  -> Arr returns internal IDs
  -> exact interactive release search
  -> subtitle evidence matched to each exact release
  -> explicit user-selected Grab
```

This is one Pegarr workflow; the user does not need to visit the Arr UI. Exact pre-add release enumeration would require a separate indexer integration such as Prowlarr, which is outside the current core boundary and must not be implied by the UI.

### Username and password login

- Replace the access-token prompt with a conventional Pegarr username/password form.
- Credentials remain server-owned configuration and must never enter URLs, logs, committed files, or browser storage.
- The target design uses a short-lived server-side session in an `HttpOnly`, `SameSite=Strict`, `Secure` cookie when served over HTTPS, with logout and bounded expiry.
- Keep bearer-token compatibility during migration for API clients and existing installations.
- Administrator mutations require an explicit authorization capability beyond ordinary browsing access.

## Ordered delivery slices

1. **Authentication and catalog foundation:** username/password-compatible access boundary, authenticated Sonarr/Radarr catalog lookup, sanitized results, and discovery-first dashboard entry point.
2. **Policy preview:** explicit default subtitle policy plus provider-backed title/season/episode coverage before add, with honest Unknown states.
3. **Server-side settings:** authenticated settings UI and durable secret-safe storage for Arr defaults, Bazarr policy selection, and provider credentials.
4. **Add and continue:** explicitly enabled add-to-Arr action with automatic search disabled, followed by exact release analysis in Pegarr.
5. **Session hardening and onboarding:** cookie sessions, logout/expiry, first-run setup, role separation, and migration away from the token-first screen.
6. **Release-candidate acceptance:** resume the local/live validation work described in the previous release-candidate roadmap.

## Implementation status

- Completed locally: username/password-compatible authentication, sanitized multi-instance catalog lookup, discovery-first dashboard, persistent explicit default language policy, secret-safe SubDL/OpenSubtitles credential and mapping entry, immediate UI-configured provider use, title-level pre-add coverage preview, opt-in explicit add-to-Arr with server-owned defaults and automatic search forced off, created-record identity verification, automatic Radarr exact analysis, and Sonarr season/episode scope selection into exact analysis.
- Next: connect continuation release rows to the existing controlled-Grab preparation boundary without bypassing its independent administrator authorization, revalidation, confirmation, or audit semantics.
- Not yet implemented: automatic-search suppression verification against live Arr, richer forced/hearing-impaired policy controls, cookie sessions, and controlled-Grab preparation from continuation-scoped release rows. Neither continuation can silently Grab.

Every behavior change must have a stable scenario in `harness/manifest.json`. Synthetic tests must never mutate a live Sonarr or Radarr instance, and no automated test may execute a live Grab.

## Acceptance criteria for the first complete experience

- A new user signs in with a Pegarr username and password.
- Searching for a title absent from the library returns sanitized Sonarr/Radarr catalog results.
- Pegarr shows the desired subtitle languages and title-level or episode-level availability with provider health.
- The user can choose an Arr instance and its required add options, then confirm the add in Pegarr.
- Sonarr/Radarr automatic search is disabled for that add.
- Pegarr continues to exact release analysis after receiving the Arr identity.
- The user can explicitly Grab one release through the existing controlled flow.
- At no point must the user open Sonarr or Radarr, and at no point may Pegarr silently add or Grab content.
