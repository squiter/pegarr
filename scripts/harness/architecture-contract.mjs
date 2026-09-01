import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { failContract, readJson, repoRoot } from "./lib.mjs";

const issues = [];
const coreImports = {
  "src/domain.ts": [],
  "src/normalization.ts": ["./domain.js"],
  "src/matching.ts": ["./domain.js", "./normalization.js"],
};
const adapterImports = {
  "src/adapters/http.ts": [],
  "src/adapters/fetch-json-transport.ts": ["./http.js"],
  "src/adapters/arr-add.ts": ["../domain.js"],
  "src/adapters/sonarr.ts": ["node:crypto", "../domain.js", "./arr-add.js", "./http.js"],
  "src/adapters/radarr.ts": ["node:crypto", "../domain.js", "./arr-add.js", "./http.js"],
  "src/adapters/bazarr.ts": ["../domain.js", "./http.js"],
  "src/adapters/subdl.ts": ["node:crypto", "../domain.js", "./http.js"],
  "src/adapters/opensubtitles.ts": ["node:crypto", "../domain.js", "./http.js"],
};

for (const [file, allowedImports] of Object.entries(coreImports)) {
  const content = readFileSync(resolve(repoRoot, file), "utf8");
  const imports = [...content.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/gu)].map(
    (match) => match[1],
  );
  for (const imported of imports) {
    if (imported.startsWith("node:")) {
      issues.push(`${file} core logic may not depend on Node runtime module ${imported}`);
    } else if (!allowedImports.includes(imported)) {
      issues.push(`${file} imports ${imported}; allowed core imports: ${allowedImports.join(", ") || "none"}`);
    }
  }
}

for (const [file, allowedImports] of Object.entries(adapterImports)) {
  const content = readFileSync(resolve(repoRoot, file), "utf8");
  const imports = [...content.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/gu)].map(
    (match) => match[1],
  );
  for (const imported of imports) {
    if (!allowedImports.includes(imported)) {
      issues.push(
        `${file} imports ${imported}; allowed adapter imports: ${allowedImports.join(", ") || "none"}`,
      );
    }
  }
}

const sonarrAdapter = readFileSync(resolve(repoRoot, "src/adapters/sonarr.ts"), "utf8");
if (
  !sonarrAdapter.includes('method: "GET"') ||
  !sonarrAdapter.includes("revalidateEpisodeRelease") ||
  !sonarrAdapter.includes("grabRelease(handle: ArrReleaseHandle)") ||
  !sonarrAdapter.includes("addCatalogSeries") ||
  !sonarrAdapter.includes('path: "/api/v3/series"') ||
  !sonarrAdapter.includes("searchForMissingEpisodes: false") ||
  !sonarrAdapter.includes("searchForCutoffUnmetEpisodes: false") ||
  !sonarrAdapter.includes('path: `/api/v3/series/${itemId}`') ||
  !sonarrAdapter.includes('"verification_unknown"') ||
  !sonarrAdapter.includes("readSeriesReleaseScopes") ||
  !sonarrAdapter.includes("revalidateSeasonRelease") ||
  !sonarrAdapter.includes('path: "/api/v3/episode"') ||
  !sonarrAdapter.includes('method: "POST"') ||
  !sonarrAdapter.includes("body: normalized") ||
  (sonarrAdapter.match(/method: "POST"/gu) ?? []).length !== 2 ||
  /method: "(?:PUT|PATCH|DELETE)"/u.test(sonarrAdapter)
) {
  issues.push("The Sonarr adapter must retain only the explicit no-search catalog add and revalidated Grab boundaries");
}

const radarrAdapter = readFileSync(resolve(repoRoot, "src/adapters/radarr.ts"), "utf8");
if (
  !radarrAdapter.includes('method: "GET"') ||
  !radarrAdapter.includes("revalidateMovieRelease") ||
  !radarrAdapter.includes("grabRelease(handle: ArrReleaseHandle)") ||
  !radarrAdapter.includes("addCatalogMovie") ||
  !radarrAdapter.includes('path: "/api/v3/movie"') ||
  !radarrAdapter.includes("searchForMovie: false") ||
  !radarrAdapter.includes('addMethod: "manual"') ||
  !radarrAdapter.includes('path: `/api/v3/movie/${itemId}`') ||
  !radarrAdapter.includes('"verification_unknown"') ||
  !radarrAdapter.includes('method: "POST"') ||
  !radarrAdapter.includes("body: normalized") ||
  (radarrAdapter.match(/method: "POST"/gu) ?? []).length !== 2 ||
  /method: "(?:PUT|PATCH|DELETE)"/u.test(radarrAdapter)
) {
  issues.push("The Radarr adapter must retain only the explicit no-search catalog add and revalidated Grab boundaries");
}

