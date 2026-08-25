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
  "PEGARR_SONARR_API_KEY_FILE",
  "maximumSecretBytes = 4_096",
  'return "[redacted]"',
]) {
  if (!configuration.includes(contract)) {
    issues.push(`The runtime configuration must retain ${contract}`);
  }
}

const sonarrCompose = readFileSync(resolve(repoRoot, "deploy/compose.sonarr.yaml"), "utf8");
if (!sonarrCompose.includes("PEGARR_SONARR_API_KEY_FILE: /run/secrets/sonarr_api_key")) {
  issues.push("The Sonarr Compose overlay must mount the API key through a secret file");
}
if (/PEGARR_SONARR_API_KEY\s*:/u.test(sonarrCompose)) {
  issues.push("The Sonarr Compose overlay may not pass the API key as an environment value");
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

const ciWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
if (!ciWorkflow.includes("run: npm run check")) {
  issues.push("CI must run the full harness completion gate");
}
if (!ciWorkflow.includes("path: .artifacts/harness/")) {
  issues.push("CI must retain harness evidence on success and failure");
}

const manifest = readJson("harness/manifest.json");
if (manifest.phase.startsWith("phase-0")) {
  const app = readFileSync(resolve(repoRoot, "src/app.ts"), "utf8");
  if (/\/api\/v1\/[^"'`]*(?:grab|download|delete)/iu.test(app)) {
    issues.push("Phase 0 may not expose a mutating API route");
  }
  if (!app.includes('"/api/v1/feasibility/demo"')) {
    issues.push("Phase 0 must retain the synthetic read-only feasibility route");
  }
  if (!app.includes('"/api/v1/integrations/sonarr/status"')) {
    issues.push("Phase 0 must retain the read-only Sonarr status route");
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
