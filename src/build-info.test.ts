import assert from "node:assert/strict";
import test from "node:test";

import { currentBuildInfo, parseBuildInfo } from "./build-info.js";

test("PEG-RELEASE-001 build identity exposes the semantic version and only a safe Git revision", () => {
  assert.deepEqual(parseBuildInfo('{"version":"1.2.3"}', "ABCDEF0123456789"), {
    service: "pegarr",
    version: "1.2.3",
    revision: "abcdef0123456789",
  });
  assert.deepEqual(parseBuildInfo('{"version":"1.2.3-rc.1"}', "private revision value"), {
    service: "pegarr",
    version: "1.2.3-rc.1",
  });
  assert.throws(() => parseBuildInfo('{"version":"latest"}', undefined), /semantic version/u);
  assert.equal(currentBuildInfo.version, "0.1.0");
});