const bazarrAdapter = readFileSync(resolve(repoRoot, "src/adapters/bazarr.ts"), "utf8");
if (
  !bazarrAdapter.includes('method: "GET"') ||
  bazarrAdapter.includes('method: "POST"') ||
  bazarrAdapter.includes('method: "PATCH"') ||
  bazarrAdapter.includes('method: "DELETE"')
) {
  issues.push("The Phase 0 Bazarr adapter must remain read-only");
}

const subdlAdapter = readFileSync(resolve(repoRoot, "src/adapters/subdl.ts"), "utf8");
if (
  !subdlAdapter.includes('method: "GET"') ||
  subdlAdapter.includes('method: "POST"') ||
  subdlAdapter.includes('/download')
) {
  issues.push("The Phase 0 SubDL adapter must remain search-only and read-only");
}

const opensubtitlesAdapter = readFileSync(resolve(repoRoot, "src/adapters/opensubtitles.ts"), "utf8");
if (
  !opensubtitlesAdapter.includes('method: "GET"') ||
  opensubtitlesAdapter.includes('method: "POST"') ||
  opensubtitlesAdapter.includes('/download') ||
  opensubtitlesAdapter.includes('/login')
) {
  issues.push("The OpenSubtitles adapter must remain search-only and read-only");
}
for (const contract of ['"api-key": this.#apiKey', '"user-agent": this.#userAgent', 'path: "/subtitles"']) {
  if (!opensubtitlesAdapter.includes(contract)) {
    issues.push(`The OpenSubtitles adapter must retain ${contract}`);
  }
}
if (/authorization:\s*`Bearer/u.test(opensubtitlesAdapter) || /file_id/u.test(opensubtitlesAdapter)) {
  issues.push("OpenSubtitles search must not retain user tokens or download handles");
}
if (!subdlAdapter.includes("authorization: `Bearer ${this.#apiKey}`") || /api_key/u.test(subdlAdapter)) {
  issues.push("The SubDL API key must remain in the authorization header and out of URLs");
}
for (const contract of ['status: "hit"', 'status: "miss"', 'value.status !== "success"']) {
  if (!subdlAdapter.includes(contract)) {
    issues.push(`The SubDL memory cache must retain ${contract}`);
  }
}
for (const contract of ["episodeRange", "episode_from", "episode_end", "episodeNumbers", "optionalFrameRate"]) {
  if (!subdlAdapter.includes(contract)) {
    issues.push(`The SubDL evidence mapper must retain ${contract}`);
  }
}

const normalization = readFileSync(resolve(repoRoot, "src/normalization.ts"), "utf8");
for (const contract of ["canonicalEpisodeNotation", "inferEdition", "inferFrameRate"]) {
  if (!normalization.includes(contract)) {
    issues.push(`Release normalization must retain ${contract}`);
  }
}

const providerCache = readFileSync(resolve(repoRoot, "src/provider-search-cache.ts"), "utf8");
for (const contract of [
  'result.status !== "success"',
  'createHash("sha256")',
  "maximumPayloadBytes",
  'status: "hit"',
  'status: "miss"',
  "#positiveTtlMs",
  "#emptyTtlMs",
  "result.subtitles.length > 0",
]) {
  if (!providerCache.includes(contract)) {
    issues.push(`The provider cache must retain ${contract}`);
  }
}

const providerPlanner = readFileSync(resolve(repoRoot, "src/provider-policy-search.ts"), "utf8");
for (const contract of [
  'tier === "fallback"',
  "release.downloadAllowed",
  "assessLanguage",
  'minimumConfidence ?? "likely"',
  'result.cache?.status !== "hit"',
]) {
  if (!providerPlanner.includes(contract)) {
    issues.push(`The provider planner must retain ${contract}`);
  }
}
if (/\b(?:apiKey|authorization|downloadUrl)\b/u.test(providerCache)) {
  issues.push("The provider cache must not persist credentials or provider download handles");
}

const episodeFlow = readFileSync(resolve(repoRoot, "src/episode-feasibility.ts"), "utf8");
if (
  !episodeFlow.includes("searchEpisodeReleases") ||
  !episodeFlow.includes("readSeriesAssignment") ||
  !episodeFlow.includes("listLanguageProfiles") ||
  /\b(?:grab|download|delete)\b/iu.test(episodeFlow)
) {
  issues.push("The Phase 0 episode feasibility flow must compose only read and search operations");
}

const movieFlow = readFileSync(resolve(repoRoot, "src/movie-feasibility.ts"), "utf8");
if (
  !movieFlow.includes("searchMovieReleases") ||
  !movieFlow.includes("readMovieAssignment") ||
  !movieFlow.includes("listLanguageProfiles") ||
  /\b(?:grab|download|delete)\b/iu.test(movieFlow)
) {
  issues.push("The Phase 0 movie feasibility flow must compose only read and search operations");
}

const seasonFlow = readFileSync(resolve(repoRoot, "src/season-feasibility.ts"), "utf8");
if (
  !seasonFlow.includes("searchSeasonReleases") ||
  !seasonFlow.includes("readSeriesAssignment") ||
  !seasonFlow.includes("listLanguageProfiles") ||
  /\b(?:grab|download|delete)\b/iu.test(seasonFlow)
) {
  issues.push("The Phase 0 season feasibility flow must compose only read and search operations");
}

const fetchTransport = readFileSync(
  resolve(repoRoot, "src/adapters/fetch-json-transport.ts"),
  "utf8",
);
for (const contract of [
  'redirect: "error"',
  'credentials: "omit"',
  'cache: "no-store"',
  'referrerPolicy: "no-referrer"',
]) {
  if (!fetchTransport.includes(contract)) {
    issues.push(`The HTTP transport must retain ${contract}`);
  }
}

const configuration = readFileSync(resolve(repoRoot, "src/config.ts"), "utf8");
for (const contract of [
  'prefix: "PEGARR_SONARR"',
  'prefix: "PEGARR_RADARR"',
  'prefix: "PEGARR_BAZARR"',
  'prefix: "PEGARR_SUBDL"',
  'prefix: "PEGARR_OPENSUBTITLES"',
  '`${spec.prefix}_API_KEY_FILE`',
  "maximumSecretBytes = 4_096",
  'return "[redacted]"',
  "PEGARR_ACCESS_TOKEN_FILE",
  "PEGARR_SUBDL_LANGUAGE_MAPPINGS",
  "PEGARR_OPENSUBTITLES_LANGUAGE_MAPPINGS",
  "PEGARR_GRAB_ENABLED",
  "PEGARR_ADMIN_TOKEN_FILE",
  "PEGARR_GRAB_AUDIT_FILE",
  "configuredSonarrInstances",
  "configuredRadarrInstances",
  "_INSTANCES_FILE",
]) {
  if (!configuration.includes(contract)) {
    issues.push(`The runtime configuration must retain ${contract}`);
  }
}

const accessControl = readFileSync(resolve(repoRoot, "src/access-control.ts"), "utf8");
for (const contract of ['createHash("sha256")', "timingSafeEqual", "authorization.slice(7)"]) {
  if (!accessControl.includes(contract)) {
    issues.push(`The API access boundary must retain ${contract}`);
  }
}

const sessionStore = readFileSync(resolve(repoRoot, "src/session-store.ts"), "utf8");
for (const contract of ["randomBytes(32)", "createHash(\"sha256\")", "timingSafeEqual", "#prune(now)", "maxSessions", "csrfDigest"]) {
  if (!sessionStore.includes(contract)) issues.push(`The bounded session store must retain ${contract}`);
}

const grabAudit = readFileSync(resolve(repoRoot, "src/grab-audit.ts"), "utf8");
for (const contract of ["'episode', 'movie', 'season'", "season_number", "grab_audit_before_seasons"]) {
  if (!grabAudit.includes(contract)) issues.push(`The controlled Grab audit must retain season identity contract ${contract}`);
}

const dashboardClient = readFileSync(resolve(repoRoot, "src/web/dashboard.js"), "utf8");
for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "innerHTML"]) {
  if (dashboardClient.includes(forbidden)) {
    issues.push(`The dashboard client may not use ${forbidden}`);
  }
}
for (const contract of [
  "libraryHeaders",
  "sessionCsrfToken",
  'fetch("/api/v1/session/login"',
  'fetch("/api/v1/session"',
  'credentials: "same-origin"',
  'libraryAuthorization = `Bearer ${legacyToken}`',
  'credentials: "omit"',
  "replaceChildren",
  "textContent",
  "loadCatalogContinuationAnalysis",
  "loadCatalogSeriesScopes",
  "loadOnboarding",
  'fetch("/api/v1/onboarding"',
  'access.role === "legacy_read_only"',
  'access.controlledGrab === "administrator_token_required"',
  "subtitleLanguageRequirements",
  "renderSubtitleLanguagePreferences",
  "Forced subtitles only",
  "Hearing-impaired subtitles",
  "/api/v1/catalog/continuations/",
]) {
  if (!dashboardClient.includes(contract)) {
    issues.push(`The dashboard client must retain ${contract}`);
  }
}

