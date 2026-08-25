import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8"));
}

export function repositoryFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  return [...new Set(output.split(/\r?\n/u).filter(Boolean))].sort();
}

export function lineNumber(content, index) {
  return content.slice(0, index).split(/\r?\n/u).length;
}

export function failContract(contract, issues) {
  if (issues.length === 0) {
    process.stdout.write(`${contract}: PASS\n`);
    return;
  }

  process.stderr.write(`HARNESS_CONTRACT_FAILURE ${contract}: ${issues.length} issue(s)\n`);
  for (const issue of issues) {
    process.stderr.write(`- ${issue}\n`);
  }
  process.exitCode = 1;
}
