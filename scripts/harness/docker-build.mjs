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
      "const checks = ['/health/ready', '/api/v1/feasibility/demo', '/api/v1/integrations/sonarr/status', '/api/v1/integrations/radarr/status'];",
      "Promise.all(checks.map(async (path) => {",
      "  const response = await fetch('http://127.0.0.1:8080' + path);",
      "  const body = await response.json();",
      "  if (response.status !== 200) throw new Error(path + ' returned ' + response.status);",
      "  if (path.endsWith('/demo') && body.mode !== 'read_only') throw new Error('demo is not read_only');",
      "  if (path.endsWith('/sonarr/status') && (body.mode !== 'read_only' || body.state !== 'disabled')) throw new Error('Sonarr status is not safely disabled');",
      "  if (path.endsWith('/radarr/status') && (body.mode !== 'read_only' || body.state !== 'disabled')) throw new Error('Radarr status is not safely disabled');",
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

async function configuredArrSmokeTest({ scenario, integration, appName, version, port }) {
  const upperIntegration = integration.toUpperCase();
  const suffix = `${process.pid}`;
  const networkName = `pegarr-harness-${integration}-internal-${suffix}`;
  const fixtureName = `pegarr-harness-${integration}-${suffix}`;
  const pegarrName = `pegarr-harness-${integration}-configured-${suffix}`;
  const artifactsDirectory = resolve(".artifacts");
  mkdirSync(artifactsDirectory, { recursive: true });
  const secretDirectory = mkdtempSync(
    join(artifactsDirectory, "pegarr-synthetic-docker-"),
  );
  const secretPath = join(secretDirectory, `${integration}_api_key`);
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
    `const body = { appName: ${JSON.stringify(appName)}, version: ${JSON.stringify(version)}, isDocker: true, instanceName: 'private synthetic instance', startupPath: '/private/synthetic/path' };`,
    "createServer((request, response) => {",
    "  if (request.method !== 'GET' || request.url !== '/api/v3/system/status' || request.headers['x-api-key'] !== expectedKey) {",
    "    response.writeHead(401, { 'content-type': 'application/json' });",
    "    response.end('{}');",
    "    return;",
    "  }",
    "  response.writeHead(200, { 'content-type': 'application/json' });",
    "  response.end(JSON.stringify(body));",
    `}).listen(${port}, '0.0.0.0');`,
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
      `${integration}-fixture`,
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=16m",
      "pegarr:harness",
      "node",
      "-e",
      fixtureScript,
    ]);
    if (fixture.status !== 0) {
      throw new Error(`${scenario} could not start the synthetic ${appName} container:\n${outputOf(fixture)}`);
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
      `type=bind,source=${secretPath},target=/run/secrets/${integration}_api_key,readonly`,
      "--env",
      `PEGARR_${upperIntegration}_URL=http://${integration}-fixture:${port}`,
      "--env",
      `PEGARR_${upperIntegration}_ALLOWED_HOSTS=${integration}-fixture`,
      "--env",
      `PEGARR_${upperIntegration}_API_KEY_FILE=/run/secrets/${integration}_api_key`,
      "--env",
      `PEGARR_${upperIntegration}_ALLOW_INSECURE_HTTP=true`,
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
      `fetch('http://127.0.0.1:8080/api/v1/integrations/${integration}/status')`,
      "  .then(async (response) => ({ status: response.status, body: await response.json() }))",
      "  .then(({ status, body }) => {",
      `    if (status !== 200 || body.mode !== 'read_only' || body.state !== 'available' || body.version !== ${JSON.stringify(version)}) throw new Error('unexpected ${appName} status');`,
      "    const serialized = JSON.stringify(body);",
      "    if (/private|synthetic-docker-api-key|(?:sonarr|radarr)-fixture/i.test(serialized)) throw new Error('private evidence escaped');",
      `    console.log('${appName} status=available, version=' + body.version);`,
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
      `probe:${integration}`,
    ]);
    if (
      packagedProbe.status !== 0 ||
      !packagedProbe.stdout.includes('"state":"available"') ||
      /private|synthetic-docker-api-key|(?:sonarr|radarr)-fixture/iu.test(packagedProbe.stdout)
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

async function configuredBazarrProbeSmokeTest() {
  const scenario = "PEG-DOCKER-004";
  const suffix = `${process.pid}`;
  const networkName = `pegarr-harness-bazarr-internal-${suffix}`;
  const fixtureName = `pegarr-harness-bazarr-${suffix}`;
  const artifactsDirectory = resolve(".artifacts");
  mkdirSync(artifactsDirectory, { recursive: true });
  const secretDirectory = mkdtempSync(join(artifactsDirectory, "pegarr-synthetic-docker-"));
  const secretPath = join(secretDirectory, "bazarr_api_key");
  const syntheticKey = "synthetic-docker-api-key";
  writeFileSync(secretPath, syntheticKey, { mode: 0o444 });

  const network = docker([
    "network", "create", "--internal", "--label", "pegarr.harness=true", networkName,
  ]);
  if (network.status !== 0) {
    rmSync(secretDirectory, { recursive: true, force: true });
    throw new Error(`${scenario} could not create an internal network:\n${outputOf(network)}`);
  }

  const fixtureScript = [
    "const { createServer } = require('node:http');",
    `const expectedKey = ${JSON.stringify(syntheticKey)};`,
    "const body = [{ profileId: 7, name: 'private profile', cutoff: 1, items: [{ id: 1, language: 'en', hi: 'False', forced: 'False', audio_exclude: 'False', audio_only_include: 'False' }], mustContain: [], mustNotContain: [], originalFormat: 0, tag: null }];",
    "createServer((request, response) => {",
    "  if (request.method !== 'GET' || request.url !== '/api/system/languages/profiles' || request.headers['x-api-key'] !== expectedKey) { response.writeHead(401); response.end('{}'); return; }",
    "  response.writeHead(200, { 'content-type': 'application/json' });",
    "  response.end(JSON.stringify(body));",
    "}).listen(6767, '0.0.0.0');",
  ].join("\n");

  try {
    const fixture = docker([
      "run", "--detach", "--name", fixtureName, "--label", "pegarr.harness=true",
      "--network", networkName, "--network-alias", "bazarr-fixture", "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m", "pegarr:harness", "node", "-e", fixtureScript,
    ]);
    if (fixture.status !== 0) {
      throw new Error(`${scenario} could not start the synthetic Bazarr container:\n${outputOf(fixture)}`);
    }

    const runArgs = [
      "run", "--rm", "--network", networkName, "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "--mount", `type=bind,source=${secretPath},target=/run/secrets/bazarr_api_key,readonly`,
      "--env", "PEGARR_BAZARR_URL=http://bazarr-fixture:6767",
      "--env", "PEGARR_BAZARR_ALLOWED_HOSTS=bazarr-fixture",
      "--env", "PEGARR_BAZARR_API_KEY_FILE=/run/secrets/bazarr_api_key",
      "--env", "PEGARR_BAZARR_ALLOW_INSECURE_HTTP=true",
      "pegarr:harness", "npm", "run", "--silent", "probe:bazarr",
    ];
    let probe;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      probe = docker(runArgs);
      if (probe.status === 0) break;
      await delay(250);
    }
    if (
      probe?.status !== 0 ||
      !probe.stdout.includes('"state":"available"') ||
      !probe.stdout.includes('"profileCount":1') ||
      /private|synthetic-docker-api-key|bazarr-fixture/iu.test(probe.stdout)
    ) {
      throw new Error(`${scenario} packaged Bazarr probe failed:\n${outputOf(probe)}`);
    }
    process.stdout.write(`${scenario} packaged profile probe=available (secret-file, read-only, internal-network)\n`);
  } finally {
    docker(["rm", "--force", fixtureName]);
    docker(["network", "rm", networkName]);
    rmSync(secretDirectory, { recursive: true, force: true });
  }
}