const accessCompose = readFileSync(resolve(repoRoot, "deploy/compose.access.yaml"), "utf8");
if (!accessCompose.includes("PEGARR_ACCESS_TOKEN_FILE: /run/secrets/pegarr_access_token")) {
  issues.push("The access Compose overlay must mount the bearer token through a secret file");
}

const loginCompose = readFileSync(resolve(repoRoot, "deploy/compose.login.yaml"), "utf8");
for (const contract of [
  "PEGARR_USERNAME:",
  "PEGARR_PASSWORD_FILE: /run/secrets/pegarr_password",
  "PEGARR_SESSION_COOKIE_SECURE:",
  "pegarr_password:",
]) {
  if (!loginCompose.includes(contract)) issues.push(`The login Compose overlay must retain ${contract}`);
}
if (/PEGARR_PASSWORD\s*:/u.test(loginCompose)) {
  issues.push("The login Compose overlay may not pass the password as an environment value");
}
if (/PEGARR_ACCESS_TOKEN\s*:/u.test(accessCompose)) {
  issues.push("The access Compose overlay may not pass the bearer token as an environment value");
}

const grabCompose = readFileSync(resolve(repoRoot, "deploy/compose.grab.yaml"), "utf8");
for (const contract of [
  'PEGARR_GRAB_ENABLED: "true"',
  "PEGARR_ADMIN_TOKEN_FILE: /run/secrets/pegarr_admin_token",
  "PEGARR_GRAB_AUDIT_FILE: /data/grab-audit.sqlite",
]) {
  if (!grabCompose.includes(contract)) issues.push(`The controlled Grab Compose overlay must retain ${contract}`);
}
if (/PEGARR_ADMIN_TOKEN\s*:/u.test(grabCompose)) {
  issues.push("The controlled Grab Compose overlay may not pass the administrator token as an environment value");
}

