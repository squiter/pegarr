import assert from "node:assert/strict";
import test from "node:test";

import { shouldRetryWithClassicBuilder } from "./docker-build.mjs";
import { classifyAffectedFiles, selectCheckIds, summarizeFailure } from "./run-checks.mjs";

test("PEG-HARNESS-001 affected paths select the narrow deterministic sensor set", () => {
  assert.deepEqual(classifyAffectedFiles(["docs/harness.md"]), {
    compiled: false,
    container: false,
  });
  assert.deepEqual(classifyAffectedFiles(["src/matching.ts"]), {
    compiled: true,
    container: true,
  });
  assert.deepEqual(selectCheckIds("affected", ["docs/harness.md"]), [
    "PEG-SCENARIOS",
    "PEG-DOCS",
    "PEG-ARCH",
    "PEG-SECRETS",
  ]);
  assert.ok(selectCheckIds("affected", ["src/matching.ts"]).includes("PEG-DOCKER"));
});

test("PEG-HARNESS-002 raw tool failures become compact actionable signals", () => {
  const noisyOutput = [
    "compiler setup",
    "src/example.ts(4,2): error TS2322: Type 'string' is not assignable to type 'number'.",
    "more downstream output",
  ].join("\n");

  assert.equal(
    summarizeFailure(noisyOutput),
    "src/example.ts(4,2): error TS2322: Type 'string' is not assignable to type 'number'.",
  );
});

test("PEG-HARNESS-003 Docker frontend timeouts select the bounded fallback", () => {
  assert.equal(
    shouldRetryWithClassicBuilder(
      'failed to resolve docker/dockerfile/manifests/1.7: dial tcp 10.0.0.1:443: i/o timeout',
    ),
    true,
  );
  assert.equal(
    shouldRetryWithClassicBuilder("Dockerfile: RUN npm run build returned exit code 2"),
    false,
  );
});
