import assert from "node:assert/strict";
import test from "node:test";

import type { FeasibilityInput, ProviderSearchResult } from "./domain.js";
import { demoFeasibilityInput } from "./fixtures/demo.js";
import { assessLanguage, buildFeasibilityReport } from "./matching.js";
import { normalizeLanguage, normalizeRelease } from "./normalization.js";

test("normalization keeps evidence while canonicalizing common aliases", () => {
  const release = normalizeRelease("Café.Show.S01E02.1080p.WEB-DL.x265-GROUP");

  assert.equal(release.original, "Café.Show.S01E02.1080p.WEB-DL.x265-GROUP");
  assert.equal(release.canonical, "cafe.show.s01e02.1080p.webdl.h265.group");
  assert.equal(release.source, "webdl");
  assert.equal(release.codec, "h265");
  assert.equal(release.releaseGroup, "group");
  assert.equal(normalizeLanguage("PT_BR"), "pt-br");
});

test("demo report associates subtitle evidence with every Arr release", () => {
  const report = buildFeasibilityReport(demoFeasibilityInput);

  assert.equal(report.mode, "read_only");
  assert.equal(report.releases.length, 4);
  assert.equal(report.releases[0]?.subtitle.confidence, "confirmed");
  assert.equal(report.releases[0]?.subtitle.languages[0]?.evidence?.provider, "subdl");
  assert.equal(report.releases[1]?.subtitle.confidence, "likely");
  assert.equal(report.releases[2]?.video.downloadAllowed, false);
  assert.deepEqual(report.releases[2]?.video.rejectionReasons, [
    "Quality profile does not allow HDTV-720p",
  ]);
  assert.ok(report.releases[3]?.subtitle.languages[0]?.warnings.some((warning) => warning.includes("rate limited")));
});

test("provider failures produce Unknown instead of No match found", () => {
  const providerResults: readonly ProviderSearchResult[] = [
    { provider: "subdl", status: "timeout", subtitles: [] },
  ];
  const result = assessLanguage(
    demoFeasibilityInput.item,
    demoFeasibilityInput.releases[0]!,
    demoFeasibilityInput.policy.languages[0]!,
    providerResults,
  );

  assert.equal(result.confidence, "unknown");
  assert.deepEqual(result.warnings, ["subdl search timed out"]);
});

test("successful empty provider results produce No match found", () => {
  const providerResults: readonly ProviderSearchResult[] = [
    { provider: "subdl", status: "success", subtitles: [] },
  ];
  const result = assessLanguage(
    demoFeasibilityInput.item,
    demoFeasibilityInput.releases[0]!,
    demoFeasibilityInput.policy.languages[0]!,
    providerResults,
  );

  assert.equal(result.confidence, "no_match_found");
  assert.deepEqual(result.warnings, []);
});

test("wrong episodes are rejected before release scoring", () => {
  const input: FeasibilityInput = {
    ...demoFeasibilityInput,
    providerResults: [
      {
        provider: "subdl",
        status: "success",
        subtitles: [
          {
            id: "wrong-episode",
            provider: "subdl",
            language: "pt-BR",
            releaseName: "Example.Show.S03E06.1080p.WEB-DL.H264-GROUP",
            mediaIds: { tvdb: "900005" },
            season: 3,
            episode: 6,
          },
        ],
      },
    ],
  };

  assert.equal(buildFeasibilityReport(input).releases[0]?.subtitle.confidence, "no_match_found");
});