const sonarrCompose = readFileSync(resolve(repoRoot, "deploy/compose.sonarr.yaml"), "utf8");
if (!sonarrCompose.includes("PEGARR_SONARR_API_KEY_FILE: /run/secrets/sonarr_api_key")) {
  issues.push("The Sonarr Compose overlay must mount the API key through a secret file");
}
if (/PEGARR_SONARR_API_KEY\s*:/u.test(sonarrCompose)) {
  issues.push("The Sonarr Compose overlay may not pass the API key as an environment value");
}

const radarrCompose = readFileSync(resolve(repoRoot, "deploy/compose.radarr.yaml"), "utf8");
if (!radarrCompose.includes("PEGARR_RADARR_API_KEY_FILE: /run/secrets/radarr_api_key")) {
  issues.push("The Radarr Compose overlay must mount the API key through a secret file");
}

const bazarrCompose = readFileSync(resolve(repoRoot, "deploy/compose.bazarr.yaml"), "utf8");
if (!bazarrCompose.includes("PEGARR_BAZARR_API_KEY_FILE: /run/secrets/bazarr_api_key")) {
  issues.push("The Bazarr Compose overlay must mount the API key through a secret file");
}
if (/PEGARR_BAZARR_API_KEY\s*:/u.test(bazarrCompose)) {
  issues.push("The Bazarr Compose overlay may not pass the API key as an environment value");
}
const subdlCompose = readFileSync(resolve(repoRoot, "deploy/compose.subdl.yaml"), "utf8");
if (!subdlCompose.includes("PEGARR_SUBDL_API_KEY_FILE: /run/secrets/subdl_api_key")) {
  issues.push("The SubDL Compose overlay must mount the API key through a secret file");
}
const opensubtitlesCompose = readFileSync(resolve(repoRoot, "deploy/compose.opensubtitles.yaml"), "utf8");
if (!opensubtitlesCompose.includes("PEGARR_OPENSUBTITLES_API_KEY_FILE: /run/secrets/opensubtitles_api_key")) {
  issues.push("The OpenSubtitles Compose overlay must mount the API key through a secret file");
}
if (/PEGARR_OPENSUBTITLES_API_KEY\s*:/u.test(opensubtitlesCompose)) {
  issues.push("The OpenSubtitles Compose overlay may not pass the API key as an environment value");
}
if (/PEGARR_SUBDL_API_KEY\s*:/u.test(subdlCompose)) {
  issues.push("The SubDL Compose overlay may not pass the API key as an environment value");
}
if (/PEGARR_RADARR_API_KEY\s*:/u.test(radarrCompose)) {
  issues.push("The Radarr Compose overlay may not pass the API key as an environment value");
}

