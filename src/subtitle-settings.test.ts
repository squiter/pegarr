import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SubtitleSettingsStore } from "./subtitle-settings.js";

test("PEG-SETTINGS-001 subtitle policy persists atomically without provider secrets", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-subtitle-settings-"));
  context.after(async () => rm(directory, { recursive: true }));
  const store = new SubtitleSettingsStore(directory);
  assert.equal((await store.read()).status, "unconfigured");

  const result = await store.update({ languages: [
    { code: "pt-BR", required: true, forced: false, hearingImpaired: "prefer" },
    { code: "en", required: false, forced: false, hearingImpaired: "either" },
  ] });
  assert.equal(result.status, "configured");
  assert.equal(result.revision, 1);
  assert.deepEqual((await store.read()).policy.languages, result.policy.languages);
  const path = join(directory, "subtitle-settings.json");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(path, "utf8"), /api.?key|authorization|password|token/iu);
});

test("PEG-SETTINGS-002 invalid, duplicate, oversized, and corrupt policy fails closed", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "pegarr-subtitle-settings-invalid-"));
  context.after(async () => rm(directory, { recursive: true }));
  const store = new SubtitleSettingsStore(directory);
  await assert.rejects(store.update({ languages: [
    { code: "pt-BR", required: true, forced: false, hearingImpaired: "either" },
    { code: "pb", required: true, forced: false, hearingImpaired: "either" },
  ] }), /unique/u);
  await assert.rejects(store.update({ languages: Array.from({ length: 17 }, (_, index) => ({ code: `x-${index}`, required: true, forced: false, hearingImpaired: "either" as const })) }), /at most 16/u);

  await writeFile(join(directory, "subtitle-settings.json"), "{not-json", { mode: 0o600 });
  await assert.rejects(store.read(), /could not be read/u);
});
