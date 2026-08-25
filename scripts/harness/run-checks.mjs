import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const checks = [
  check(
    "PEG-SCENARIOS",
    process.execPath,
    ["scripts/harness/scenario-contract.mjs"],
    "Update the manifest, test ID, and catalog together.",
  ),
  check(
    "PEG-DOCS",
    process.execPath,
    ["scripts/harness/docs-contract.mjs"],
    "Repair the first missing or stale documentation contract.",
  ),
  check(
    "PEG-ARCH",
    process.execPath,
    ["scripts/harness/architecture-contract.mjs"],
    "Restore the Phase 0 boundary or deliberately update its ratchet.",
  ),
  check(
    "PEG-SECRETS",
    process.execPath,
    ["scripts/harness/security-contract.mjs"],
    "Remove or sanitize the reported credential evidence.",
  ),
  check(
    "PEG-TYPES",
    npmCommand,
    ["run", "typecheck"],
    "Fix the first TypeScript root error before following downstream errors.",
  ),
  check(
    "PEG-BUILD",
    npmCommand,
    ["run", "build"],
    "Fix the first production compilation error.",
  ),
  check(
    "PEG-TEST",
    npmCommand,
    ["run", "test:unit"],
    "Read the first failing scenario and its nearby source before editing.",
  ),
  check(
    "PEG-DOCKER",
    process.execPath,
    ["scripts/harness/docker-build.mjs"],
    "Start Docker if unavailable; otherwise fix the first project build stage that failed.",
  ),
];

const contractIds = new Set(["PEG-SCENARIOS", "PEG-DOCS", "PEG-ARCH", "PEG-SECRETS"]);
const compiledIds = new Set(["PEG-TYPES", "PEG-BUILD", "PEG-TEST"]);

function check(id, command, args, nextAction) {
  return { id, command, args, nextAction };
}

export function classifyAffectedFiles(files) {
  const normalized = files.map((file) => file.replaceAll("\\", "/"));
  const compiled = normalized.some((file) =>
    /^(?:src\/|scripts\/harness\/|harness\/)|^(?:package(?:-lock)?\.json|tsconfig\.json)$/u.test(file),
  );
  const container = normalized.some((file) =>
    /^(?:src\/|deploy\/)|^(?:Dockerfile|compose\.yaml|package(?:-lock)?\.json|tsconfig\.json)$/u.test(file),
  );

  return { compiled, container };
}

export function selectCheckIds(mode, changedFiles = []) {
  if (mode === "full") {
    return checks.map(({ id }) => id);
  }
  if (mode === "fast") {
    return checks.filter(({ id }) => id !== "PEG-DOCKER").map(({ id }) => id);
  }
  if (mode !== "affected") {
    throw new Error(`Unknown harness mode: ${mode}`);
  }

  const affected = classifyAffectedFiles(changedFiles);
  return checks
    .filter(
      ({ id }) =>
        contractIds.has(id) ||
        (affected.compiled && compiledIds.has(id)) ||
        (affected.container && id === "PEG-DOCKER"),
    )
    .map(({ id }) => id);
}

export function summarizeFailure(output) {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const preferred = lines.find((line) =>
    /(?:HARNESS_CONTRACT_FAILURE|error TS\d+|^✖|^not ok\b|ERROR:)/u.test(line),
  );
  if (preferred) {
    return preferred.slice(0, 500);
  }
  return (lines.at(-1) ?? "Command failed without output").slice(0, 500);
}

export function changedFiles() {
  const tracked = runGit(["diff", "--name-only", "HEAD"]);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...tracked, ...untracked])].sort();
}

function runGit(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

function runCheck(definition, logPath) {
  const started = Date.now();
  const result = spawnSync(definition.command, definition.args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 10 * 60 * 1000,
  });
  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
  writeFileSync(logPath, output, "utf8");
  const status = result.status === 0 ? "passed" : "failed";
  return {
    id: definition.id,
    status,
    durationMs: Date.now() - started,
    command: [definition.command, ...definition.args].join(" "),
    log: relative(root, logPath),
    ...(status === "failed"
      ? { signal: summarizeFailure(output), nextAction: definition.nextAction }
      : {}),
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

export function main(argv = process.argv.slice(2)) {
  const mode = argv[0] ?? "affected";
  const changes = mode === "affected" ? changedFiles() : [];
  const selectedIds = selectCheckIds(mode, changes);
  const selected = checks.filter(({ id }) => selectedIds.includes(id));
  const artifactDirectory = resolve(root, ".artifacts/harness", timestamp());
  mkdirSync(artifactDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const results = [];

  process.stdout.write(`Pegarr harness: ${mode} (${selected.length} sensors)\n`);
  if (mode === "affected") {
    process.stdout.write(`Changed paths: ${changes.length === 0 ? "none" : changes.join(", ")}\n`);
  }

  for (const definition of selected) {
    const logPath = resolve(artifactDirectory, `${definition.id.toLowerCase()}.log`);
    const result = runCheck(definition, logPath);
    results.push(result);
    const seconds = (result.durationMs / 1000).toFixed(1);
    process.stdout.write(`${result.status === "passed" ? "PASS" : "FAIL"} ${result.id} (${seconds}s)\n`);
    if (result.status === "failed") {
      process.stderr.write(`Signal: ${result.signal}\nNext: ${result.nextAction}\n`);
      break;
    }
  }

  const passed = results.length === selected.length && results.every(({ status }) => status === "passed");
  const report = {
    schemaVersion: 1,
    mode,
    status: passed ? "passed" : "failed",
    startedAt,
    completedAt: new Date().toISOString(),
    git: {
      head: runGit(["rev-parse", "HEAD"])[0] ?? "unknown",
      dirty: runGit(["status", "--porcelain"]).length > 0,
      changedFiles: changes,
    },
    checks: results,
  };
  const reportPath = resolve(artifactDirectory, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const latestPath = resolve(root, ".artifacts/harness/latest.json");
  copyFileSync(reportPath, latestPath);

  process.stdout.write(`Evidence: ${relative(root, reportPath)}\n`);
  process.stdout.write(`LOCAL COMPLETION: ${passed ? "PASS" : "FAIL"}\n`);
  if (!passed) {
    process.exitCode = 1;
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
