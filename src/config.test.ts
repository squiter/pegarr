import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigurationError, loadRuntimeConfiguration } from "./config.js";

test("PEG-CONFIG-001 disabled configuration stays disabled and partial input fails safely", async () => {
  assert.deepEqual(await loadRuntimeConfiguration({}), {});

  const privateValue = "https://private-sonarr.example.invalid";
  await assert.rejects(
    loadRuntimeConfiguration({ PEGARR_SONARR_URL: privateValue }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.doesNotMatch(error.message, /private-sonarr/iu);
      return true;
    },
  );
  await assert.rejects(
    loadRuntimeConfiguration({ PEGARR_SONARR_API_KEY: "synthetic-direct-secret" }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.match(error.message, /API_KEY_FILE/u);
      assert.doesNotMatch(error.message, /synthetic-direct-secret/u);
      return true;
    },
  );
});

test("PEG-CONFIG-002 Sonarr credentials load only from a bounded secret file", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-config-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true });
  });
  const secretPath = join(directory, "sonarr-api-key");
  const secret = "synthetic-api-key-value";
  await writeFile(secretPath, `${secret}\n`, { mode: 0o600 });

  const configuration = await loadRuntimeConfiguration({
    PEGARR_SONARR_URL: "http://sonarr.example.invalid:8989",
    PEGARR_SONARR_ALLOWED_HOSTS: "sonarr.example.invalid",
    PEGARR_SONARR_API_KEY_FILE: secretPath,
    PEGARR_SONARR_ALLOW_INSECURE_HTTP: "true",
    PEGARR_SONARR_INSTANCE_ID: "synthetic-sonarr",
  });

  assert.equal(configuration.sonarr?.apiKey.reveal(), secret);
  assert.equal(configuration.sonarr?.allowInsecureHttp, true);
  assert.deepEqual(configuration.sonarr?.allowedHosts, ["sonarr.example.invalid"]);
  assert.doesNotMatch(JSON.stringify(configuration), new RegExp(secret, "u"));
  assert.match(JSON.stringify(configuration), /\[redacted\]/u);

  await assert.rejects(
    loadRuntimeConfiguration({
      PEGARR_SONARR_URL: "https://sonarr.example.invalid",
      PEGARR_SONARR_ALLOWED_HOSTS: "sonarr.example.invalid",
      PEGARR_SONARR_API_KEY_FILE: join(directory, "private-missing-file"),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.doesNotMatch(error.message, /private-missing-file/iu);
      return true;
    },
  );

  const oversizedPath = join(directory, "oversized-key");
  await writeFile(oversizedPath, "s".repeat(4_097), { mode: 0o600 });
  await assert.rejects(
    loadRuntimeConfiguration({
      PEGARR_SONARR_URL: "https://sonarr.example.invalid",
      PEGARR_SONARR_ALLOWED_HOSTS: "sonarr.example.invalid",
      PEGARR_SONARR_API_KEY_FILE: oversizedPath,
    }),
    /4096-byte limit/u,
  );
});

test("PEG-CONFIG-003 Radarr credentials use an independent bounded secret-file contract", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-radarr-config-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true });
  });
  const secretPath = join(directory, "radarr-api-key");
  const secret = "synthetic-radarr-key-value";
  await writeFile(secretPath, `${secret}\n`, { mode: 0o600 });

  const configuration = await loadRuntimeConfiguration({
    PEGARR_RADARR_URL: "http://radarr.example.invalid:7878/root",
    PEGARR_RADARR_ALLOWED_HOSTS: "radarr.example.invalid",
    PEGARR_RADARR_API_KEY_FILE: secretPath,
    PEGARR_RADARR_ALLOW_INSECURE_HTTP: "true",
    PEGARR_RADARR_INSTANCE_ID: "synthetic-radarr",
  });

  assert.equal(configuration.radarr?.apiKey.reveal(), secret);
  assert.equal(configuration.radarr?.instanceId, "synthetic-radarr");
  assert.equal(configuration.radarr?.allowInsecureHttp, true);
  assert.deepEqual(configuration.radarr?.allowedHosts, ["radarr.example.invalid"]);
  assert.doesNotMatch(JSON.stringify(configuration), new RegExp(secret, "u"));
  assert.match(JSON.stringify(configuration), /\[redacted\]/u);

  await assert.rejects(
    loadRuntimeConfiguration({ PEGARR_RADARR_API_KEY: "synthetic-direct-radarr-secret" }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.match(error.message, /PEGARR_RADARR_API_KEY_FILE/u);
      assert.doesNotMatch(error.message, /synthetic-direct-radarr-secret/u);
      return true;
    },
  );
});

