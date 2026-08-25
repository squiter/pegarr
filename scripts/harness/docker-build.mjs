import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
      "const checks = ['/health/ready', '/api/v1/feasibility/demo', '/api/v1/integrations/sonarr/status'];",
      "Promise.all(checks.map(async (path) => {",
      "  const response = await fetch('http://127.0.0.1:8080' + path);",
      "  const body = await response.json();",
      "  if (response.status !== 200) throw new Error(path + ' returned ' + response.status);",
      "  if (path.endsWith('/demo') && body.mode !== 'read_only') throw new Error('demo is not read_only');",
      "  if (path.endsWith('/sonarr/status') && (body.mode !== 'read_only' || body.state !== 'disabled')) throw new Error('Sonarr status is not safely disabled');",
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

async function configuredSonarrSmokeTest() {
  const scenario = "PEG-DOCKER-002";
  const suffix = `${process.pid}`;
  const networkName = `pegarr-harness-internal-${suffix}`;
  const fixtureName = `pegarr-harness-sonarr-${suffix}`;
  const pegarrName = `pegarr-harness-configured-${suffix}`;
  const artifactsDirectory = resolve(".artifacts");
  mkdirSync(artifactsDirectory, { recursive: true });
  const secretDirectory = mkdtempSync(
    join(artifactsDirectory, "pegarr-synthetic-docker-"),
  );
  const secretPath = join(secretDirectory, "sonarr_api_key");
  const syntheticKey = "synthetic-docker-api-key";
  writeFileSync(secretPath, syntheticKey, { mode: 0o444 });

  const network = docker([
    "network",
    "create",
    "--internal",
    "--label",
    "pegarr.harness=true",
    networkName,
  ]);
  if (network.status !== 0) {
    rmSync(secretDirectory, { recursive: true, force: true });
    throw new Error(`${scenario} could not create an internal network:\n${outputOf(network)}`);
  }

  const fixtureScript = [
    "const { createServer } = require('node:http');",
    `const expectedKey = ${JSON.stringify(syntheticKey)};`,
    "const body = { appName: 'Sonarr', version: '5.0.0.0', isDocker: true, instanceName: 'private synthetic instance', startupPath: '/private/synthetic/path' };",
    "createServer((request, response) => {",
    "  if (request.method !== 'GET' || request.url !== '/api/v3/system/status' || request.headers['x-api-key'] !== expectedKey) {",
    "    response.writeHead(401, { 'content-type': 'application/json' });",
    "    response.end('{}');",
    "    return;",
    "  }",
    "  response.writeHead(200, { 'content-type': 'application/json' });",
    "  response.end(JSON.stringify(body));",
    "}).listen(8989, '0.0.0.0');",
  ].join("\n");

  try {
    const fixture = docker([
      "run",
      "--detach",
      "--name",
      fixtureName,
      "--label",
      "pegarr.harness=true",
      "--network",
      networkName,
      "--network-alias",
      "sonarr-fixture",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=16m",
      "pegarr:harness",
      "node",
      "-e",
      fixtureScript,
    ]);
    if (fixture.status !== 0) {
      throw new Error(`${scenario} could not start the synthetic Sonarr container:\n${outputOf(fixture)}`);
    }

    const started = docker([
      "run",
      "--detach",
      "--name",
      pegarrName,
      "--label",
      "pegarr.harness=true",
      "--network",
      networkName,
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=16m",
      "--mount",
      `type=bind,source=${secretPath},target=/run/secrets/sonarr_api_key,readonly`,
      "--env",
      "PEGARR_SONARR_URL=http://sonarr-fixture:8989",
      "--env",
      "PEGARR_SONARR_ALLOWED_HOSTS=sonarr-fixture",
      "--env",
      "PEGARR_SONARR_API_KEY_FILE=/run/secrets/sonarr_api_key",
      "--env",
      "PEGARR_SONARR_ALLOW_INSECURE_HTTP=true",
      "pegarr:harness",
    ]);
    if (started.status !== 0) {
      throw new Error(`${scenario} could not start configured Pegarr:\n${outputOf(started)}`);
    }

    const inspection = docker(["network", "inspect", "--format", "{{.Internal}}", networkName]);
    if (inspection.status !== 0 || inspection.stdout.trim() !== "true") {
      throw new Error(`${scenario} network is not internal-only: ${outputOf(inspection).trim()}`);
    }

    const probe = [
      "fetch('http://127.0.0.1:8080/api/v1/integrations/sonarr/status')",
      "  .then(async (response) => ({ status: response.status, body: await response.json() }))",
      "  .then(({ status, body }) => {",
      "    if (status !== 200 || body.mode !== 'read_only' || body.state !== 'available' || body.version !== '5.0.0.0') throw new Error('unexpected Sonarr status');",
      "    const serialized = JSON.stringify(body);",
      "    if (/private|synthetic-docker-api-key|sonarr-fixture/i.test(serialized)) throw new Error('private evidence escaped');",
      "    console.log('Sonarr status=available, version=' + body.version);",
      "  });",
    ].join("\n");

    let result;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      result = docker(["exec", pegarrName, "node", "-e", probe]);
      if (result.status === 0) {
        process.stdout.write(
          `${scenario} ${result.stdout.trim()} (secret-file, node, read-only, internal-network)\n`,
        );
        break;
      }
      await delay(250);
    }

    if (result?.status !== 0) {
      const pegarrLogs = docker(["logs", pegarrName]);
      const fixtureLogs = docker(["logs", fixtureName]);
      throw new Error(
        `${scenario} endpoint probe failed:\n${outputOf(result)}\nPegarr logs:\n${outputOf(pegarrLogs)}\nFixture logs:\n${outputOf(fixtureLogs)}`,
      );
    }

    const packagedProbe = docker([
      "exec",
      pegarrName,
      "npm",
      "run",
      "--silent",
      "probe:sonarr",
    ]);
    if (
      packagedProbe.status !== 0 ||
      !packagedProbe.stdout.includes('"state":"available"') ||
      /private|synthetic-docker-api-key|sonarr-fixture/iu.test(packagedProbe.stdout)
    ) {
      throw new Error(`${scenario} packaged probe failed:\n${outputOf(packagedProbe)}`);
    }
    process.stdout.write(`${scenario} packaged one-shot probe=available\n`);
  } finally {
    docker(["rm", "--force", pegarrName]);
    docker(["rm", "--force", fixtureName]);
    docker(["network", "rm", networkName]);
    rmSync(secretDirectory, { recursive: true, force: true });
  }
}

export async function main() {
  const first = build();
  const firstOutput = outputOf(first);
  if (first.status === 0) {
    process.stdout.write(firstOutput);
    await smokeTest();
    await configuredSonarrSmokeTest();
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
    await configuredSonarrSmokeTest();
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
