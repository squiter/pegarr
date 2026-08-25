import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function shouldRetryWithClassicBuilder(output) {
  return /docker\/dockerfile\/manifests\/[^\s"]+.*(?:i\/o timeout|deadline exceeded)/isu.test(output);
}

function build(environment = process.env) {
  return spawnSync("docker", ["build", "--tag", "pegarr:harness", "."], {
    encoding: "utf8",
    env: environment,
    timeout: 10 * 60 * 1000,
  });
}

function docker(args) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 60 * 1000,
  });
}

function outputOf(result) {
  return [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function smokeTest() {
  const scenario = "PEG-DOCKER-001";
  const containerName = `pegarr-harness-${process.pid}`;
  const started = docker([
    "run",
    "--detach",
    "--name",
    containerName,
    "--label",
    "pegarr.harness=true",
    "--read-only",
    "--network",
    "none",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=16m",
    "pegarr:harness",
  ]);
  if (started.status !== 0) {
    throw new Error(`${scenario} could not start the smoke container:\n${outputOf(started)}`);
  }

  try {
    const inspection = docker([
      "inspect",
      "--format",
      "{{.Config.User}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.NetworkMode}}",
      containerName,
    ]);
    if (inspection.status !== 0 || inspection.stdout.trim() !== "node|true|none") {
      throw new Error(`${scenario} runtime hardening mismatch: ${outputOf(inspection).trim()}`);
    }

    const probe = [
      "const checks = ['/health/ready', '/api/v1/feasibility/demo'];",
      "Promise.all(checks.map(async (path) => {",
      "  const response = await fetch('http://127.0.0.1:8080' + path);",
      "  const body = await response.json();",
      "  if (response.status !== 200) throw new Error(path + ' returned ' + response.status);",
      "  if (path.endsWith('/demo') && body.mode !== 'read_only') throw new Error('demo is not read_only');",
      "  return path + '=200';",
      "})).then((results) => console.log(results.join(', ')));",
    ].join("\n");

    let result;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      result = docker(["exec", containerName, "node", "-e", probe]);
      if (result.status === 0) {
        process.stdout.write(`${scenario} ${result.stdout.trim()} (node, read-only, network=none)\n`);
        return;
      }
      await delay(250);
    }

    const logs = docker(["logs", containerName]);
    throw new Error(`${scenario} endpoint probe failed:\n${outputOf(result)}\nContainer logs:\n${outputOf(logs)}`);
  } finally {
    docker(["rm", "--force", containerName]);
  }
}

export async function main() {
  const first = build();
  const firstOutput = outputOf(first);
  if (first.status === 0) {
    process.stdout.write(firstOutput);
    await smokeTest();
    return;
  }

  if (!shouldRetryWithClassicBuilder(firstOutput)) {
    process.stderr.write(firstOutput);
    process.exitCode = 1;
    return;
  }

  process.stderr.write("BuildKit frontend resolution timed out; retrying the same Dockerfile with the classic builder.\n");
  const fallback = build({ ...process.env, DOCKER_BUILDKIT: "0" });
  const fallbackOutput = outputOf(fallback);
  if (fallback.status === 0) {
    process.stdout.write(fallbackOutput);
    await smokeTest();
    return;
  }

  process.stderr.write(`${firstOutput}\n${fallbackOutput}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