const portainerCompose = readFileSync(resolve(repoRoot, "deploy/compose.portainer-jellyfin.yaml"), "utf8");
const portainerScenario = "PEG-PORTAINER-001";
for (const contract of [
  "PEGARR_IMAGE:?set PEGARR_IMAGE to the validated immutable Pegarr digest",
  "PEGARR_PASSWORD_FILE: /data/password",
  "PEGARR_SESSION_COOKIE_SECURE:",
  "PEGARR_SONARR_APP_CONFIG_FILE: /run/upstream/sonarr-config.xml",
  "PEGARR_RADARR_APP_CONFIG_FILE: /run/upstream/radarr-config.xml",
  "PEGARR_BAZARR_APP_CONFIG_FILE: /run/upstream/bazarr-config.yaml",
  "PEGARR_ADD_ENABLED: ${PEGARR_ADD_ENABLED:-false}",
  "pegarr-data:/data",
  "read_only: true",
  "cap_drop:",
  "no-new-privileges:true",
  "external: true",
]) {
  if (!portainerCompose.includes(contract)) {
    issues.push(`${portainerScenario} Portainer overlay must retain ${contract}`);
  }
}
if (/PEGARR_(?:SONARR|RADARR|BAZARR)_API_KEY_FILE|<ApiKey>|apikey\s*:/iu.test(portainerCompose)) {
  issues.push(`${portainerScenario} Portainer overlay must use native application-config loading without extracting API keys`);
}

const nasCompose = readFileSync(resolve(repoRoot, "deploy/compose.nas.yaml"), "utf8");
for (const contract of [
  "PEGARR_PROVIDER_CACHE_POSITIVE_TTL_SECONDS",
  "PEGARR_PROVIDER_CACHE_EMPTY_TTL_SECONDS",
]) {
  if (!nasCompose.includes(contract)) issues.push(`The NAS provider cache must retain ${contract}`);
}

for (const [integration, file] of [["Sonarr", "deploy/compose.sonarr-instances.yaml"], ["Radarr", "deploy/compose.radarr-instances.yaml"]]) {
  const compose = readFileSync(resolve(repoRoot, file), "utf8");
  const upper = integration.toUpperCase();
  for (const contract of [`PEGARR_${upper}_INSTANCES_FILE`, ":/run/pegarr/", `:/run/secrets/${integration.toLowerCase()}:ro`]) {
    if (!compose.includes(contract)) issues.push(`${integration} multi-instance Compose must retain ${contract}`);
  }
  if (/API_KEY\s*:/u.test(compose)) issues.push(`${integration} multi-instance Compose may not pass API keys as environment values`);
}

const packageJson = readJson("package.json");
const runtimeDependencies = Object.keys(packageJson.dependencies ?? {});
for (const dependency of runtimeDependencies) {
  if (/(?:jellyfin|seerr|qbittorrent|bazarr)/iu.test(dependency)) {
    issues.push(`forbidden core runtime dependency: ${dependency}`);
  }
}

const requiredHarnessScripts = {
  check: "node scripts/harness/run-checks.mjs full",
  "check:fast": "node scripts/harness/run-checks.mjs fast",
  "check:affected": "node scripts/harness/run-checks.mjs affected",
};
for (const [name, command] of Object.entries(requiredHarnessScripts)) {
  if (packageJson.scripts?.[name] !== command) {
    issues.push(`package.json script ${name} must remain ${command}`);
  }
}

