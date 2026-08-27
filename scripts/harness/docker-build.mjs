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
  const seasonScenario = "PEG-DOCKER-009";
  const cacheScenario = "PEG-DOCKER-010";
  const suffix = `${process.pid}`;
  const networkName = `pegarr-harness-report-internal-${suffix}`;
  const volumeName = `pegarr-harness-report-cache-${suffix}`;
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
    seasonRequest: join(fixtureDirectory, "season-report.json"),
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
  writeFileSync(paths.seasonRequest, JSON.stringify({
    sonarrSeriesId: 42,
    seasonNumber: 3,
    item: {
      kind: "season",
      title: "Synthetic Show — Season 3",
      season: 3,
      ids: { imdb: "tt9000005", tmdb: "900005" },
    },
    subdlLanguages: [
      { policyCode: "en", providerCode: "EN" },
      { policyCode: "pt-BR", providerCode: "PT-BR" },
    ],
  }), { mode: 0o444 });

  const volume = docker([
    "volume", "create", "--label", "pegarr.harness=true", volumeName,
  ]);
  if (volume.status !== 0) {
    rmSync(fixtureDirectory, { recursive: true, force: true });
    throw new Error(`${cacheScenario} could not create a cache volume:\n${outputOf(volume)}`);
  }

  const network = docker([
    "network", "create", "--internal", "--label", "pegarr.harness=true", networkName,
  ]);
  if (network.status !== 0) {
    docker(["volume", "rm", volumeName]);
    rmSync(fixtureDirectory, { recursive: true, force: true });
    throw new Error(`${scenario} could not create an internal network:\n${outputOf(network)}`);
  }

  const fixtureScript = [
    "const { createServer } = require('node:http');",
    `const keys = ${JSON.stringify(keys)};`,
    "const release = [{ guid: 'synthetic-guid', indexerId: 1, title: 'Synthetic.Show.S03E05.1080p.WEB-DL.H264-GROUP', indexer: 'Synthetic Indexer', protocol: 'torrent', downloadAllowed: true, rejections: [], customFormatScore: 100, languages: [], customFormats: [], releaseGroup: 'GROUP', quality: { quality: { name: 'WEBDL-1080p', source: 'webdl', resolution: 1080 } } }];",
    "const seasonRelease = [{ guid: 'synthetic-season-guid', indexerId: 1, title: 'Synthetic.Show.S03.1080p.WEB-DL.H264-GROUP', indexer: 'Synthetic Season Indexer', protocol: 'torrent', downloadAllowed: true, rejections: [], customFormatScore: 100, languages: [], customFormats: [], releaseGroup: 'GROUP', fullSeason: true, seasonNumber: 3, episodeNumbers: [1, 2, 3, 4, 5, 6], quality: { quality: { name: 'WEBDL-1080p', source: 'webdl', resolution: 1080 } } }];",
    "const profiles = [{ profileId: 7, name: 'Synthetic multilingual', cutoff: 2, items: [{ id: 1, language: 'en', hi: 'False', forced: 'False', audio_exclude: 'False', audio_only_include: 'False' }, { id: 2, language: 'pt-BR', hi: 'True', forced: 'False', audio_exclude: 'False', audio_only_include: 'False' }], mustContain: [], mustNotContain: [], originalFormat: 0, tag: null }];",
    "const assignment = { data: [{ sonarrSeriesId: 42, profileId: 7 }], total: 1 };",
    "const subtitle = { status: true, subtitles: [{ id: 1, language: 'Portuguese (BR)', release_name: 'Synthetic.Show.S03E05.1080p.WEB-DL.H264-GROUP', season: 3, episode: 5, hi: true, forced: false }] };",
    "const seasonSubtitle = { status: true, subtitles: [{ id: 2, language: 'Portuguese (BR)', release_name: 'Synthetic.Show.S03.1080p.WEB-DL.H264-GROUP', season: 3, hi: true, forced: false, full_season: true }] };",
    "createServer((request, response) => {",
    "  const host = String(request.headers.host || '').split(':')[0];",
    "  const url = new URL(request.url || '/', 'http://fixture.invalid');",
    "  let body;",
    "  if (request.method !== 'GET') { response.writeHead(405); response.end('{}'); return; }",
    "  if (host === 'sonarr-fixture' && url.pathname === '/api/v3/release' && url.searchParams.get('episodeId') === '305' && request.headers['x-api-key'] === keys.sonarr) body = release;",
    "  else if (host === 'sonarr-fixture' && url.pathname === '/api/v3/release' && url.searchParams.get('seriesId') === '42' && url.searchParams.get('seasonNumber') === '3' && request.headers['x-api-key'] === keys.sonarr) body = seasonRelease;",
    "  else if (host === 'bazarr-fixture' && url.pathname === '/api/system/languages/profiles' && request.headers['x-api-key'] === keys.bazarr) body = profiles;",
    "  else if (host === 'bazarr-fixture' && url.pathname === '/api/series' && url.searchParams.getAll('seriesid[]')[0] === '42' && request.headers['x-api-key'] === keys.bazarr) body = assignment;",
    "  else if (host === 'subdl-fixture' && url.pathname === '/api/v2/subtitles/search' && request.headers.authorization === 'Bearer ' + keys.subdl) body = url.searchParams.get('languages') !== 'PT-BR' ? { status: true, subtitles: [] } : url.searchParams.has('episode') ? subtitle : seasonSubtitle;",
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
      "--mount", `type=bind,source=${paths.seasonRequest},target=/run/pegarr/season-report.json,readonly`,
      "--mount", `type=volume,source=${volumeName},target=/data`,
      "--env", "DATA_DIR=/data",
      "--env", "PEGARR_PROVIDER_CACHE_FILE=/data/provider-search-cache.sqlite",
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
    const seasonRunArgs = runArgs.map((argument) => {
      if (argument === "PEGARR_EPISODE_REPORT_REQUEST_FILE=/run/pegarr/episode-report.json") {
        return "PEGARR_SEASON_REPORT_REQUEST_FILE=/run/pegarr/season-report.json";
      }
      return argument === "report:sonarr-episode" ? "report:sonarr-season" : argument;
    });
    let seasonReport;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      seasonReport = docker(seasonRunArgs);
      if (seasonReport.status === 0) break;
      await delay(250);
    }
    let parsedSeason;
    try {
      parsedSeason = JSON.parse(seasonReport?.stdout ?? "");
    } catch {
      parsedSeason = undefined;
    }
    if (
      seasonReport?.status !== 0 ||
      parsedSeason?.kind !== "sonarr-season-feasibility" ||
      parsedSeason?.status !== "ready" ||
      parsedSeason?.mode !== "read_only" ||
      parsedSeason?.metrics?.providerRequests !== 2 ||
      parsedSeason?.report?.releases?.length !== 1 ||
      parsedSeason?.report?.releases?.[0]?.video?.evidence?.fullSeason !== true ||
      parsedSeason?.report?.releases?.[0]?.subtitle?.languages?.[1]?.confidence !== "confirmed" ||
      /synthetic-report-(?:sonarr|bazarr|subdl)-key|(?:sonarr|bazarr|subdl)-fixture|\/run\/secrets/iu.test(seasonReport?.stdout ?? "")
    ) {
      throw new Error(`${seasonScenario} packaged season report failed:\n${outputOf(seasonReport)}`);
    }
    const cachedSeasonReport = docker(seasonRunArgs);
    let parsedCachedSeason;
    try {
      parsedCachedSeason = JSON.parse(cachedSeasonReport.stdout ?? "");
    } catch {
      parsedCachedSeason = undefined;
    }
    if (
      cachedSeasonReport.status !== 0 ||
      parsedCachedSeason?.status !== "ready" ||
      parsedCachedSeason?.metrics?.providerRequests !== 0 ||
      !parsedCachedSeason?.report?.providerStatus?.every(({ cache }) => cache?.status === "hit") ||
      /synthetic-report-(?:sonarr|bazarr|subdl)-key|(?:sonarr|bazarr|subdl)-fixture|\/run\/secrets/iu.test(cachedSeasonReport.stdout ?? "")
    ) {
      throw new Error(`${cacheScenario} packaged cache reuse failed:\n${outputOf(cachedSeasonReport)}`);
    }
    const inspection = docker(["network", "inspect", "--format", "{{.Internal}}", networkName]);
    if (inspection.status !== 0 || inspection.stdout.trim() !== "true") {
      throw new Error(`${scenario} network is not internal-only: ${outputOf(inspection).trim()}`);
    }
    process.stdout.write(`${scenario} packaged episode report=ready (three integrations, secret-files, read-only, internal-network)\n`);
    process.stdout.write(`${seasonScenario} packaged season report=ready (full-season coverage, secret-files, read-only, internal-network)\n`);
    process.stdout.write(`${cacheScenario} packaged provider cache=reused (persistent volume, zero repeated provider requests)\n`);
  } finally {
    docker(["rm", "--force", fixtureName]);
    docker(["network", "rm", networkName]);
    docker(["volume", "rm", volumeName]);
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

async function packagedMissingInventorySmokeTest() {
  const scenario = "PEG-DOCKER-008";
  const accessScenario = "PEG-DOCKER-011";
  const dashboardScenario = "PEG-DOCKER-012";
  const selectionScenario = "PEG-DOCKER-013";
  const refreshScenario = "PEG-DOCKER-014";
  const suffix = `${process.pid}`;
  const networkName = `pegarr-harness-inventory-internal-${suffix}`;
  const fixtureName = `pegarr-harness-inventory-${suffix}`;
  const appName = `pegarr-harness-inventory-app-${suffix}`;
  const artifactsDirectory = resolve(".artifacts");
  mkdirSync(artifactsDirectory, { recursive: true });
  const fixtureDirectory = mkdtempSync(join(artifactsDirectory, "pegarr-synthetic-inventory-docker-"));
  const keys = {
    sonarr: "synthetic-inventory-sonarr-key",
    radarr: "synthetic-inventory-radarr-key",
    bazarr: "synthetic-inventory-bazarr-key",
    subdl: "synthetic-inventory-subdl-key",
    access: "synthetic-inventory-access-token-00000001",
  };
  const paths = {
    sonarr: join(fixtureDirectory, "sonarr_api_key"),
    radarr: join(fixtureDirectory, "radarr_api_key"),
    bazarr: join(fixtureDirectory, "bazarr_api_key"),
    subdl: join(fixtureDirectory, "subdl_api_key"),
    access: join(fixtureDirectory, "pegarr_access_token"),
  };
  writeFileSync(paths.sonarr, keys.sonarr, { mode: 0o444 });
  writeFileSync(paths.radarr, keys.radarr, { mode: 0o444 });
  writeFileSync(paths.bazarr, keys.bazarr, { mode: 0o444 });
  writeFileSync(paths.subdl, keys.subdl, { mode: 0o444 });
  writeFileSync(paths.access, keys.access, { mode: 0o444 });

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
    "const sonarr = { page: 1, pageSize: 2, totalRecords: 2, records: [{ id: 305, seriesId: 42, tvdbId: 9000305, title: 'Synthetic Episode Five', airDateUtc: '2024-03-05T20:00:00Z', seasonNumber: 3, episodeNumber: 5, monitored: true, hasFile: false, series: { id: 42, title: 'Synthetic Show', year: 2022, imdbId: 'tt9000005', tmdbId: 900005 } }, { id: 306, seriesId: 42, tvdbId: 9000306, title: 'Synthetic Episode Six', airDateUtc: '2024-03-12T20:00:00Z', seasonNumber: 3, episodeNumber: 6, monitored: true, hasFile: false, series: { id: 42, title: 'Synthetic Show', year: 2022, imdbId: 'tt9000005', tmdbId: 900005 } }] };",
    "const radarr = { page: 1, pageSize: 2, totalRecords: 2, records: [{ id: 84, title: 'Synthetic Movie', year: 2024, tmdbId: 900084, imdbId: 'tt9000084', monitored: true, hasFile: false, digitalRelease: '2024-05-12T00:00:00Z' }, { id: 85, title: 'Second Synthetic Movie', year: 2023, tmdbId: 900085, imdbId: 'tt9000085', monitored: true, hasFile: false, physicalRelease: '2024-01-18T00:00:00Z' }] };",
    "const releases = [{ guid: 'synthetic-release-guid', title: 'Synthetic.Show.S03E05.1080p.WEB-DL.H264-GROUP', indexerId: 11, indexer: 'Synthetic Indexer', protocol: 'torrent', releaseGroup: 'GROUP', downloadAllowed: true, rejections: [], customFormatScore: 100, customFormats: [{ id: 7, name: 'Subtitle preference' }], languages: [{ id: 1, name: 'English' }], quality: { quality: { id: 3, name: 'WEB 1080p', source: 'WEB-DL', resolution: 1080 } }, size: 2400000000, ageHours: 3, seeders: 42, leechers: 6 }];",
    "const profiles = [{ profileId: 7, name: 'Synthetic policy', cutoff: 1, items: [{ id: 1, language: 'pt-BR', hi: 'False', forced: 'False', audio_exclude: 'False', audio_only_include: 'False' }], mustContain: [], mustNotContain: [], originalFormat: 0 }];",
    "const assignment = { data: [{ sonarrSeriesId: 42, profileId: 7 }], total: 1 };",
    "const subtitles = { status: true, subtitles: [{ n_id: 'synthetic-subtitle', release_name: 'Synthetic.Show.S03E05.1080p.WEB-DL.H264-GROUP', language: 'PT-BR', season: 3, episode: 5, hi: false, full_season: false }] };",
    "let requestCount = 0;",
    "createServer((request, response) => {",
    "  const host = String(request.headers.host || '').split(':')[0];",
    "  const url = new URL(request.url || '/', 'http://fixture.invalid');",
    "  let body; let expectedKey;",
    "  if (request.method === 'GET' && url.pathname === '/__count') { response.writeHead(200); response.end(String(requestCount)); return; }",
    "  if (request.method !== 'GET') { response.writeHead(405); response.end('{}'); return; }",
    "  if (host === 'sonarr-fixture' && url.pathname === '/api/v3/wanted/missing' && url.searchParams.get('pageSize') === '2' && url.searchParams.get('monitored') === 'true') { body = sonarr; expectedKey = keys.sonarr; }",
    "  else if (host === 'radarr-fixture' && url.pathname === '/api/v3/wanted/missing' && url.searchParams.get('pageSize') === '2' && url.searchParams.get('monitored') === 'true') { body = radarr; expectedKey = keys.radarr; }",
    "  else if (host === 'sonarr-fixture' && url.pathname === '/api/v3/release' && url.searchParams.get('episodeId') === '305') { body = releases; expectedKey = keys.sonarr; }",
    "  else if (host === 'bazarr-fixture' && url.pathname === '/api/system/languages/profiles') { body = profiles; expectedKey = keys.bazarr; }",
    "  else if (host === 'bazarr-fixture' && url.pathname === '/api/series' && url.searchParams.get('seriesid[]') === '42') { body = assignment; expectedKey = keys.bazarr; }",
    "  else if (host === 'subdl-fixture' && url.pathname === '/api/v2/subtitles/search' && url.searchParams.get('languages') === 'PT-BR') { body = subtitles; expectedKey = keys.subdl; }",
    "  else { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}'); return; }",
    "  const providedKey = host === 'subdl-fixture' ? String(request.headers.authorization || '').replace(/^Bearer /, '') : request.headers['x-api-key'];",
    "  if (providedKey !== expectedKey) { response.writeHead(401, { 'content-type': 'application/json' }); response.end('{}'); return; }",
    "  requestCount += 1;",
    "  response.writeHead(200, { 'content-type': 'application/json' });",
    "  response.end(JSON.stringify(body));",
    "}).listen(8082, '0.0.0.0');",
  ].join("\n");

  try {
    const fixture = docker([
      "run", "--detach", "--name", fixtureName, "--label", "pegarr.harness=true",
      "--network", networkName,
      "--network-alias", "sonarr-fixture",
      "--network-alias", "radarr-fixture",
      "--network-alias", "bazarr-fixture",
      "--network-alias", "subdl-fixture",
      "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "pegarr:harness", "node", "-e", fixtureScript,
    ]);
    if (fixture.status !== 0) {
      throw new Error(`${scenario} could not start the synthetic inventory fixture:\n${outputOf(fixture)}`);
    }

    const runArgs = [
      "run", "--rm", "--network", networkName, "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "--mount", `type=bind,source=${paths.sonarr},target=/run/secrets/sonarr_api_key,readonly`,
      "--mount", `type=bind,source=${paths.radarr},target=/run/secrets/radarr_api_key,readonly`,
      "--mount", `type=bind,source=${paths.bazarr},target=/run/secrets/bazarr_api_key,readonly`,
      "--mount", `type=bind,source=${paths.subdl},target=/run/secrets/subdl_api_key,readonly`,
      "--env", "PEGARR_SONARR_URL=http://sonarr-fixture:8082",
      "--env", "PEGARR_SONARR_ALLOWED_HOSTS=sonarr-fixture",
      "--env", "PEGARR_SONARR_API_KEY_FILE=/run/secrets/sonarr_api_key",
      "--env", "PEGARR_SONARR_ALLOW_INSECURE_HTTP=true",
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
      "--env", "PEGARR_SUBDL_LANGUAGE_MAPPINGS=pt-BR:PT-BR",
      "--env", "PEGARR_MISSING_PAGE_SIZE=2",
      "pegarr:harness", "npm", "run", "--silent", "inventory:missing",
    ];
    let inventory;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      inventory = docker(runArgs);
      if (inventory.status === 0) break;
      await delay(250);
    }
    let parsed;
    try {
      parsed = JSON.parse(inventory?.stdout ?? "");
    } catch {
      parsed = undefined;
    }
    if (
      inventory?.status !== 0 ||
      parsed?.kind !== "missing-item-inventory" ||
      parsed?.status !== "ready" ||
      parsed?.mode !== "read_only" ||
      parsed?.metrics?.requestCount !== 2 ||
      parsed?.metrics?.itemCount !== 4 ||
      parsed?.sources?.[0]?.page?.items?.[0]?.kind !== "episode" ||
      parsed?.sources?.[1]?.page?.items?.[0]?.kind !== "movie" ||
      /synthetic-inventory-(?:sonarr|radarr)-key|(?:sonarr|radarr)-fixture|\/run\/secrets/iu.test(inventory?.stdout ?? "")
    ) {
      throw new Error(`${scenario} packaged missing inventory failed:\n${outputOf(inventory)}`);
    }
    const app = docker([
      "run", "--detach", "--name", appName, "--label", "pegarr.harness=true",
      "--network", networkName,
      "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "--mount", `type=bind,source=${paths.sonarr},target=/run/secrets/sonarr_api_key,readonly`,
      "--mount", `type=bind,source=${paths.radarr},target=/run/secrets/radarr_api_key,readonly`,
      "--mount", `type=bind,source=${paths.bazarr},target=/run/secrets/bazarr_api_key,readonly`,
      "--mount", `type=bind,source=${paths.subdl},target=/run/secrets/subdl_api_key,readonly`,
      "--mount", `type=bind,source=${paths.access},target=/run/secrets/pegarr_access_token,readonly`,
      "--env", "DATA_DIR=/tmp",
      "--env", "PEGARR_SONARR_URL=http://sonarr-fixture:8082",
      "--env", "PEGARR_SONARR_ALLOWED_HOSTS=sonarr-fixture",
      "--env", "PEGARR_SONARR_API_KEY_FILE=/run/secrets/sonarr_api_key",
      "--env", "PEGARR_SONARR_ALLOW_INSECURE_HTTP=true",
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
      "--env", "PEGARR_SUBDL_LANGUAGE_MAPPINGS=pt-BR:PT-BR",
      "--env", "PEGARR_ACCESS_TOKEN_FILE=/run/secrets/pegarr_access_token",
      "--env", "PEGARR_MISSING_PAGE_SIZE=2",
      "pegarr:harness",
    ]);
    if (app.status !== 0) {
      throw new Error(`${accessScenario} could not start protected Pegarr:\n${outputOf(app)}`);
    }
    let ready;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      ready = docker(["exec", appName, "node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(r.status!==200)process.exit(1)})"]);
      if (ready.status === 0) break;
      await delay(250);
    }
    if (ready?.status !== 0) {
      throw new Error(`${accessScenario} protected Pegarr did not become ready:\n${outputOf(ready)}`);
    }
    const accessProbe = [
      `const token = ${JSON.stringify(keys.access)};`,
      "const endpoint = 'http://127.0.0.1:8080/api/v1/library/missing';",
      "const app = 'http://127.0.0.1:8080';",
      "const countUrl = 'http://sonarr-fixture:8082/__count';",
      "(async () => {",
      "  const [page, client, modelResponse, styles] = await Promise.all([fetch(app + '/'), fetch(app + '/assets/dashboard.js'), fetch(app + '/assets/dashboard-model.js'), fetch(app + '/assets/dashboard.css')]);",
      "  const [pageText, clientText, modelText, stylesText] = await Promise.all([page.text(), client.text(), modelResponse.text(), styles.text()]);",
      "  if (![page, client, modelResponse, styles].every((response) => response.status === 200) || !pageText.includes('id=\"inventory-list\"') || !clientText.includes('credentials: \"omit\"') || !clientText.includes('?refresh=1') || !stylesText.includes('@media (max-width: 760px)') || !page.headers.get('content-security-policy')?.includes(\"default-src 'self'\")) throw new Error('dashboard asset contract mismatch');",
      "  if (/localStor(?:age)|sessionStor(?:age)|document\\.cookie|innerHTML/u.test(clientText)) throw new Error('dashboard client crossed the browser storage or DOM boundary');",
      "  const queryToken = await fetch(endpoint + '?token=' + encodeURIComponent(token));",
      "  const wrong = await fetch(endpoint, { headers: { authorization: 'Bearer synthetic-wrong-access-token-00000001' } });",
      "  const mutation = await fetch(endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + token } });",
      "  const itemEndpoint = app + '/api/v1/library/items/sonarr/episode/305/feasibility';",
      "  const itemWrong = await fetch(itemEndpoint, { headers: { authorization: 'Bearer synthetic-wrong-access-token-00000001' } });",
      "  const itemMutation = await fetch(itemEndpoint, { method: 'POST', headers: { authorization: 'Bearer ' + token } });",
      "  const before = Number(await (await fetch(countUrl)).text());",
      "  if (queryToken.status !== 401 || wrong.status !== 401 || mutation.status !== 405 || itemWrong.status !== 401 || itemMutation.status !== 405 || before !== 2) throw new Error('unauthorized request crossed the boundary');",
      "  const response = await fetch(endpoint, { headers: { authorization: 'Bearer ' + token } });",
      "  const body = await response.json();",
      "  const cached = await fetch(endpoint, { headers: { authorization: 'Bearer ' + token } });",
      "  const cachedBody = await cached.json();",
      "  const after = Number(await (await fetch(countUrl)).text());",
      "  if (response.status !== 200 || cached.status !== 200 || body.status !== 'ready' || body.mode !== 'read_only' || body.metrics.itemCount !== 4 || cachedBody.metrics.itemCount !== 4 || after !== 4) throw new Error('authorized inventory or cache mismatch');",
      "  const modelUrl = 'data:text/javascript;base64,' + Buffer.from(modelText).toString('base64');",
      "  const dashboardModel = await import(modelUrl);",
      "  const rows = dashboardModel.rowsFromInventory(body);",
      "  const movies = dashboardModel.selectRows(rows, { kind: 'movie', sort: 'title-asc' });",
      "  const itemResponse = await fetch(itemEndpoint, { headers: { authorization: 'Bearer ' + token } });",
      "  const itemBody = await itemResponse.json();",
      "  const cachedItem = await fetch(itemEndpoint, { headers: { authorization: 'Bearer ' + token } });",
      "  const cachedItemBody = await cachedItem.json();",
      "  const itemView = dashboardModel.feasibilityView(itemBody);",
      "  const finalCount = Number(await (await fetch(countUrl)).text());",
      "  if (rows.length !== 4 || movies.length !== 2 || after !== 4) throw new Error('packaged local dashboard controls mismatch');",
      "  if (itemResponse.status !== 200 || cachedItem.status !== 200 || itemBody.status !== 'ready' || itemBody.analysis?.source !== 'computed' || cachedItemBody.analysis?.source !== 'memory_cache' || itemView.state !== 'ready' || itemView.releases.length !== 1 || itemView.releases[0].confidence !== 'confirmed' || itemView.analysis.providerRequests !== 1 || finalCount !== 8) throw new Error('packaged item feasibility mismatch');",
      "  const refreshedItem = await fetch(itemEndpoint + '?refresh=1', { headers: { authorization: 'Bearer ' + token } });",
      "  const refreshedItemBody = await refreshedItem.json();",
      "  const refreshedView = dashboardModel.feasibilityView(refreshedItemBody);",
      "  const refreshedCount = Number(await (await fetch(countUrl)).text());",
      "  if (refreshedItem.status !== 200 || refreshedItemBody.analysis?.source !== 'computed' || refreshedItemBody.metrics?.providerRequests !== 0 || refreshedItemBody.report?.providerStatus?.[0]?.cache?.status !== 'hit' || refreshedView.state !== 'ready' || refreshedView.providers[0]?.cacheStatus !== 'hit' || refreshedCount !== 11) throw new Error('packaged refresh repeated the stable provider window');",
      "  if (clientText.includes('/grab') || pageText.includes('Grab selected release')) throw new Error('Grab crossed the Phase 1 boundary');",
      "  if (response.headers.get('cache-control') !== 'no-store' || response.headers.get('x-content-type-options') !== 'nosniff') throw new Error('security headers missing');",
      "  if (JSON.stringify(body).includes(token)) throw new Error('access token escaped');",
      "  console.log('protected inventory=ready, unauthorized upstream requests=0, item cache and provider window verified');",
      "})().catch((error) => { console.error(error.message); process.exit(1); });",
    ].join("\n");
    const protectedInventory = docker(["exec", appName, "node", "-e", accessProbe]);
    if (protectedInventory.status !== 0 || /synthetic-inventory-(?:access|sonarr|radarr)/iu.test(protectedInventory.stdout)) {
      throw new Error(`${accessScenario} protected inventory probe failed:\n${outputOf(protectedInventory)}`);
    }
    const inspection = docker(["network", "inspect", "--format", "{{.Internal}}", networkName]);
    if (inspection.status !== 0 || inspection.stdout.trim() !== "true") {
      throw new Error(`${scenario} network is not internal-only: ${outputOf(inspection).trim()}`);
    }
    process.stdout.write(`${scenario} packaged missing inventory=ready (two requests, secret-files, read-only, internal-network)\n`);
    process.stdout.write(`${accessScenario} ${protectedInventory.stdout.trim()} (secret-file bearer, internal-network)\n`);
    process.stdout.write(`${dashboardScenario} packaged dashboard=ready (responsive assets, local controls, zero extra upstream requests)\n`);
    process.stdout.write(`${selectionScenario} packaged item analysis=ready (authenticated, cached, one provider window, no Grab)\n`);
    process.stdout.write(`${refreshScenario} packaged refresh=ready (Arr/Bazarr refreshed, provider window reused)\n`);
  } finally {
    docker(["rm", "--force", appName]);
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
    await packagedMissingInventorySmokeTest();
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
    await packagedMissingInventorySmokeTest();
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
