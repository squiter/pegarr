import assert from "node:assert/strict";
import test from "node:test";

import type { FeasibilityInput, ProviderSearchResult } from "./domain.js";
import { demoFeasibilityInput } from "./fixtures/demo.js";
import { assessLanguage, buildFeasibilityReport } from "./matching.js";
import { normalizeLanguage, normalizeRelease } from "./normalization.js";

test("PEG-MATCH-001 normalization keeps evidence while canonicalizing common aliases", () => {
  const release = normalizeRelease("Café.Show.S01E02.1080p.WEB-DL.x265-GROUP");

  assert.equal(release.original, "Café.Show.S01E02.1080p.WEB-DL.x265-GROUP");
  assert.equal(release.canonical, "cafe.show.s01e02.1080p.webdl.h265.group");
  assert.equal(release.source, "webdl");
  assert.equal(release.codec, "h265");
  assert.equal(release.releaseGroup, "group");
  assert.equal(normalizeLanguage("PT_BR"), "pt-br");
});

test("PEG-MATCH-002 demo report associates subtitle evidence with every Arr release", () => {
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

test("PEG-MATCH-003 provider failures produce Unknown instead of No match found", () => {
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

test("PEG-MATCH-004 successful empty provider results produce No match found", () => {
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

test("PEG-MATCH-005 wrong episodes are rejected before release scoring", () => {
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

test("PEG-MATCH-006 forced and hearing-impaired requirements filter candidates locally", () => {
  const baseCandidate = {
    id: "subtitle-type",
    provider: "subdl",
    language: "en",
    releaseName: demoFeasibilityInput.releases[0]!.title,
    mediaIds: demoFeasibilityInput.item.ids,
    season: 3,
    episode: 5,
  };
  const providerResults: readonly ProviderSearchResult[] = [
    {
      provider: "subdl",
      status: "success",
      subtitles: [
        { ...baseCandidate, id: "normal", hearingImpaired: false, forced: false },
        { ...baseCandidate, id: "hi", hearingImpaired: true, forced: false },
        { ...baseCandidate, id: "forced", hearingImpaired: false, forced: true },
      ],
    },
  ];

  const normal = assessLanguage(
    demoFeasibilityInput.item,
    demoFeasibilityInput.releases[0]!,
    { code: "en", required: true, forced: false, hearingImpaired: "avoid" },
    providerResults,
  );
  const hearingImpaired = assessLanguage(
    demoFeasibilityInput.item,
    demoFeasibilityInput.releases[0]!,
    { code: "en", required: true, forced: false, hearingImpaired: "required" },
    providerResults,
  );
  const forced = assessLanguage(
    demoFeasibilityInput.item,
    demoFeasibilityInput.releases[0]!,
    { code: "en", required: true, forced: true, hearingImpaired: "either" },
    providerResults,
  );

  assert.equal(normal.evidence?.subtitleId, "normal");
  assert.equal(hearingImpaired.evidence?.subtitleId, "hi");
  assert.equal(forced.evidence?.subtitleId, "forced");
});

test("PEG-MATCH-007 missing required subtitle-type metadata remains Unknown", () => {
  const result = assessLanguage(
    demoFeasibilityInput.item,
    demoFeasibilityInput.releases[0]!,
    { code: "en", required: true, forced: true, hearingImpaired: "either" },
    [
      {
        provider: "subdl",
        status: "success",
        subtitles: [
          {
            id: "type-unreported",
            provider: "subdl",
            language: "en",
            releaseName: demoFeasibilityInput.releases[0]!.title,
            mediaIds: demoFeasibilityInput.item.ids,
            season: 3,
            episode: 5,
          },
        ],
      },
    ],
  );

  assert.equal(result.confidence, "unknown");
  assert.deepEqual(result.warnings, [
    "subdl did not report the required subtitle-type evidence",
  ]);
});

test("PEG-MATCH-008 provider searches are scoped to the language actually queried", () => {
  const release = demoFeasibilityInput.releases[0]!;
  const providerResults: readonly ProviderSearchResult[] = [
    {
      provider: "subdl",
      status: "success",
      searchedLanguages: ["pt-BR"],
      subtitles: [],
    },
  ];

  const portuguese = assessLanguage(
    demoFeasibilityInput.item,
    release,
    { code: "pt_br", required: true, forced: false, hearingImpaired: "either" },
    providerResults,
  );
  const english = assessLanguage(
    demoFeasibilityInput.item,
    release,
    { code: "en", required: true, forced: false, hearingImpaired: "either" },
    providerResults,
  );

  assert.equal(portuguese.confidence, "no_match_found");
  assert.equal(english.confidence, "unknown");
  assert.deepEqual(english.warnings, ["No provider search covered this language"]);
});