async function configuredSubdlProbeSmokeTest() {
  const scenario = "PEG-DOCKER-005";
  const suffix = `${process.pid}`;
  const networkName = `pegarr-harness-subdl-internal-${suffix}`;
  const fixtureName = `pegarr-harness-subdl-${suffix}`;
  const artifactsDirectory = resolve(".artifacts");
  mkdirSync(artifactsDirectory, { recursive: true });
  const secretDirectory = mkdtempSync(join(artifactsDirectory, "pegarr-synthetic-docker-"));
  const secretPath = join(secretDirectory, "subdl_api_key");
  const syntheticKey = "synthetic-docker-api-key";
  writeFileSync(secretPath, syntheticKey, { mode: 0o444 });

  const network = docker([
    "network", "create", "--internal", "--label", "pegarr.harness=true", networkName,
  ]);
  if (network.status !== 0) {
    rmSync(secretDirectory, { recursive: true, force: true });
    throw new Error(`${scenario} could not create an internal network:\n${outputOf(network)}`);
  }

  const fixtureScript = [
    "const { createServer } = require('node:http');",
    `const expectedAuthorization = ${JSON.stringify(`Bearer ${syntheticKey}`)};`,
    "const expectedUrl = '/api/v2/subtitles/search?imdb_id=tt9000005&type=tv&languages=EN&subs_per_page=30&season=3&episode=5';",
    "const body = { status: true, subtitles: [{ id: 1, language: 'English', release_name: 'private.release.name', season: 3, episode: 5 }] };",
    "createServer((request, response) => {",
    "  if (request.method !== 'GET' || request.url !== expectedUrl || request.headers.authorization !== expectedAuthorization) { response.writeHead(401); response.end('{}'); return; }",
    "  response.writeHead(200, { 'content-type': 'application/json', 'x-ratelimit-limit': '2000', 'x-ratelimit-remaining': '1999' });",
    "  response.end(JSON.stringify(body));",
    "}).listen(8081, '0.0.0.0');",
  ].join("\n");

  try {
    const fixture = docker([
      "run", "--detach", "--name", fixtureName, "--label", "pegarr.harness=true",
      "--network", networkName, "--network-alias", "subdl-fixture", "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m", "pegarr:harness", "node", "-e", fixtureScript,
    ]);
    if (fixture.status !== 0) {
      throw new Error(`${scenario} could not start the synthetic SubDL container:\n${outputOf(fixture)}`);
    }

    const runArgs = [
      "run", "--rm", "--network", networkName, "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "--mount", `type=bind,source=${secretPath},target=/run/secrets/subdl_api_key,readonly`,
      "--env", "PEGARR_SUBDL_URL=http://subdl-fixture:8081",
      "--env", "PEGARR_SUBDL_ALLOWED_HOSTS=subdl-fixture",
      "--env", "PEGARR_SUBDL_API_KEY_FILE=/run/secrets/subdl_api_key",
      "--env", "PEGARR_SUBDL_ALLOW_INSECURE_HTTP=true",
      "--env", "PEGARR_SUBDL_PROBE_KIND=episode",
      "--env", "PEGARR_SUBDL_PROBE_IMDB_ID=tt9000005",
      "--env", "PEGARR_SUBDL_PROBE_POLICY_LANGUAGE=en",
      "--env", "PEGARR_SUBDL_PROBE_PROVIDER_LANGUAGE=EN",
      "--env", "PEGARR_SUBDL_PROBE_SEASON=3",
      "--env", "PEGARR_SUBDL_PROBE_EPISODE=5",
      "pegarr:harness", "npm", "run", "--silent", "probe:subdl",
    ];
    let probe;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      probe = docker(runArgs);
      if (probe.status === 0) break;
      await delay(250);
    }
    if (
      probe?.status !== 0 ||
      !probe.stdout.includes('"state":"available"') ||
      !probe.stdout.includes('"requestCount":1') ||
      !probe.stdout.includes('"subtitleCount":1') ||
      /private|synthetic-docker-api-key|subdl-fixture|tt9000005/iu.test(probe.stdout)
    ) {
      throw new Error(`${scenario} packaged SubDL probe failed:\n${outputOf(probe)}`);
    }
    process.stdout.write(`${scenario} packaged exact-search probe=available (one request, secret-file, read-only, internal-network)\n`);
  } finally {
    docker(["rm", "--force", fixtureName]);
    docker(["network", "rm", networkName]);
    rmSync(secretDirectory, { recursive: true, force: true });
  }
}

