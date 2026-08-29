import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProviderSettingsStore } from "./provider-settings.js";

test("PEG-PROVIDERSETTINGS-001 provider credentials stay separate, private, and redacted", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-provider-settings-"));
  context.after(async () => rm(directory, { recursive: true }));
  const store = new ProviderSettingsStore(directory);
  const secret = "synthetic-subdl-provider-key";

  const result = await store.update("subdl", {
    apiKey: secret,
    languageMappings: [{ policyCode: "pt-BR", providerCode: "PT-BR" }],
  });

  assert.equal(result.revision, 1);
  assert.equal(result.providers[0]?.credentialConfigured, true);
  assert.equal(result.providers[0]?.settingsConfigured, true);
  assert.deepEqual(result.providers[0]?.languageMappings, [{ policyCode: "pt-BR", providerCode: "PT-BR" }]);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-subdl-provider-key/u);
  const metadata = await readFile(join(directory, "provider-settings.json"), "utf8");
  assert.doesNotMatch(metadata, /synthetic-subdl-provider-key|api.?key|credential/iu);
  assert.equal((await stat(join(directory, "provider-settings.json"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(directory, "provider-secrets"))).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, "provider-secrets", "subdl-api-key"))).mode & 0o777, 0o600);
  assert.equal((await store.readCredential("subdl"))?.reveal(), secret);
});

test("PEG-PROVIDERSETTINGS-002 invalid credentials, mappings, and corrupt files fail closed", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-provider-settings-invalid-"));
  context.after(async () => rm(directory, { recursive: true }));
  const store = new ProviderSettingsStore(directory);

  await assert.rejects(store.update("subdl", {
    apiKey: "short",
    languageMappings: [],
  }), /API key is invalid/u);
  await assert.rejects(store.update("opensubtitles", {
    languageMappings: [
      { policyCode: "pt-BR", providerCode: "pt-BR" },
      { policyCode: "pb", providerCode: "pob" },
    ],
  }), /unique/u);

  await writeFile(join(directory, "provider-settings.json"), "{not-json", { mode: 0o600 });
  await assert.rejects(store.read(), /could not be read/u);
});
