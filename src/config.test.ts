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