async function packagedEpisodeReportSmokeTest() {
  const scenario = "PEG-DOCKER-006";
  const suffix = `${process.pid}`;
  const networkName = `pegarr-harness-report-internal-${suffix}`;
  const fixtureName = `pegarr-harness-report-${suffix}`;
  const artifactsDirectory = resolve(".artifacts");
  mkdirSync(artifactsDirectory, { recursive: true });
  const fixtureDirectory = mkdtempSync(join(artifactsDirectory, "pegarr-synthetic-docker-"));
  const keys = {
    sonarr: "synthetic-report-sonarr-key",
    bazarr: "synthetic-report-bazarr-key",
    subdl: "synthetic-report-subdl-key",
  };
  const paths = {
    sonarr: join(fixtureDirectory, "sonarr_api_key"),
    bazarr: join(fixtureDirectory, "bazarr_api_key"),
    subdl: join(fixtureDirectory, "subdl_api_key"),
    request: join(fixtureDirectory, "episode-report.json"),
  };
  writeFileSync(paths.sonarr, keys.sonarr, { mode: 0o444 });
  writeFileSync(paths.bazarr, keys.bazarr, { mode: 0o444 });
  writeFileSync(paths.subdl, keys.subdl, { mode: 0o444 });
  writeFileSync(paths.request, JSON.stringify({
    episodeId: 305,
    sonarrSeriesId: 42,
    item: {
      kind: "episode",
      title: "Synthetic Show — S03E05",
      season: 3,
      episode: 5,
      ids: { imdb: "tt9000005", tmdb: "900005" },
    },
    subdlLanguages: [
      { policyCode: "en", providerCode: "EN" },
      { policyCode: "pt-BR", providerCode: "PT-BR" },
    ],
  }), { mode: 0o444 });

  const network = docker([
    "network", "create", "--internal", "--label", "pegarr.harness=true", networkName,
  ]);
  if (network.status !== 0) {
    rmSync(fixtureDirectory, { recursive: true, force: true });
    throw new Error(`${scenario} could not create an internal network:\n${outputOf(network)}`);
  }

  const fixtureScript = [
    "const { createServer } = require('node:http');",
    `const keys = ${JSON.stringify(keys)};`,
    "const release = [{ guid: 'synthetic-guid', indexerId: 1, title: 'Synthetic.Show.S03E05.1080p.WEB-DL.H264-GROUP', indexer: 'Synthetic Indexer', protocol: 'torrent', downloadAllowed: true, rejections: [], customFormatScore: 100, languages: [], customFormats: [], releaseGroup: 'GROUP', quality: { quality: { name: 'WEBDL-1080p', source: 'webdl', resolution: 1080 } } }];",
    "const profiles = [{ profileId: 7, name: 'Synthetic multilingual', cutoff: 2, items: [{ id: 1, language: 'en', hi: 'False', forced: 'False', audio_exclude: 'False', audio_only_include: 'False' }, { id: 2, language: 'pt-BR', hi: 'True', forced: 'False', audio_exclude: 'False', audio_only_include: 'False' }], mustContain: [], mustNotContain: [], originalFormat: 0, tag: null }];",
    "const assignment = { data: [{ sonarrSeriesId: 42, profileId: 7 }], total: 1 };",
    "const subtitle = { status: true, subtitles: [{ id: 1, language: 'Portuguese (BR)', release_name: 'Synthetic.Show.S03E05.1080p.WEB-DL.H264-GROUP', season: 3, episode: 5, hi: true, forced: false }] };",
    "createServer((request, response) => {",
    "  const host = String(request.headers.host || '').split(':')[0];",
    "  const url = new URL(request.url || '/', 'http://fixture.invalid');",
    "  let body;",
    "  if (request.method !== 'GET') { response.writeHead(405); response.end('{}'); return; }",
    "  if (host === 'sonarr-fixture' && url.pathname === '/api/v3/release' && url.searchParams.get('episodeId') === '305' && request.headers['x-api-key'] === keys.sonarr) body = release;",
    "  else if (host === 'bazarr-fixture' && url.pathname === '/api/system/languages/profiles' && request.headers['x-api-key'] === keys.bazarr) body = profiles;",
    "  else if (host === 'bazarr-fixture' && url.pathname === '/api/series' && url.searchParams.getAll('seriesid[]')[0] === '42' && request.headers['x-api-key'] === keys.bazarr) body = assignment;",
    "  else if (host === 'subdl-fixture' && url.pathname === '/api/v2/subtitles/search' && request.headers.authorization === 'Bearer ' + keys.subdl) body = url.searchParams.get('languages') === 'PT-BR' ? subtitle : { status: true, subtitles: [] };",
    "  else { response.writeHead(401, { 'content-type': 'application/json' }); response.end('{}'); return; }",
    "  response.writeHead(200, { 'content-type': 'application/json', 'x-ratelimit-remaining': '1999' });",
    "  response.end(JSON.stringify(body));",
    "}).listen(8082, '0.0.0.0');",
  ].join("\n");

  try {
    const fixture = docker([
      "run", "--detach", "--name", fixtureName, "--label", "pegarr.harness=true",
      "--network", networkName,
      "--network-alias", "sonarr-fixture",
      "--network-alias", "bazarr-fixture",
      "--network-alias", "subdl-fixture",
      "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "pegarr:harness", "node", "-e", fixtureScript,
    ]);
    if (fixture.status !== 0) {
      throw new Error(`${scenario} could not start the synthetic report fixture:\n${outputOf(fixture)}`);
    }

    const runArgs = [
      "run", "--rm", "--network", networkName, "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "--mount", `type=bind,source=${paths.sonarr},target=/run/secrets/sonarr_api_key,readonly`,
      "--mount", `type=bind,source=${paths.bazarr},target=/run/secrets/bazarr_api_key,readonly`,
      "--mount", `type=bind,source=${paths.subdl},target=/run/secrets/subdl_api_key,readonly`,
      "--mount", `type=bind,source=${paths.request},target=/run/pegarr/episode-report.json,readonly`,
      "--env", "PEGARR_SONARR_URL=http://sonarr-fixture:8082",
      "--env", "PEGARR_SONARR_ALLOWED_HOSTS=sonarr-fixture",
      "--env", "PEGARR_SONARR_API_KEY_FILE=/run/secrets/sonarr_api_key",
      "--env", "PEGARR_SONARR_ALLOW_INSECURE_HTTP=true",
      "--env", "PEGARR_BAZARR_URL=http://bazarr-fixture:8082",
      "--env", "PEGARR_BAZARR_ALLOWED_HOSTS=bazarr-fixture",
      "--env", "PEGARR_BAZARR_API_KEY_FILE=/run/secrets/bazarr_api_key",
      "--env", "PEGARR_BAZARR_ALLOW_INSECURE_HTTP=true",
      "--env", "PEGARR_SUBDL_URL=http://subdl-fixture:8082",
      "--env", "PEGARR_SUBDL_ALLOWED_HOSTS=subdl-fixture",
      "--env", "PEGARR_SUBDL_API_KEY_FILE=/run/secrets/subdl_api_key",
      "--env", "PEGARR_SUBDL_ALLOW_INSECURE_HTTP=true",
      "--env", "PEGARR_EPISODE_REPORT_REQUEST_FILE=/run/pegarr/episode-report.json",
      "pegarr:harness", "npm", "run", "--silent", "report:sonarr-episode",
    ];
    let report;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      report = docker(runArgs);
      if (report.status === 0) break;
      await delay(250);
    }
    let parsed;
    try {
      parsed = JSON.parse(report?.stdout ?? "");
    } catch {
      parsed = undefined;
    }
    if (
      report?.status !== 0 ||
      parsed?.kind !== "sonarr-episode-feasibility" ||
      parsed?.status !== "ready" ||
      parsed?.mode !== "read_only" ||
      parsed?.metrics?.providerRequests !== 2 ||
      parsed?.report?.releases?.length !== 1 ||
      parsed?.report?.releases?.[0]?.subtitle?.languages?.[1]?.confidence !== "confirmed" ||
      /synthetic-report-(?:sonarr|bazarr|subdl)-key|(?:sonarr|bazarr|subdl)-fixture|\/run\/secrets/iu.test(report?.stdout ?? "")
    ) {
      throw new Error(`${scenario} packaged episode report failed:\n${outputOf(report)}`);
    }
    const inspection = docker(["network", "inspect", "--format", "{{.Internal}}", networkName]);
    if (inspection.status !== 0 || inspection.stdout.trim() !== "true") {
      throw new Error(`${scenario} network is not internal-only: ${outputOf(inspection).trim()}`);
    }
    process.stdout.write(`${scenario} packaged episode report=ready (three integrations, secret-files, read-only, internal-network)\n`);
  } finally {
    docker(["rm", "--force", fixtureName]);
    docker(["network", "rm", networkName]);
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
}

