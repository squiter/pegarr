import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { failContract, readJson, repoRoot } from "./lib.mjs";

const contract = "PEG-PHASE";
const phaseOneScenario = "PEG-HARNESS-004";
const phaseTwoScenario = "PEG-HARNESS-006";
const issues = [];
const manifest = readJson("harness/manifest.json");
const phaseOne = readJson("harness/phase-1.json");
const phaseTwo = readJson("harness/phase-2.json");
const automatedIds = new Set((manifest.automatedScenarios ?? []).map(({ id }) => id));
const expectedPhaseOneCriteria = [
  "P1-ARR-INSTANCES", "P1-BAZARR-POLICY", "P1-SUBDL-ADAPTER", "P1-MISSING-DASHBOARD",
  "P1-RELEASE-TABLE", "P1-CONFIDENCE", "P1-OPERATIONS", "P1-NO-GRAB",
];
const expectedPhaseTwoCriteria = [
  "P2-ADMIN-BOUNDARY", "P2-REVALIDATION", "P2-CONFIRMATION", "P2-ARR-GRAB",
  "P2-AUDIT-IDEMPOTENCY", "P2-CONTROLLED-UX", "P2-TIMEOUT-RECONCILIATION",
];

if (phaseOne.schemaVersion !== 1 || phaseOne.phase !== "phase-1-read-only-mvp" || phaseOne.status !== "complete") {
  issues.push("the Phase 1 ledger must preserve the completed read-only MVP record");
}
validateCriteria(phaseOne, expectedPhaseOneCriteria, new Set(["complete"]), "Phase 1");

if (phaseTwo.schemaVersion !== 1 || phaseTwo.phase !== "phase-2-controlled-grab" || phaseTwo.status !== "in_progress") {
  issues.push("the Phase 2 ledger must identify controlled Grab as in progress");
}
validateCriteria(phaseTwo, expectedPhaseTwoCriteria, new Set(["complete", "in_progress"]), "Phase 2");
if (!(phaseTwo.criteria ?? []).some(({ status }) => status === "in_progress")) {
  issues.push("Phase 2 may not claim completion while live timeout reconciliation is still open");
}

if (manifest.phase !== "phase-2-controlled-grab-in-progress" || manifest.completion?.status !== "in_progress") {
  issues.push("harness/manifest.json must expose the active Phase 2 state honestly");
}
if (manifest.completion?.criteria !== "harness/phase-2.json") {
  issues.push("harness/manifest.json must point to the Phase 2 criteria ledger");
}

const expectedManualGaps = (manifest.manualGaps ?? []).map(({ id }) => id);
for (const [name, phase] of [["Phase 1", phaseOne], ["Phase 2", phaseTwo]]) {
  if (JSON.stringify(phase.manualGapIds) !== JSON.stringify(expectedManualGaps)) {
    issues.push(`${name} manual gaps must exactly match the manifest and preserve their order`);
  }
}

const phaseOneGuidePath = resolve(repoRoot, "docs/phase-1-completion.md");
if (!existsSync(phaseOneGuidePath)) {
  issues.push("docs/phase-1-completion.md is missing");
} else {
  const guide = readFileSync(phaseOneGuidePath, "utf8");
  for (const id of expectedPhaseOneCriteria) {
    if (!guide.includes(id)) issues.push(`docs/phase-1-completion.md is missing ${id}`);
  }
  if (!guide.includes("Phase 1 implementation is complete")) issues.push("the Phase 1 guide must preserve its implementation outcome");
}

const controlledGrabGuidePath = resolve(repoRoot, "docs/controlled-grab.md");
if (!existsSync(controlledGrabGuidePath)) {
  issues.push("docs/controlled-grab.md is missing");
} else {
  const guide = readFileSync(controlledGrabGuidePath, "utf8");
  for (const phrase of ["disabled by default", "exact release-and-target confirmation", "timeout_unknown", "PEG-MANUAL-004"]) {
    if (!guide.includes(phrase)) issues.push(`docs/controlled-grab.md must retain ${phrase}`);
  }
}

const sensorSource = readFileSync(new URL(import.meta.url), "utf8");
for (const scenario of [phaseOneScenario, phaseTwoScenario]) {
  if (!sensorSource.includes(scenario)) issues.push(`${scenario} must remain attached to this phase sensor`);
}

function validateCriteria(phase, expectedIds, allowedStatuses, label) {
  const criteria = Array.isArray(phase.criteria) ? phase.criteria : [];
  if (JSON.stringify(criteria.map(({ id }) => id)) !== JSON.stringify(expectedIds)) {
    issues.push(`${label} criteria must remain ${expectedIds.join(", ")}`);
  }
  for (const criterion of criteria) {
    if (!allowedStatuses.has(criterion.status)) issues.push(`${criterion.id ?? "unknown criterion"} has an invalid status`);
    if (typeof criterion.title !== "string" || criterion.title.length === 0) issues.push(`${criterion.id ?? "unknown criterion"} needs a title`);
    if (!Array.isArray(criterion.scenarioIds) || criterion.scenarioIds.length === 0) {
      issues.push(`${criterion.id ?? "unknown criterion"} has no automated evidence`);
      continue;
    }
    for (const scenarioId of criterion.scenarioIds) {
      if (!automatedIds.has(scenarioId)) issues.push(`${criterion.id} references non-automated evidence ${scenarioId}`);
    }
  }
}

failContract(contract, issues);