if (packageJson.scripts?.["probe:sonarr"] !== "node dist/probe-sonarr.js") {
  issues.push("package.json script probe:sonarr must remain the read-only packaged probe");
}
if (packageJson.scripts?.["probe:radarr"] !== "node dist/probe-radarr.js") {
  issues.push("package.json script probe:radarr must remain the read-only packaged probe");
}
if (packageJson.scripts?.["probe:bazarr"] !== "node dist/probe-bazarr.js") {
  issues.push("package.json script probe:bazarr must remain the read-only packaged probe");
}
if (packageJson.scripts?.["probe:subdl"] !== "node dist/probe-subdl.js") {
  issues.push("package.json script probe:subdl must remain the read-only packaged probe");
}
if (packageJson.scripts?.["report:sonarr-episode"] !== "node dist/report-sonarr-episode.js") {
  issues.push("package.json script report:sonarr-episode must remain the read-only packaged report");
}
if (packageJson.scripts?.["report:radarr-movie"] !== "node dist/report-radarr-movie.js") {
  issues.push("package.json script report:radarr-movie must remain the read-only packaged report");
}
if (packageJson.scripts?.["report:sonarr-season"] !== "node dist/report-sonarr-season.js") {
  issues.push("package.json script report:sonarr-season must remain the read-only packaged report");
}
if (packageJson.scripts?.["inventory:missing"] !== "node dist/inventory-missing.js") {
  issues.push("package.json script inventory:missing must remain the read-only packaged inventory");
}

const missingInventory = readFileSync(resolve(repoRoot, "src/inventory-missing.ts"), "utf8");
if (
  !missingInventory.includes("listMissingEpisodes") ||
  !missingInventory.includes("listMissingMovies") ||
  /\b(?:grab|download|delete|update)\b/iu.test(missingInventory)
) {
  issues.push("The missing-item inventory must compose only bounded read operations");
}

const ciWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
if (!ciWorkflow.includes("run: npm run check")) {
  issues.push("CI must run the full harness completion gate");
}
if (!ciWorkflow.includes("path: .artifacts/harness/")) {
  issues.push("CI must retain harness evidence on success and failure");
}

const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");
const containerWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/container.yml"), "utf8");
for (const contract of ["ARG PEGARR_REVISION=unknown", "PEGARR_REVISION=${PEGARR_REVISION}"]) {
  if (!dockerfile.includes(contract)) {
    issues.push(`PEG-RELEASE-001 Docker builds must retain ${contract}`);
  }
}
if (!containerWorkflow.includes("PEGARR_REVISION=${{ github.sha }}")) {
  issues.push("PEG-RELEASE-001 published containers must embed the exact Git revision");
}