async function packagedMovieReportSmokeTest() {
  const scenario = "PEG-DOCKER-007";
  const suffix = `${process.pid}`;
  const networkName = `pegarr-harness-movie-report-internal-${suffix}`;
  const fixtureName = `pegarr-harness-movie-report-${suffix}`;
  const artifactsDirectory = resolve(".artifacts");
  mkdirSync(artifactsDirectory, { recursive: true });
  const fixtureDirectory = mkdtempSync(join(artifactsDirectory, "pegarr-synthetic-movie-docker-"));
  const keys = {
    radarr: "synthetic-movie-report-radarr-key",
    bazarr: "synthetic-movie-report-bazarr-key",
    subdl: "synthetic-movie-report-subdl-key",
  };
  const paths = {
    radarr: join(fixtureDirectory, "radarr_api_key"),
    bazarr: join(fixtureDirectory, "bazarr_api_key"),
    subdl: join(fixtureDirectory, "subdl_api_key"),
    request: join(fixtureDirectory, "movie-report.json"),
  };
  writeFileSync(paths.radarr, keys.radarr, { mode: 0o444 });
  writeFileSync(paths.bazarr, keys.bazarr, { mode: 0o444 });
  writeFileSync(paths.subdl, keys.subdl, { mode: 0o444 });
  writeFileSync(paths.request, JSON.stringify({
    movieId: 84,
    item: {
      kind: "movie",
      title: "Synthetic Movie",
      year: 2024,
      ids: { imdb: "tt9000084", tmdb: "900084" },
    },
    subdlLanguages: [
      { policyCode: "en", providerCode: "EN" },
      { policyCode: "pt-BR", providerCode: "PT-BR" },
    ],
  }), { mode: 0o444 });

  const network = docker([
    "network", "create", "--internal", "--label", "pegarr.harness=true", networkName,
  ]);
  if (network.status !== 0) {
    rmSync(fixtureDirectory, { recursive: true, force: true });
    throw new Error(`${scenario} could not create an internal network:\n${outputOf(network)}`);
  }

  const fixtureScript = [
    "const { createServer } = require('node:http');",
    `const keys = ${JSON.stringify(keys)};`,
    "const release = [{ guid: 'synthetic-movie-guid', indexerId: 1, title: 'Synthetic.Movie.2024.1080p.BluRay.x265-GROUP', indexer: 'Synthetic Movie Indexer', protocol: 'torrent', downloadAllowed: true, rejections: [], customFormatScore: 100, languages: [], customFormats: [], releaseGroup: 'GROUP', edition: '', quality: { quality: { name: 'Bluray-1080p', source: 'bluray', resolution: 1080 } } }];",
    "const profiles = [{ profileId: 7, name: 'Synthetic multilingual', cutoff: 2, items: [{ id: 1, language: 'en', hi: 'False', forced: 'False', audio_exclude: 'False', audio_only_include: 'False' }, { id: 2, language: 'pt-BR', hi: 'True', forced: 'False', audio_exclude: 'False', audio_only_include: 'False' }], mustContain: [], mustNotContain: [], originalFormat: 0, tag: null }];",
    "const assignment = { data: [{ radarrId: 84, profileId: 7 }], total: 1 };",
    "const subtitle = { status: true, subtitles: [{ id: 1, language: 'Portuguese (BR)', release_name: 'Synthetic.Movie.2024.1080p.BluRay.x265-GROUP', hi: true, forced: false }] };",
    "createServer((request, response) => {",
    "  const host = String(request.headers.host || '').split(':')[0];",
    "  const url = new URL(request.url || '/', 'http://fixture.invalid');",
    "  let body;",
    "  if (request.method !== 'GET') { response.writeHead(405); response.end('{}'); return; }",
    "  if (host === 'radarr-fixture' && url.pathname === '/api/v3/release' && url.searchParams.get('movieId') === '84' && request.headers['x-api-key'] === keys.radarr) body = release;",
    "  else if (host === 'bazarr-fixture' && url.pathname === '/api/system/languages/profiles' && request.headers['x-api-key'] === keys.bazarr) body = profiles;",
    "  else if (host === 'bazarr-fixture' && url.pathname === '/api/movies' && url.searchParams.getAll('radarrid[]')[0] === '84' && request.headers['x-api-key'] === keys.bazarr) body = assignment;",
    "  else if (host === 'subdl-fixture' && url.pathname === '/api/v2/subtitles/search' && request.headers.authorization === 'Bearer ' + keys.subdl) body = url.searchParams.get('languages') === 'PT-BR' ? subtitle : { status: true, subtitles: [] };",
    "  else { response.writeHead(401, { 'content-type': 'application/json' }); response.end('{}'); return; }",
    "  response.writeHead(200, { 'content-type': 'application/json', 'x-ratelimit-remaining': '1999' });",
    "  response.end(JSON.stringify(body));",
    "}).listen(8082, '0.0.0.0');",
  ].join("\n");

  try {
    const fixture = docker([
      "run", "--detach", "--name", fixtureName, "--label", "pegarr.harness=true",
      "--network", networkName,
      "--network-alias", "radarr-fixture",
      "--network-alias", "bazarr-fixture",
      "--network-alias", "subdl-fixture",
      "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "pegarr:harness", "node", "-e", fixtureScript,
    ]);
    if (fixture.status !== 0) {
      throw new Error(`${scenario} could not start the synthetic movie report fixture:\n${outputOf(fixture)}`);
    }

    const runArgs = [
      "run", "--rm", "--network", networkName, "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "--mount", `type=bind,source=${paths.radarr},target=/run/secrets/radarr_api_key,readonly`,
      "--mount", `type=bind,source=${paths.bazarr},target=/run/secrets/bazarr_api_key,readonly`,
      "--mount", `type=bind,source=${paths.subdl},target=/run/secrets/subdl_api_key,readonly`,
      "--mount", `type=bind,source=${paths.request},target=/run/pegarr/movie-report.json,readonly`,
      "--env", "PEGARR_RADARR_URL=http://radarr-fixture:8082",
      "--env", "PEGARR_RADARR_ALLOWED_HOSTS=radarr-fixture",
      "--env", "PEGARR_RADARR_API_KEY_FILE=/run/secrets/radarr_api_key",
      "--env", "PEGARR_RADARR_ALLOW_INSECURE_HTTP=true",
      "--env", "PEGARR_BAZARR_URL=http://bazarr-fixture:8082",
      "--env", "PEGARR_BAZARR_ALLOWED_HOSTS=bazarr-fixture",
      "--env", "PEGARR_BAZARR_API_KEY_FILE=/run/secrets/bazarr_api_key",
      "--env", "PEGARR_BAZARR_ALLOW_INSECURE_HTTP=true",
      "--env", "PEGARR_SUBDL_URL=http://subdl-fixture:8082",
      "--env", "PEGARR_SUBDL_ALLOWED_HOSTS=subdl-fixture",
      "--env", "PEGARR_SUBDL_API_KEY_FILE=/run/secrets/subdl_api_key",
      "--env", "PEGARR_SUBDL_ALLOW_INSECURE_HTTP=true",
      "--env", "PEGARR_MOVIE_REPORT_REQUEST_FILE=/run/pegarr/movie-report.json",
      "pegarr:harness", "npm", "run", "--silent", "report:radarr-movie",
    ];
    let report;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      report = docker(runArgs);
      if (report.status === 0) break;
      await delay(250);
    }
    let parsed;
    try {
      parsed = JSON.parse(report?.stdout ?? "");
    } catch {
      parsed = undefined;
    }
    if (
      report?.status !== 0 ||
      parsed?.kind !== "radarr-movie-feasibility" ||
      parsed?.status !== "ready" ||
      parsed?.mode !== "read_only" ||
      parsed?.metrics?.providerRequests !== 2 ||
      parsed?.report?.releases?.length !== 1 ||
      parsed?.report?.releases?.[0]?.subtitle?.languages?.[1]?.confidence !== "confirmed" ||
      /synthetic-movie-report-(?:radarr|bazarr|subdl)-key|(?:radarr|bazarr|subdl)-fixture|\/run\/secrets/iu.test(report?.stdout ?? "")
    ) {
      throw new Error(`${scenario} packaged movie report failed:\n${outputOf(report)}`);
    }
    const inspection = docker(["network", "inspect", "--format", "{{.Internal}}", networkName]);
    if (inspection.status !== 0 || inspection.stdout.trim() !== "true") {
      throw new Error(`${scenario} network is not internal-only: ${outputOf(inspection).trim()}`);
    }
    process.stdout.write(`${scenario} packaged movie report=ready (three integrations, secret-files, read-only, internal-network)\n`);
  } finally {
    docker(["rm", "--force", fixtureName]);
    docker(["network", "rm", networkName]);
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
}

