import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { failContract, readJson, repoRoot, repositoryFiles } from "./lib.mjs";

const manifest = readJson("harness/manifest.json");
const issues = [];
const automated = manifest.automatedScenarios ?? [];
const manual = manifest.manualGaps ?? [];
const allEntries = [...automated, ...manual];
const ids = allEntries.map(({ id }) => id);

if (manifest.schemaVersion !== 1) {
  issues.push("harness/manifest.json must use schemaVersion 1");
}
if (typeof manifest.phase !== "string" || manifest.phase.length === 0) {
  issues.push("harness/manifest.json must declare the current phase");
}
for (const id of new Set(ids.filter((id) => ids.indexOf(id) !== ids.lastIndexOf(id)))) {
  issues.push(`duplicate scenario ID ${id}`);
}

for (const scenario of automated) {
  if (!/^PEG-[A-Z]+-\d{3}$/u.test(scenario.id)) {
    issues.push(`invalid automated scenario ID ${scenario.id}`);
  }
  const evidencePath = resolve(repoRoot, scenario.evidence ?? "");
  if (!scenario.evidence || !existsSync(evidencePath)) {
    issues.push(`${scenario.id} evidence file does not exist: ${scenario.evidence ?? "<missing>"}`);
    continue;
  }
  if (!readFileSync(evidencePath, "utf8").includes(scenario.id)) {
    issues.push(`${scenario.id} is not referenced by ${scenario.evidence}`);
  }
  if (!scenario.boundary) {
    issues.push(`${scenario.id} must state its evidence boundary`);
  }
}

for (const gap of manual) {
  if (!/^PEG-MANUAL-\d{3}$/u.test(gap.id)) {
    issues.push(`invalid manual gap ID ${gap.id}`);
  }
  if (!gap.reason) {
    issues.push(`${gap.id} must explain why it is not automated`);
  }
}

const cataloguedIds = new Set(ids);
const testFiles = repositoryFiles().filter(
  (file) => file.endsWith(".test.ts") || file.endsWith(".test.mjs"),
);
for (const file of testFiles) {
  const content = readFileSync(resolve(repoRoot, file), "utf8");
  for (const match of content.matchAll(/\btest\s*\(\s*["'`]([^"'`]+)["'`]/gu)) {
    const title = match[1];
    const scenarioId = title.match(/\bPEG-[A-Z]+-\d{3}\b/u)?.[0];
    if (!scenarioId) {
      issues.push(`${file} has an uncatalogued test title: ${title}`);
    } else if (!cataloguedIds.has(scenarioId)) {
      issues.push(`${file} references ${scenarioId}, which is absent from harness/manifest.json`);
    }
  }
}

failContract("PEG-SCENARIOS", issues);