const manifest = readJson("harness/manifest.json");
if (/^phase-[01]-/u.test(manifest.phase)) {
  const app = readFileSync(resolve(repoRoot, "src/app.ts"), "utf8");
  if (/\/api\/v1\/[^"'`]*(?:grab|download|delete)/iu.test(app)) {
    issues.push("The read-only phases may not expose a mutating API route");
  }
  if (!app.includes('"/api/v1/feasibility/demo"')) {
    issues.push("The read-only phases must retain the synthetic feasibility route");
  }
  if (!app.includes('"/api/v1/integrations/sonarr/status"')) {
    issues.push("The read-only phases must retain the Sonarr status route");
  }
  if (!app.includes('"/api/v1/integrations/radarr/status"')) {
    issues.push("The read-only phases must retain the Radarr status route");
  }
  if (
    !app.includes('"/api/v1/library/missing"') ||
    app.indexOf("authorizeLibraryRoute(access)") > app.indexOf("services.readMissingInventory")
  ) {
    issues.push("The live missing-item route must authenticate before reading upstream inventory");
  }
  if (
    !app.includes("parseItemFeasibilityPath") ||
    !app.includes("services.readItemFeasibility") ||
    app.indexOf("authorizeLibraryRoute(access)") > app.indexOf("services.readItemFeasibility")
  ) {
    issues.push("The live item-feasibility route must authenticate before any report work");
  }
  const itemFeasibility = readFileSync(resolve(repoRoot, "src/item-feasibility.ts"), "utf8");
  if (
    !itemFeasibility.includes("readInventory") ||
    !itemFeasibility.includes("#inFlight") ||
    !itemFeasibility.includes("#cache") ||
    /\b(?:grabRelease|downloadRelease|deleteItem|updateItem)\b/iu.test(itemFeasibility)
  ) {
    issues.push("Item feasibility must remain server-owned, bounded, and read-only");
  }
  if (
    !itemFeasibility.includes("options.refresh !== true") ||
    !app.includes('searchParams.get("refresh") === "1"') ||
    !dashboardClient.includes('?refresh=1')
  ) {
    issues.push("Explicit item refresh must bypass only Pegarr's bounded item cache");
  }
  for (const contract of [
    'source: "stale_cache"',
    "#staleTtlMs",
    "staleFailure",
    "retryAfter",
  ]) {
    if (!itemFeasibility.includes(contract)) {
      issues.push(`The stale item fallback must retain ${contract}`);
    }
  }
  if (!dashboardClient.includes('view.analysis.source === "stale_cache"')) {
    issues.push("The dashboard must label stale analysis explicitly");
  }
  if (
    !app.includes('pathname === "/"') ||
    !app.includes("content-security-policy") ||
    !app.includes("dashboardPage")
  ) {
    issues.push("The Phase 1 dashboard must retain its same-origin security boundary");
  }
}

if (/^phase-(?:2|3)-/u.test(manifest.phase)) {
  const app = readFileSync(resolve(repoRoot, "src/app.ts"), "utf8");
  const controlledGrab = readFileSync(resolve(repoRoot, "src/controlled-grab.ts"), "utf8");
  const grabAudit = readFileSync(resolve(repoRoot, "src/grab-audit.ts"), "utf8");
  for (const contract of [
    "authorizeAdministratorRoute(access)",
    "parsePrepareGrabBody",
    "parseExecuteGrabBody",
    "parseCatalogContinuationGrabPath",
    'scopeKind === "season"',
    'pathname === "/api/v1/session/login"',
    'pathname === "/api/v1/onboarding"',
    "sessionMutationAuthorized",
    "SameSite=Strict",
    "parseReconcileGrabBody",
    'pathname === "/api/v1/grabs/history"',
    "readBoundedJsonBody(request)",
  ]) {
    if (!app.includes(contract)) issues.push(`The Phase 2 API boundary must retain ${contract}`);
  }
  for (const contract of [
    "prepareTarget(target: ControlledGrabTarget",
    "source.revalidate(selection, normalizedReleaseId)",
    "confirmationText(releaseTitle, targetLabel)",
    "this.#options.audit.begin",
    "source.revalidate(canonicalSelection, challenge.releaseId)",
    "await source.grab(revalidated.handle, canonicalSelection)",
    '"timeout_unknown"',
    '"reconciliation_required"',
    "reconciliationText(event, validatedOutcome)",
  ]) {
    if (!controlledGrab.includes(contract)) issues.push(`The controlled Grab service must retain ${contract}`);
  }
  for (const forbidden of ["api_key", "authorization", "guid", "indexer_id"]) {
    if (grabAudit.toLocaleLowerCase().includes(forbidden)) issues.push(`The Grab audit must not persist ${forbidden}`);
  }
  for (const contract of ["idempotency_key TEXT NOT NULL UNIQUE", "status = 'in_progress'", "reconciliation_outcome", "LIMIT ?"]) {
    if (!grabAudit.includes(contract)) issues.push(`The Grab audit must retain ${contract}`);
  }
  for (const contract of [
    "administratorToken = undefined",
    "crypto.randomUUID()",
    'credentials: "omit"',
    "activeFeasibility?.controlledGrab === true",
    "historyAdministratorToken = undefined",
    "submitReconciliation",
    "row.grabEndpoint",
  ]) {
    if (!dashboardClient.includes(contract)) issues.push(`The controlled Grab dashboard must retain ${contract}`);
  }
}

const domain = readFileSync(resolve(repoRoot, "src/domain.ts"), "utf8");
for (const state of ["confirmed", "likely", "possible", "no_match_found", "unknown"]) {
  if (!domain.includes(`"${state}"`)) {
    issues.push(`subtitle confidence contract is missing ${state}`);
  }
}
if (!domain.includes('readonly mode: "read_only"')) {
  issues.push("feasibility reports must retain an explicit read_only mode");
}

failContract("PEG-ARCH", issues);