test("PEG-CONFIG-004 Bazarr credentials use an independent bounded secret-file contract", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-bazarr-config-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true });
  });
  const secretPath = join(directory, "bazarr-api-key");
  const secret = "synthetic-bazarr-key-value";
  await writeFile(secretPath, `${secret}\n`, { mode: 0o600 });

  const configuration = await loadRuntimeConfiguration({
    PEGARR_BAZARR_URL: "http://bazarr.example.invalid:6767",
    PEGARR_BAZARR_ALLOWED_HOSTS: "bazarr.example.invalid",
    PEGARR_BAZARR_API_KEY_FILE: secretPath,
    PEGARR_BAZARR_ALLOW_INSECURE_HTTP: "true",
    PEGARR_BAZARR_INSTANCE_ID: "synthetic-bazarr",
  });

  assert.equal(configuration.bazarr?.apiKey.reveal(), secret);
  assert.equal(configuration.bazarr?.instanceId, "synthetic-bazarr");
  assert.equal(configuration.bazarr?.allowInsecureHttp, true);
  assert.deepEqual(configuration.bazarr?.allowedHosts, ["bazarr.example.invalid"]);
  assert.doesNotMatch(JSON.stringify(configuration), new RegExp(secret, "u"));

  await assert.rejects(
    loadRuntimeConfiguration({ PEGARR_BAZARR_API_KEY: "synthetic-direct-bazarr-secret" }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.match(error.message, /PEGARR_BAZARR_API_KEY_FILE/u);
      assert.doesNotMatch(error.message, /synthetic-direct-bazarr-secret/u);
      return true;
    },
  );
});

test("PEG-CONFIG-005 SubDL credentials use an independent bounded secret-file contract", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-subdl-config-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true });
  });
  const secretPath = join(directory, "subdl-api-key");
  const secret = "synthetic.subdl-key_value==";
  await writeFile(secretPath, `${secret}\n`, { mode: 0o600 });

  const configuration = await loadRuntimeConfiguration({
    PEGARR_SUBDL_URL: "https://api.subdl.example.invalid",
    PEGARR_SUBDL_ALLOWED_HOSTS: "api.subdl.example.invalid",
    PEGARR_SUBDL_API_KEY_FILE: secretPath,
    PEGARR_SUBDL_INSTANCE_ID: "synthetic-subdl",
  });

  assert.equal(configuration.subdl?.apiKey.reveal(), secret);
  assert.equal(configuration.subdl?.instanceId, "synthetic-subdl");
  assert.equal(configuration.subdl?.allowInsecureHttp, false);
  assert.deepEqual(configuration.subdl?.allowedHosts, ["api.subdl.example.invalid"]);
  assert.doesNotMatch(JSON.stringify(configuration), new RegExp(secret, "u"));

  await assert.rejects(
    loadRuntimeConfiguration({ PEGARR_SUBDL_API_KEY: "synthetic-direct-subdl-secret" }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.match(error.message, /PEGARR_SUBDL_API_KEY_FILE/u);
      assert.doesNotMatch(error.message, /synthetic-direct-subdl-secret/u);
      return true;
    },
  );
});

test("PEG-CONFIG-006 browser API access uses only a bounded secret file", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-access-config-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true });
  });
  const secretPath = join(directory, "access-token");
  const secret = "synthetic-access-token-value-0000000001";
  await writeFile(secretPath, `${secret}\n`, { mode: 0o600 });

  const configuration = await loadRuntimeConfiguration({
    PEGARR_ACCESS_TOKEN_FILE: secretPath,
  });
  assert.equal(configuration.accessToken?.reveal(), secret);
  assert.equal(JSON.stringify(configuration), '{"accessToken":"[redacted]"}');

  await assert.rejects(
    loadRuntimeConfiguration({ PEGARR_ACCESS_TOKEN: secret }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.match(error.message, /PEGARR_ACCESS_TOKEN_FILE/u);
      assert.doesNotMatch(error.message, new RegExp(secret, "u"));
      return true;
    },
  );

  const shortPath = join(directory, "short-token");
  await writeFile(shortPath, "too-short", { mode: 0o600 });
  await assert.rejects(
    loadRuntimeConfiguration({ PEGARR_ACCESS_TOKEN_FILE: shortPath }),
    /does not contain one valid token/u,
  );
});

test("PEG-CONFIG-007 runtime SubDL language mappings are explicit, bounded, and canonical", async () => {
  const configuration = await loadRuntimeConfiguration({
    PEGARR_SUBDL_LANGUAGE_MAPPINGS: "en:EN, pt-BR:PT-BR, es:ES",
  });
  assert.deepEqual(configuration.subdlLanguageMappings, [
    { policyCode: "en", providerCode: "EN" },
    { policyCode: "pt-BR", providerCode: "PT-BR" },
    { policyCode: "es", providerCode: "ES" },
  ]);
  await assert.rejects(
    loadRuntimeConfiguration({ PEGARR_SUBDL_LANGUAGE_MAPPINGS: "pt-BR:PT-BR,pb:PB" }),
    /invalid or duplicate/u,
  );
  await assert.rejects(
    loadRuntimeConfiguration({ PEGARR_SUBDL_LANGUAGE_MAPPINGS: "not-a-pair" }),
    /policy:provider/u,
  );
});

