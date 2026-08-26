import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { failContract, readJson, repoRoot, repositoryFiles } from "./lib.mjs";

const issues = [];
const requiredDocs = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "ARR-SUBTITLE-RELEASE-PICKER-RESEARCH.md",
  "docs/harness.md",
  "docs/harness-scenarios.md",
  "docs/configuration.md",
  "docs/episode-feasibility-report.md",
  "docs/movie-feasibility-report.md",
  "docs/missing-item-inventory.md",
  "docs/contracts/sonarr-v3-release-search.md",
  "docs/contracts/sonarr-v3-system-status.md",
  "docs/contracts/radarr-v3-release-search.md",
  "docs/contracts/radarr-v3-system-status.md",
  "docs/contracts/bazarr-v1-language-policy.md",
  "docs/contracts/subdl-v2-subtitle-search.md",
  "docs/contracts/http-transport.md",
];

for (const file of requiredDocs) {
  if (!existsSync(resolve(repoRoot, file))) {
    issues.push(`required guide is missing: ${file}`);
  }
}

for (const file of repositoryFiles().filter((path) => path.endsWith(".md"))) {
  const absolutePath = resolve(repoRoot, file);
  const content = readFileSync(absolutePath, "utf8");
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const rawTarget = match[1].trim().replace(/^<|>$/gu, "");
    if (/^(?:https?:|mailto:|#)/u.test(rawTarget)) {
      continue;
    }
    const target = decodeURIComponent(rawTarget.split("#", 1)[0]);
    if (target && !existsSync(resolve(dirname(absolutePath), target))) {
      issues.push(`${file} links to missing local path ${rawTarget}`);
    }
  }
}

const manifest = readJson("harness/manifest.json");
const catalog = readFileSync(resolve(repoRoot, "docs/harness-scenarios.md"), "utf8");
for (const { id } of [...manifest.automatedScenarios, ...manifest.manualGaps]) {
  if (!catalog.includes(id)) {
    issues.push(`docs/harness-scenarios.md is missing ${id}`);
  }
}

const contributing = readFileSync(resolve(repoRoot, "CONTRIBUTING.md"), "utf8");
if (!contributing.includes("npm run check:affected")) {
  issues.push("CONTRIBUTING.md must identify npm run check:affected as the completion gate");
}

failContract("PEG-DOCS", issues);
