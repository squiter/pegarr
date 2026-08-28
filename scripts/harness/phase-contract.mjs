import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { failContract, readJson, repoRoot } from "./lib.mjs";

const contract = "PEG-PHASE";
const scenario = "PEG-HARNESS-004";
const issues = [];
const manifest = readJson("harness/manifest.json");
const phase = readJson("harness/phase-1.json");
const expectedCriteria = [
  "P1-ARR-INSTANCES",
  "P1-BAZARR-POLICY",
  "P1-SUBDL-ADAPTER",
  "P1-MISSING-DASHBOARD",
  "P1-RELEASE-TABLE",
  "P1-CONFIDENCE",
  "P1-OPERATIONS",
  "P1-NO-GRAB",
];

if (phase.schemaVersion !== 1) issues.push("harness/phase-1.json must use schemaVersion 1");
if (phase.phase !== "phase-1-read-only-mvp" || phase.status !== "complete") {
  issues.push("the Phase 1 ledger must identify the read-only MVP as complete");
}
if (manifest.phase !== "phase-1-read-only-mvp-complete" || manifest.completion?.status !== "complete") {
  issues.push("harness/manifest.json must expose the completed Phase 1 state");
}
if (manifest.completion?.criteria !== "harness/phase-1.json") {
  issues.push("harness/manifest.json must point to the Phase 1 criteria ledger");
}

const criteria = Array.isArray(phase.criteria) ? phase.criteria : [];
const criterionIds = criteria.map(({ id }) => id);
if (JSON.stringify(criterionIds) !== JSON.stringify(expectedCriteria)) {
  issues.push(`Phase 1 criteria must remain ${expectedCriteria.join(", ")}`);
}
const automatedIds = new Set((manifest.automatedScenarios ?? []).map(({ id }) => id));
for (const criterion of criteria) {
  if (criterion.status !== "complete") issues.push(`${criterion.id ?? "unknown criterion"} is not complete`);
  if (typeof criterion.title !== "string" || criterion.title.length === 0) issues.push(`${criterion.id ?? "unknown criterion"} needs a title`);
  if (!Array.isArray(criterion.scenarioIds) || criterion.scenarioIds.length === 0) {
    issues.push(`${criterion.id ?? "unknown criterion"} has no automated evidence`);
    continue;
  }
  for (const scenarioId of criterion.scenarioIds) {
    if (!automatedIds.has(scenarioId)) issues.push(`${criterion.id} references non-automated evidence ${scenarioId}`);
  }
}

const expectedManualGaps = (manifest.manualGaps ?? []).map(({ id }) => id);
if (JSON.stringify(phase.manualGapIds) !== JSON.stringify(expectedManualGaps)) {
  issues.push("Phase 1 manual gaps must exactly match the manifest and preserve their order");
}

const completionGuidePath = resolve(repoRoot, "docs/phase-1-completion.md");
if (!existsSync(completionGuidePath)) {
  issues.push("docs/phase-1-completion.md is missing");
} else {
  const guide = readFileSync(completionGuidePath, "utf8");
  for (const id of [...expectedCriteria, ...expectedManualGaps]) {
    if (!guide.includes(id)) issues.push(`docs/phase-1-completion.md is missing ${id}`);
  }
  if (!guide.includes("Phase 1 implementation is complete")) {
    issues.push("the completion guide must state the implementation outcome explicitly");
  }
}

if (!readFileSync(new URL(import.meta.url), "utf8").includes(scenario)) {
  issues.push(`${scenario} must remain attached to this completion sensor`);
}

failContract(contract, issues);