test("PEG-CONFIG-008 controlled Grab is opt-in and requires independent secret-file administration", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-synthetic-grab-config-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true });
  });
  const accessPath = join(directory, "access-token");
  const adminPath = join(directory, "admin-token");
  const auditPath = join(directory, "grab-audit.sqlite");
  const access = "synthetic-access-token-value-0000000001";
  const admin = "synthetic-admin-token-value-00000000001";
  await Promise.all([
    writeFile(accessPath, access, { mode: 0o600 }),
    writeFile(adminPath, admin, { mode: 0o600 }),
  ]);

  const configuration = await loadRuntimeConfiguration({
    PEGARR_ACCESS_TOKEN_FILE: accessPath,
    PEGARR_GRAB_ENABLED: "true",
    PEGARR_ADMIN_TOKEN_FILE: adminPath,
    PEGARR_GRAB_AUDIT_FILE: auditPath,
  });
  assert.equal(configuration.controlledGrab?.enabled, true);
  assert.equal(configuration.controlledGrab?.adminToken.reveal(), admin);
  assert.equal(configuration.controlledGrab?.auditFile, auditPath);
  assert.doesNotMatch(JSON.stringify(configuration), new RegExp(admin, "u"));

  await assert.rejects(
    loadRuntimeConfiguration({ PEGARR_ADMIN_TOKEN: admin }),
    /PEGARR_ADMIN_TOKEN_FILE/u,
  );
  await assert.rejects(
    loadRuntimeConfiguration({ PEGARR_ADMIN_TOKEN_FILE: adminPath }),
    /PEGARR_GRAB_ENABLED=true/u,
  );
  await assert.rejects(
    loadRuntimeConfiguration({
      PEGARR_GRAB_ENABLED: "true",
      PEGARR_ADMIN_TOKEN_FILE: adminPath,
      PEGARR_GRAB_AUDIT_FILE: auditPath,
    }),
    /PEGARR_ACCESS_TOKEN_FILE/u,
  );
  await assert.rejects(
    loadRuntimeConfiguration({
      PEGARR_ACCESS_TOKEN_FILE: accessPath,
      PEGARR_GRAB_ENABLED: "true",
      PEGARR_ADMIN_TOKEN_FILE: adminPath,
      PEGARR_GRAB_AUDIT_FILE: "relative.sqlite",
    }),
    /absolute path/u,
  );
  await assert.rejects(
    loadRuntimeConfiguration({
      PEGARR_ACCESS_TOKEN_FILE: accessPath,
      PEGARR_GRAB_ENABLED: "true",
      PEGARR_ADMIN_TOKEN_FILE: accessPath,
      PEGARR_GRAB_AUDIT_FILE: auditPath,
    }),
    /must be different/u,
  );
});

test("PEG-CONFIG-009 multiple Arr instances load from bounded secret-reference files", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-multi-arr-config-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true });
  });
  const mainKey = join(directory, "sonarr-main-key");
  const animeKey = join(directory, "sonarr-anime-key");
  const instancesFile = join(directory, "sonarr-instances.json");
  await Promise.all([
    writeFile(mainKey, "synthetic-sonarr-main-key", { mode: 0o600 }),
    writeFile(animeKey, "synthetic-sonarr-anime-key", { mode: 0o600 }),
    writeFile(instancesFile, JSON.stringify([
      { instanceId: "sonarr-main", baseUrl: "https://sonarr-main.example.invalid", allowedHosts: ["sonarr-main.example.invalid"], apiKeyFile: mainKey },
      { instanceId: "sonarr-anime", baseUrl: "http://sonarr-anime.example.invalid:8989", allowedHosts: ["sonarr-anime.example.invalid"], allowInsecureHttp: true, apiKeyFile: animeKey },
    ]), { mode: 0o600 }),
  ]);

  const configuration = await loadRuntimeConfiguration({ PEGARR_SONARR_INSTANCES_FILE: instancesFile });
  assert.deepEqual(configuration.sonarrInstances?.map(({ instanceId, allowInsecureHttp }) => ({ instanceId, allowInsecureHttp })), [
    { instanceId: "sonarr-main", allowInsecureHttp: false },
    { instanceId: "sonarr-anime", allowInsecureHttp: true },
  ]);
  assert.equal(configuration.sonarrInstances?.[1]?.apiKey.reveal(), "synthetic-sonarr-anime-key");
  assert.doesNotMatch(JSON.stringify(configuration), /synthetic-sonarr-(?:main|anime)-key/u);

  await assert.rejects(loadRuntimeConfiguration({
    PEGARR_SONARR_INSTANCES_FILE: instancesFile,
    PEGARR_SONARR_URL: "https://legacy.example.invalid",
  }), /cannot be combined/u);
  await writeFile(instancesFile, JSON.stringify([
    { instanceId: "duplicate", baseUrl: "https://one.example.invalid", allowedHosts: ["one.example.invalid"], apiKeyFile: mainKey },
    { instanceId: "DUPLICATE", baseUrl: "https://two.example.invalid", allowedHosts: ["two.example.invalid"], apiKeyFile: animeKey },
  ]), { mode: 0o600 });
  await assert.rejects(loadRuntimeConfiguration({ PEGARR_SONARR_INSTANCES_FILE: instancesFile }), /unique safe labels/u);
});