export async function main() {
  const first = build();
  const firstOutput = outputOf(first);
  if (first.status === 0) {
    process.stdout.write(firstOutput);
    await smokeTest();
    await configuredArrSmokeTest({
      scenario: "PEG-DOCKER-002",
      integration: "sonarr",
      appName: "Sonarr",
      version: "5.0.0.0",
      port: 8989,
    });
    await configuredArrSmokeTest({
      scenario: "PEG-DOCKER-003",
      integration: "radarr",
      appName: "Radarr",
      version: "6.0.0.0",
      port: 7878,
    });
    await configuredBazarrProbeSmokeTest();
    await configuredSubdlProbeSmokeTest();
    await packagedEpisodeReportSmokeTest();
    await packagedMovieReportSmokeTest();
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
    await configuredArrSmokeTest({
      scenario: "PEG-DOCKER-002",
      integration: "sonarr",
      appName: "Sonarr",
      version: "5.0.0.0",
      port: 8989,
    });
    await configuredArrSmokeTest({
      scenario: "PEG-DOCKER-003",
      integration: "radarr",
      appName: "Radarr",
      version: "6.0.0.0",
      port: 7878,
    });
    await configuredBazarrProbeSmokeTest();
    await configuredSubdlProbeSmokeTest();
    await packagedEpisodeReportSmokeTest();
    await packagedMovieReportSmokeTest();
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
