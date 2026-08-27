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
  "src/adapters/sonarr.ts": ["node:crypto", "../domain.js", "./http.js"],
  "src/adapters/radarr.ts": ["node:crypto", "../domain.js", "./http.js"],
  "src/adapters/bazarr.ts": ["../domain.js", "./http.js"],
  "src/adapters/subdl.ts": ["node:crypto", "../domain.js", "./http.js"],
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
if (!sonarrAdapter.includes('method: "GET"') || sonarrAdapter.includes('method: "POST"')) {
  issues.push("The Phase 0 Sonarr adapter must remain read-only");
}

const radarrAdapter = readFileSync(resolve(repoRoot, "src/adapters/radarr.ts"), "utf8");
if (!radarrAdapter.includes('method: "GET"') || radarrAdapter.includes('method: "POST"')) {
  issues.push("The Phase 0 Radarr adapter must remain read-only");
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
if (!subdlAdapter.includes("authorization: `Bearer ${this.#apiKey}`") || /api_key/u.test(subdlAdapter)) {
  issues.push("The SubDL API key must remain in the authorization header and out of URLs");
}

const providerCache = readFileSync(resolve(repoRoot, "src/provider-search-cache.ts"), "utf8");
for (const contract of [
  'result.status !== "success"',
  'createHash("sha256")',
  "maximumPayloadBytes",
  'status: "hit"',
  'status: "miss"',
]) {
  if (!providerCache.includes(contract)) {
    issues.push(`The provider cache must retain ${contract}`);
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
  '`${spec.prefix}_API_KEY_FILE`',
  "maximumSecretBytes = 4_096",
  'return "[redacted]"',
  "PEGARR_ACCESS_TOKEN_FILE",
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

const dashboardClient = readFileSync(resolve(repoRoot, "src/web/dashboard.js"), "utf8");
for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "innerHTML"]) {
  if (dashboardClient.includes(forbidden)) {
    issues.push(`The dashboard client may not use ${forbidden}`);
  }
}
for (const contract of [
  'authorization: `Bearer ${accessToken}`',
  'credentials: "omit"',
  "replaceChildren",
  "textContent",
]) {
  if (!dashboardClient.includes(contract)) {
    issues.push(`The dashboard client must retain ${contract}`);
  }
}

const accessCompose = readFileSync(resolve(repoRoot, "deploy/compose.access.yaml"), "utf8");
if (!accessCompose.includes("PEGARR_ACCESS_TOKEN_FILE: /run/secrets/pegarr_access_token")) {
  issues.push("The access Compose overlay must mount the bearer token through a secret file");
}
if (/PEGARR_ACCESS_TOKEN\s*:/u.test(accessCompose)) {
  issues.push("The access Compose overlay may not pass the bearer token as an environment value");
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
if (/PEGARR_SUBDL_API_KEY\s*:/u.test(subdlCompose)) {
  issues.push("The SubDL Compose overlay may not pass the API key as an environment value");
}
if (/PEGARR_RADARR_API_KEY\s*:/u.test(radarrCompose)) {
  issues.push("The Radarr Compose overlay may not pass the API key as an environment value");
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
    app.indexOf("access.control.authorize") > app.indexOf("services.readMissingInventory")
  ) {
    issues.push("The live missing-item route must authenticate before reading upstream inventory");
  }
  if (
    !app.includes('pathname === "/"') ||
    !app.includes("content-security-policy") ||
    !app.includes("dashboardPage")
  ) {
    issues.push("The Phase 1 dashboard must retain its same-origin security boundary");
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
