import assert from "node:assert/strict";
import test from "node:test";

import { demoFeasibilityInput } from "./fixtures/demo.js";
import { buildFeasibilityReport } from "./matching.js";
import { activeInventoryFilterCount, catalogCoverageView, displayLanguageCode, feasibilityView, itemAnalysisSummary, leadingRelease, releaseComparison, rowsFromInventory, rowsWithAnalysis, selectReleases, selectRows, shortlistedReleases, subtitleLanguageRequirements } from "./web/dashboard-model.js";

const inventory = {
  status: "ready",
  sources: [
    {
      integration: "sonarr",
      status: "ready",
      page: {
        items: [
          {
            application: "sonarr",
            instanceId: "sonarr-main",
            kind: "episode",
            itemId: 305,
            title: "Episode Five",
            parentTitle: "Synthetic Show",
            season: 3,
            episode: 5,
            availableAt: "2024-03-05T20:00:00Z",
          },
        ],
      },
    },
    {
      integration: "radarr",
      status: "ready",
      page: {
        items: [
          {
            application: "radarr",
            instanceId: "radarr-main",
            kind: "movie",
            itemId: 84,
            title: "A Synthetic Movie",
            year: 2024,
            availableAt: "2024-05-12T00:00:00Z",
          },
          {
            application: "radarr",
            instanceId: "radarr-main",
            kind: "movie",
            itemId: 85,
            title: "Later Movie",
            year: 2023,
          },
        ],
      },
    },
  ],
};

test("PEG-DASH-053 catalog coverage distinguishes availability from actionable provider failures", () => {
  const available = catalogCoverageView({
    status: "ready",
    languages: [{ code: "pt-BR", state: "available", subtitleCount: 12 }],
    providers: [{ provider: "subdl", status: "success", searchedLanguages: ["pt-br"] }],
  });
  assert.deepEqual(available, {
    state: "ready",
    languages: [{ code: "pt-BR", displayCode: "pt-BR", state: "available", label: "pt-BR: Available (12 matches)" }],
    providers: [{ id: "subdl", name: "SubDL", status: "success", message: "SubDL: checked successfully." }],
  });

  const unknown = catalogCoverageView({
    status: "ready",
    languages: [{ code: "pt_BR", state: "unknown", subtitleCount: 0 }],
    providers: [{ provider: "subdl", status: "unauthorized", searchedLanguages: ["pt-br"] }],
  });
  assert.deepEqual(unknown, {
    state: "ready",
    languages: [{ code: "pt-BR", displayCode: "pt-BR", state: "unknown", label: "pt-BR: Could not check" }],
    providers: [{ id: "subdl", name: "SubDL", status: "unauthorized", message: "SubDL: rejected this request. Try again; if it keeps failing, update the API key in Setup & settings." }],
  });
});

test("PEG-DASH-056 Bazarr language aliases use canonical display labels without changing policy identity", () => {
  assert.equal(displayLanguageCode("pb"), "pt-BR");
  assert.equal(displayLanguageCode("pt_BR"), "pt-BR");
  assert.equal(displayLanguageCode("EN"), "en");
  assert.equal(displayLanguageCode("zh_hant"), "zh-Hant");
  assert.equal(displayLanguageCode("es-419"), "es-419");

  const report = buildFeasibilityReport(demoFeasibilityInput);
  const view = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    report: {
      ...report,
      policy: {
        ...report.policy,
        languages: report.policy.languages.map((language, index) => index === 0 ? { ...language, code: "pb" } : language),
      },
    },
  });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  assert.equal(view.languages[0]?.code, "pb");
  assert.equal(view.languages[0]?.displayCode, "pt-BR");

  const coverage = catalogCoverageView({
    status: "ready",
    languages: [{ code: "pb", state: "available", subtitleCount: 7 }],
    providers: [{ provider: "subdl", status: "success" }],
  });
  assert.equal(coverage.state, "ready");
  if (coverage.state !== "ready") return;
  assert.equal(coverage.languages[0]?.code, "pb");
  assert.equal(coverage.languages[0]?.displayCode, "pt-BR");
  assert.equal(coverage.languages[0]?.label, "pt-BR: Available (7 matches)");
});

test("PEG-DASH-001 inventory view-model mapping preserves only display-safe fields", () => {
  const rows = rowsFromInventory(inventory);

  assert.deepEqual(rows, [
    {
      key: "sonarr:sonarr-main:episode:305",
      itemId: 305,
      application: "sonarr",
      instanceId: "sonarr-main",
      kind: "episode",
      title: "Synthetic Show",
      context: "S03E05 · Episode Five",
      availableAt: "2024-03-05T20:00:00Z",
    },
    {
      key: "radarr:radarr-main:movie:84",
      itemId: 84,
      application: "radarr",
      instanceId: "radarr-main",
      kind: "movie",
      title: "A Synthetic Movie",
      context: "2024",
      availableAt: "2024-05-12T00:00:00Z",
    },
    {
      key: "radarr:radarr-main:movie:85",
      itemId: 85,
      application: "radarr",
      instanceId: "radarr-main",
      kind: "movie",
      title: "Later Movie",
      context: "2023",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /ids|path|overview|token/iu);
});

test("PEG-DASH-040 inventory keys remain unique across Arr instances", () => {
  const item = inventory.sources[0]!.page.items[0]!;
  const rows = rowsFromInventory({
    status: "ready",
    sources: [{
      status: "ready",
      page: { items: [item, { ...item, instanceId: "sonarr-anime" }] },
    }],
  });

  assert.deepEqual(rows.map(({ key }) => key), [
    "sonarr:sonarr-main:episode:305",
    "sonarr:sonarr-anime:episode:305",
  ]);
  assert.equal(new Set(rows.map(({ key }) => key)).size, 2);
});

test("PEG-SETTINGS-004 per-language policy preferences remain explicit and bounded", () => {
  assert.deepEqual(subtitleLanguageRequirements("pt-BR, en", [
    { code: "pt_br", required: true, forced: true, hearingImpaired: "avoid" },
    { code: "EN", required: false, forced: false, hearingImpaired: "prefer" },
  ]), [
    { code: "pt-BR", required: true, forced: true, hearingImpaired: "avoid" },
    { code: "en", required: false, forced: false, hearingImpaired: "prefer" },
  ]);
  assert.deepEqual(subtitleLanguageRequirements("fr", [{ code: "fr", required: true, forced: false, hearingImpaired: "unsafe" as never }]), [
    { code: "fr", required: true, forced: false, hearingImpaired: "either" },
  ]);
  assert.throws(() => subtitleLanguageRequirements("pt-BR, PT_br"), /unique/u);
  assert.throws(() => subtitleLanguageRequirements(new Array(17).fill(0).map((_, index) => `lang-${index}`).join(",")), /1 through 16/u);
  assert.throws(() => subtitleLanguageRequirements("unsafe code"), /Invalid subtitle language code/u);
});

test("PEG-DASH-004 release view preserves Arr rejections and honest subtitle evidence", () => {
  const view = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    selection: { application: "sonarr", kind: "episode", itemId: 305 },
    report: buildFeasibilityReport(demoFeasibilityInput),
    metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 2, elapsedMs: 5 },
  });

  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  assert.equal(view.releases.length, 4);
  assert.equal(view.releases[0]?.downloadAllowed, true);
  const rejected = view.releases.find(({ downloadAllowed }) => !downloadAllowed);
  assert.deepEqual(rejected?.rejectionReasons, ["Quality profile does not allow HDTV-720p"]);
  assert.ok(view.releases.some(({ languages }) => languages.some(({ confidence }) => confidence === "unknown")));
  assert.ok(view.releases.some(({ languages }) => languages.some(({ evidence }) => evidence?.reasons.includes("Exact normalized release name"))));

  assert.deepEqual(
    feasibilityView({ kind: "item-feasibility", mode: "read_only", status: "policy_unresolved", reason: "unassigned" }),
    { state: "policy_unresolved", message: "Bazarr policy is unassigned. Pegarr did not assume a subtitle language." },
  );
});

test("PEG-DASH-005 analysis diagnostics preserve safe request, quota, and cache evidence", () => {
  const report = buildFeasibilityReport(demoFeasibilityInput);
  const view = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    selection: { application: "sonarr", kind: "episode", itemId: 305 },
    analysis: {
      source: "memory_cache",
      generatedAt: "2026-08-27T12:00:00.000Z",
      expiresAt: "2026-08-27T12:00:30.000Z",
    },
    report: {
      ...report,
      providerStatus: [{
        provider: "subdl",
        status: "success",
        searchedLanguages: ["pt-BR"],
        quota: { limit: 2_000, remaining: 1_999, resetAtEpochSeconds: 1_788_000_000, windowSeconds: 1 },
        cache: {
          status: "hit",
          storedAt: "2026-08-27T11:59:00.000Z",
          expiresAt: "2026-08-27T12:14:00.000Z",
        },
      }],
    },
    metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 0, elapsedMs: 17 },
  });

  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  assert.deepEqual(view.analysis, {
    source: "memory_cache",
    generatedAt: "2026-08-27T12:00:00.000Z",
    expiresAt: "2026-08-27T12:00:30.000Z",
    unavailableIntegrations: [],
    elapsedMs: 17,
    arrRequests: 1,
    bazarrRequests: 2,
    providerRequests: 0,
  });
  assert.deepEqual(view.providers, [{
    provider: "subdl",
    status: "success",
    detail: "",
    cacheStatus: "hit",
    cachedAt: "2026-08-27T11:59:00.000Z",
    cacheExpiresAt: "2026-08-27T12:14:00.000Z",
    quota: { limit: 2_000, remaining: 1_999, resetAtEpochSeconds: 1_788_000_000, windowSeconds: 1 },
  }]);
  assert.ok(view.releases.some(({ languages }) => languages.some(({ providerCount }) => providerCount > 0)));
  assert.doesNotMatch(JSON.stringify(view), /token|api.?key|example\.invalid/iu);
});

test("PEG-DASH-006 stale analysis remains visibly distinct from fresh evidence", () => {
  const view = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    selection: { application: "sonarr", kind: "episode", itemId: 305 },
    analysis: {
      source: "stale_cache",
      generatedAt: "2026-08-27T12:00:00.000Z",
      expiresAt: "2026-08-27T12:00:30.000Z",
      staleUntil: "2026-08-27T18:00:30.000Z",
      refreshFailure: "integration_failure",
      unavailableIntegrations: ["sonarr", "bazarr", "private-upstream"],
    },
    report: buildFeasibilityReport(demoFeasibilityInput),
    metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 1, elapsedMs: 8 },
  });

  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  assert.deepEqual(view.analysis, {
    source: "stale_cache",
    generatedAt: "2026-08-27T12:00:00.000Z",
    expiresAt: "2026-08-27T12:00:30.000Z",
    staleUntil: "2026-08-27T18:00:30.000Z",
    refreshFailure: "integration_failure",
    unavailableIntegrations: ["sonarr", "bazarr"],
    elapsedMs: 8,
    arrRequests: 1,
    bazarrRequests: 2,
    providerRequests: 1,
  });
  assert.equal(view.releases.length, 4);
  assert.doesNotMatch(JSON.stringify(view), /private-upstream/iu);
});

test("PEG-DASH-038 controlled Grab capability is explicit and defaults off", () => {
  const report = buildFeasibilityReport(demoFeasibilityInput);
  const disabled = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report });
  const enabled = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    capabilities: { controlledGrab: true },
    report,
  });
  assert.equal(disabled.state === "ready" && disabled.controlledGrab, false);
  assert.equal(enabled.state === "ready" && enabled.controlledGrab, true);
});

test("PEG-DASH-007 release filtering and sorting stay local and preserve Arr decisions", () => {
  const view = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    selection: { application: "sonarr", kind: "episode", itemId: 305 },
    report: buildFeasibilityReport(demoFeasibilityInput),
    metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 2, elapsedMs: 5 },
  });

  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  const originalOrder = view.releases.map(({ id }) => id);
  const rejected = selectReleases(view.releases, { decision: "rejected" });
  const confirmed = selectReleases(view.releases, { confidence: "confirmed" });
  const byCustomFormat = selectReleases(view.releases, { sort: "custom-format-desc" });
  const byTitle = selectReleases(view.releases, { sort: "title-asc" });

  assert.ok(rejected.length > 0);
  assert.ok(rejected.every(({ downloadAllowed, rejectionReasons }) => !downloadAllowed && rejectionReasons.length > 0));
  assert.ok(confirmed.length > 0);
  assert.ok(confirmed.every(({ confidence }) => confidence === "confirmed"));
  assert.ok(byCustomFormat.every((release, index) => index === 0 || byCustomFormat[index - 1]!.customFormatScore >= release.customFormatScore));
  assert.deepEqual(byTitle.map(({ title }) => title), byTitle.map(({ title }) => title).toSorted((left, right) => left.localeCompare(right)));
  assert.deepEqual(view.releases.map(({ id }) => id), originalOrder);
  assert.deepEqual(selectReleases(view.releases, { decision: "unsafe", confidence: "unsafe", sort: "unsafe" }), view.releases);
});

test("PEG-DASH-014 release rows preserve safe Arr metadata needed for comparison", () => {
  const view = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    report: buildFeasibilityReport(demoFeasibilityInput),
  });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;

  assert.deepEqual({
    sizeBytes: view.releases[0]?.sizeBytes,
    ageHours: view.releases[0]?.ageHours,
    seeders: view.releases[0]?.seeders,
    leechers: view.releases[0]?.leechers,
    arrLanguages: view.releases[0]?.arrLanguages,
    customFormats: view.releases[0]?.customFormats,
    releaseGroup: view.releases[0]?.releaseGroup,
    edition: view.releases[0]?.edition,
  }, {
    sizeBytes: 2_400_000_000,
    ageHours: 3.5,
    seeders: 42,
    leechers: 6,
    arrLanguages: ["English"],
    customFormats: ["PT-BR or Multi subtitles"],
    releaseGroup: "GROUP",
    edition: undefined,
  });
  assert.doesNotMatch(JSON.stringify(view.releases), /downloadUrl|magnet|infoHash/iu);
});

test("PEG-DASH-015 release search matches loaded title, indexer, group, language, and format evidence", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;

  assert.equal(selectReleases(view.releases, { query: "pt-br or multi" }).length, 1);
  assert.equal(selectReleases(view.releases, { query: "synthetic usenet" })[0]?.downloadAllowed, false);
  assert.ok(selectReleases(view.releases, { query: "english" }).length > 1);
  assert.deepEqual(selectReleases(view.releases, { query: "not in this analysis" }), []);
});

test("PEG-DASH-016 protocol filtering stays local and preserves rejected releases", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;

  const torrents = selectReleases(view.releases, { protocol: "torrent" });
  const usenet = selectReleases(view.releases, { protocol: "usenet" });
  assert.equal(torrents.length, 3);
  assert.equal(usenet.length, 1);
  assert.equal(usenet[0]?.downloadAllowed, false);
  assert.deepEqual(selectReleases(view.releases, { protocol: "unsafe" }), view.releases);
});

test("PEG-DASH-017 release size, age, and seeder sorting is deterministic with unknown values last", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;

  assert.deepEqual(selectReleases(view.releases, { sort: "seeders-desc" }).map(({ seeders }) => seeders), [42, 18, 9, undefined]);
  assert.deepEqual(selectReleases(view.releases, { sort: "size-asc" }).map(({ sizeBytes }) => sizeBytes), [1_100_000_000, 2_100_000_000, 2_400_000_000, 8_700_000_000]);
  assert.deepEqual(selectReleases(view.releases, { sort: "size-desc" }).map(({ sizeBytes }) => sizeBytes), [8_700_000_000, 2_400_000_000, 2_100_000_000, 1_100_000_000]);
  assert.deepEqual(selectReleases(view.releases, { sort: "age-asc" }).map(({ ageHours }) => ageHours), [1.25, 3.5, 7, 48]);
});

test("PEG-DASH-018 release shortlist is bounded, deterministic, and page-memory safe", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  const ids = view.releases.map(({ id }) => id);

  assert.deepEqual(shortlistedReleases(view.releases, [ids[2]!, ids[0]!, ids[2]!, "missing", ids[1]!, ids[3]!]).map(({ id }) => id), [ids[2], ids[0], ids[1]]);
  assert.deepEqual(shortlistedReleases(view.releases, undefined), []);
  assert.doesNotMatch(JSON.stringify(shortlistedReleases(view.releases, ids)), /downloadUrl|magnet|infoHash/iu);
});

test("PEG-DASH-032 comparison preserves shortlist order and remains bounded to safe release rows", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  const ids = view.releases.map(({ id }) => id);
  const comparison = releaseComparison(view.releases, [ids[2]!, ids[0]!, ids[2]!, "missing", ids[1]!, ids[3]!]);

  assert.deepEqual(comparison.candidates.map(({ id }) => id), [ids[2], ids[0], ids[1]]);
  assert.doesNotMatch(JSON.stringify(comparison), /downloadUrl|magnet|infoHash|api.?key/iu);
});

test("PEG-DASH-033 comparison keeps Arr acceptance and rejection reasons explicit", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  const rejected = view.releases.find(({ downloadAllowed }) => !downloadAllowed)!;
  const accepted = view.releases.find(({ downloadAllowed }) => downloadAllowed)!;
  const comparison = releaseComparison(view.releases, [rejected.id, accepted.id]);

  assert.equal(comparison.candidates[0]?.downloadAllowed, false);
  assert.deepEqual(comparison.candidates[0]?.rejectionReasons, ["Quality profile does not allow HDTV-720p"]);
  assert.equal(comparison.candidates[1]?.downloadAllowed, true);
});

test("PEG-DASH-034 comparison aligns policy languages and keeps missing evidence Unknown", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  const first = view.releases[0]!;
  const withoutEnglish = { ...view.releases[1]!, languages: view.releases[1]!.languages.filter(({ language }) => language !== "en") };
  const comparison = releaseComparison([first, withoutEnglish], [first.id, withoutEnglish.id]);
  const english = comparison.languages.find(({ code }) => code === "en")!;

  assert.equal(english.required, false);
  assert.equal(english.assessments[1]?.confidence, "unknown");
  assert.equal(english.assessments[1]?.providerCount, 0);
  assert.equal(english.assessments[1]?.strongest, false);
});

test("PEG-DASH-035 comparison marks deterministic evidence strengths and preserves ties", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  const comparison = releaseComparison(view.releases, view.releases.slice(0, 3).map(({ id }) => id));

  assert.deepEqual(comparison.candidates.map(({ strengths }) => strengths.subtitleConfidence), [true, false, false]);
  assert.deepEqual(comparison.candidates.map(({ strengths }) => strengths.requiredFit), [true, true, false]);
  assert.deepEqual(comparison.candidates.map(({ strengths }) => strengths.customFormatScore), [true, false, false]);
  assert.deepEqual(comparison.candidates.map(({ strengths }) => strengths.seeders), [true, false, false]);
  assert.deepEqual(comparison.candidates.map(({ strengths }) => strengths.age), [false, false, true]);
  assert.deepEqual(comparison.languages.find(({ code }) => code === "pt-BR")?.assessments.map(({ strongest }) => strongest), [true, false, false]);
  assert.deepEqual(comparison.languages.find(({ code }) => code === "en")?.assessments.map(({ strongest }) => strongest), [false, false, false]);
  assert.ok(releaseComparison(view.releases, [view.releases[0]!.id]).candidates.every(({ strengths }) => Object.values(strengths).every((value) => value === false)));
});

test("PEG-DASH-020 release analysis preserves full Bazarr policy semantics", () => {
  const report = buildFeasibilityReport({
    ...demoFeasibilityInput,
    policy: {
      ...demoFeasibilityInput.policy,
      source: "explicit_default",
      languages: [
        { code: "pt-BR", required: true, forced: true, hearingImpaired: "required", applicability: "audio_does_not_match", cutoff: true },
        { code: "en", required: false, forced: false, hearingImpaired: "prefer", applicability: "always", cutoff: false },
      ],
    },
  });
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report });

  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  assert.equal(view.policySource, "explicit_default");
  assert.deepEqual(view.languages, [
    { code: "pt-BR", displayCode: "pt-BR", required: true, forced: true, hearingImpaired: "required", applicability: "audio_does_not_match", cutoff: true },
    { code: "en", displayCode: "en", required: false, forced: false, hearingImpaired: "prefer", applicability: "always", cutoff: false },
  ]);
  assert.doesNotMatch(JSON.stringify(view.languages), /sourceItemId|profileId|api.?key/iu);
  const unknownSource = feasibilityView({ kind: "item-feasibility", status: "ready", report: { ...report, policy: { ...report.policy, source: "unexpected" } } });
  assert.equal(unknownSource.state === "ready" ? unknownSource.policySource : undefined, "unknown");
});

test("PEG-DASH-021 per-release required-language fit is honest and required-only", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  const base = view.releases[0]!;
  const report = buildFeasibilityReport(demoFeasibilityInput);
  const withRequired = (confidence: "confirmed" | "likely" | "possible" | "no_match_found" | "unknown") => ({
    ...base,
    languages: base.languages.map((language) => language.required ? { ...language, confidence } : language),
  });
  const mapped = (release: typeof base, languages = view.languages) => feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    report: { ...report, policy: { ...report.policy, languages }, releases: [{
      releaseId: release.id,
      releaseTitle: release.title,
      video: { downloadAllowed: release.downloadAllowed, rejectionReasons: [], customFormatScore: 0, evidence: {}, traits: {} },
      subtitle: { confidence: release.confidence, languages: release.languages },
    }] },
  });

  const fits = ["confirmed", "likely", "possible", "no_match_found", "unknown"].map((confidence) => {
    const result = mapped(withRequired(confidence as "confirmed" | "likely" | "possible" | "no_match_found" | "unknown"));
    return result.state === "ready" ? result.releases[0]?.requiredFit : undefined;
  });
  assert.deepEqual(fits, ["strong", "strong", "possible", "no_match_found", "unknown"]);
  const mixedUnavailable = mapped({
    ...base,
    languages: base.languages.map((language) => ({
      ...language,
      required: true,
      confidence: language.language === "pt-BR" ? "no_match_found" as const : "unknown" as const,
    })),
  });
  assert.equal(mixedUnavailable.state === "ready" ? mixedUnavailable.releases[0]?.requiredFit : undefined, "unknown");
  const noRequired = mapped(
    { ...base, languages: base.languages.map((language) => ({ ...language, required: false })) },
    view.languages.map((language) => ({ ...language, required: false })),
  );
  assert.equal(noRequired.state === "ready" ? noRequired.releases[0]?.requiredFit : undefined, "no_required_languages");
});

test("PEG-DASH-022 required-language fit filtering is a deterministic local operation", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;

  assert.equal(selectReleases(view.releases, { requiredFit: "strong" }).length, 3);
  assert.equal(selectReleases(view.releases, { requiredFit: "possible" }).length, 1);
  assert.deepEqual(selectReleases(view.releases, { requiredFit: "unsafe" }), view.releases);
});

test("PEG-DASH-023 policy-language and confidence filters target loaded assessments", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;

  assert.equal(selectReleases(view.releases, { language: "pt-br", languageConfidence: "confirmed" }).length, 2);
  assert.equal(selectReleases(view.releases, { language: "PT-BR", languageConfidence: "possible" }).length, 1);
  assert.equal(selectReleases(view.releases, { language: "en", languageConfidence: "unknown" }).length, 4);
  assert.equal(selectReleases(view.releases, { language: "missing" }).length, 0);
  assert.equal(selectReleases(view.releases, { languageConfidence: "likely" }).length, 1);
});

test("PEG-DASH-024 leading candidate is deterministic and never overrides Arr rejection", () => {
  const view = feasibilityView({ kind: "item-feasibility", status: "ready", mode: "read_only", report: buildFeasibilityReport(demoFeasibilityInput) });
  assert.equal(view.state, "ready");
  if (view.state !== "ready") return;
  const accepted = view.releases.filter(({ downloadAllowed }) => downloadAllowed);
  const rejected = view.releases.filter(({ downloadAllowed }) => !downloadAllowed);

  assert.equal(leadingRelease(view.releases)?.id, accepted[0]?.id);
  assert.equal(leadingRelease([...rejected, ...accepted])?.id, accepted[0]?.id);
  assert.equal(leadingRelease(rejected), undefined);
  assert.ok(leadingRelease(view.releases)?.downloadAllowed);
});

test("PEG-DASH-026 application filtering keeps Sonarr and Radarr identities separate", () => {
  const rows = rowsFromInventory(inventory);

  assert.deepEqual(selectRows(rows, { application: "sonarr" }).map(({ key }) => key), ["sonarr:sonarr-main:episode:305"]);
  assert.deepEqual(selectRows(rows, { application: "radarr" }).map(({ key }) => key), ["radarr:radarr-main:movie:84", "radarr:radarr-main:movie:85"]);
  assert.deepEqual(selectRows(rows, { application: "unsafe" }), selectRows(rows, {}));
});

test("PEG-DASH-027 profile filtering uses exact analyzed Bazarr policy names", () => {
  const rows = triageRows();

  assert.deepEqual(selectRows(rows, { profile: "profile:Brazilian Portuguese" }).map(({ key }) => key), ["sonarr:sonarr-main:episode:305"]);
  assert.deepEqual(selectRows(rows, { profile: "profile:english fallback" }).map(({ key }) => key), ["radarr:radarr-main:movie:84"]);
  assert.deepEqual(selectRows(rows, { profile: "Brazilian Portuguese" }), selectRows(rows, {}));
});

test("PEG-DASH-028 policy-language filtering is derived from analyzed summaries", () => {
  const rows = triageRows();

  assert.deepEqual(selectRows(rows, { language: "language:pt-BR" }).map(({ key }) => key), ["sonarr:sonarr-main:episode:305"]);
  assert.deepEqual(selectRows(rows, { language: "language:en" }).map(({ key }) => key), ["radarr:radarr-main:movie:84", "sonarr:sonarr-main:episode:305"]);
  assert.deepEqual(selectRows(rows, { language: "language:missing" }), []);
});

test("PEG-DASH-029 analysis-age filtering has a deterministic one-hour boundary", () => {
  const rows = triageRows();
  const nowEpochMs = Date.parse("2026-08-28T12:00:00.000Z");

  assert.deepEqual(selectRows(rows, { analysisAge: "recent", nowEpochMs }).map(({ key }) => key), ["sonarr:sonarr-main:episode:305"]);
  assert.deepEqual(selectRows(rows, { analysisAge: "older", nowEpochMs }).map(({ key }) => key), ["radarr:radarr-main:movie:84"]);
  assert.deepEqual(selectRows(rows, { analysisAge: "unknown", nowEpochMs }).map(({ key }) => key), ["radarr:radarr-main:movie:85"]);
  assert.deepEqual(selectRows(rows, { analysisAge: "unsafe", nowEpochMs }), selectRows(rows, { nowEpochMs }));
});

test("PEG-DASH-030 active inventory filter count ignores sorting and unsafe values", () => {
  assert.equal(activeInventoryFilterCount({}), 0);
  assert.equal(activeInventoryFilterCount({ query: "   ", sort: "title-asc" }), 0);
  assert.equal(activeInventoryFilterCount({
    query: "show",
    application: "sonarr",
    profile: "profile:Brazilian Portuguese",
    language: "language:pt-BR",
    analysisAge: "recent",
  }), 5);
  assert.equal(activeInventoryFilterCount({ application: "unsafe", profile: "unsafe", language: "language:" }), 0);
});

function triageRows() {
  return rowsWithAnalysis(rowsFromInventory(inventory), new Map([
    ["sonarr:sonarr-main:episode:305", {
      state: "ready" as const,
      bestConfidence: "confirmed" as const,
      releaseCount: 4,
      acceptedCount: 3,
      policyName: "Brazilian Portuguese",
      languages: [{ code: "pt-BR", required: true }, { code: "en", required: false }],
      requiredCoverage: "strong" as const,
      requiredLanguages: [{ code: "pt-BR", confidence: "confirmed" as const }],
      providerEvidence: "available" as const,
      providerResultCount: 1,
      availableProviderResultCount: 1,
      providerFailures: [],
      generatedAt: "2026-08-28T11:30:00.000Z",
    }],
    ["radarr:radarr-main:movie:84", {
      state: "stale" as const,
      bestConfidence: "likely" as const,
      releaseCount: 2,
      acceptedCount: 1,
      policyName: "English fallback",
      languages: [{ code: "en", required: true }],
      requiredCoverage: "strong" as const,
      requiredLanguages: [{ code: "en", confidence: "likely" as const }],
      providerEvidence: "partial" as const,
      providerResultCount: 2,
      availableProviderResultCount: 1,
      providerFailures: ["timeout"],
      generatedAt: "2026-08-28T10:00:00.000Z",
    }],
  ]));
}

test("PEG-DASH-008 item summaries use the best Arr-accepted confidence and retain freshness", () => {
  const mapped = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    selection: { application: "sonarr", kind: "episode", itemId: 305 },
    analysis: {
      source: "stale_cache",
      generatedAt: "2026-08-27T12:00:00.000Z",
      expiresAt: "2026-08-27T12:00:30.000Z",
      staleUntil: "2026-08-27T18:00:30.000Z",
      refreshFailure: "integration_failure",
      unavailableIntegrations: ["sonarr"],
    },
    report: buildFeasibilityReport(demoFeasibilityInput),
    metrics: { sonarrRequests: 1, bazarrRequests: 2, providerRequests: 2, elapsedMs: 5 },
  });
  assert.equal(mapped.state, "ready");
  if (mapped.state !== "ready") return;
  const acceptedLikely = mapped.releases.find(({ downloadAllowed, confidence }) => downloadAllowed && confidence === "likely");
  const rejectedConfirmed = mapped.releases.find(({ downloadAllowed, confidence }) => !downloadAllowed && confidence === "confirmed");
  assert.ok(acceptedLikely);
  assert.ok(rejectedConfirmed);

  const summary = itemAnalysisSummary({ ...mapped, releases: [rejectedConfirmed, acceptedLikely] });
  assert.deepEqual(summary, {
    state: "stale",
    bestConfidence: "likely",
    releaseCount: 2,
    acceptedCount: 1,
    policyName: "Original plus Brazilian Portuguese",
    languages: [{ code: "pt-BR", displayCode: "pt-BR", required: true }, { code: "en", displayCode: "en", required: false }],
    requiredCoverage: "strong",
    requiredLanguages: [{ code: "pt-BR", displayCode: "pt-BR", confidence: "likely" }],
    providerEvidence: "partial",
    providerResultCount: 2,
    availableProviderResultCount: 1,
    providerFailures: ["rate_limited"],
    generatedAt: "2026-08-27T12:00:00.000Z",
  });
  assert.deepEqual(itemAnalysisSummary({ state: "policy_unresolved", message: "No language was assumed." }), {
    state: "policy_unresolved",
    bestConfidence: "none",
    releaseCount: 0,
    acceptedCount: 0,
    requiredCoverage: "unknown",
    requiredLanguages: [],
    providerEvidence: "unknown",
    providerResultCount: 0,
    availableProviderResultCount: 0,
    providerFailures: [],
    message: "No language was assumed.",
  });
  assert.doesNotMatch(JSON.stringify(summary), /release-guid|subtitle-id|token|api.?key/iu);
});

test("PEG-DASH-009 analyzed-item filtering and ordering are deterministic page-memory operations", () => {
  const rows = rowsFromInventory(inventory);
  const analyses = new Map([
    ["sonarr:sonarr-main:episode:305", {
      state: "ready" as const,
      bestConfidence: "likely" as const,
      releaseCount: 3,
      acceptedCount: 2,
      policyName: "Brazilian Portuguese",
      languages: [{ code: "pt-BR", required: true }],
      requiredCoverage: "strong" as const,
      requiredLanguages: [{ code: "pt-BR", confidence: "likely" as const }],
      providerEvidence: "available" as const,
      providerResultCount: 1,
      availableProviderResultCount: 1,
      providerFailures: [],
      generatedAt: "2026-08-27T12:00:00.000Z",
    }],
    ["radarr:radarr-main:movie:84", {
      state: "stale" as const,
      bestConfidence: "confirmed" as const,
      releaseCount: 2,
      acceptedCount: 1,
      policyName: "English fallback",
      languages: [{ code: "en", required: false }],
      requiredCoverage: "no_required_languages" as const,
      requiredLanguages: [],
      providerEvidence: "unavailable" as const,
      providerResultCount: 1,
      availableProviderResultCount: 0,
      providerFailures: ["timeout"],
      generatedAt: "2026-08-27T11:00:00.000Z",
    }],
  ]);
  const analyzedRows = rowsWithAnalysis(rows, analyses);

  assert.deepEqual(selectRows(analyzedRows, { analysis: "not_analyzed" }).map(({ key }) => key), ["radarr:radarr-main:movie:85"]);
  assert.deepEqual(selectRows(analyzedRows, { analysis: "needs_attention" }).map(({ key }) => key), ["radarr:radarr-main:movie:84"]);
  assert.deepEqual(selectRows(analyzedRows, { analysis: "stale" }).map(({ key }) => key), ["radarr:radarr-main:movie:84"]);
  assert.deepEqual(selectRows(analyzedRows, { confidence: "likely" }).map(({ key }) => key), ["sonarr:sonarr-main:episode:305"]);
  assert.deepEqual(selectRows(analyzedRows, { requiredCoverage: "strong" }).map(({ key }) => key), ["sonarr:sonarr-main:episode:305"]);
  assert.deepEqual(selectRows(analyzedRows, { providerEvidence: "unavailable" }).map(({ key }) => key), ["radarr:radarr-main:movie:84"]);
  assert.deepEqual(selectRows(analyzedRows, { query: "pt-br" }).map(({ key }) => key), ["sonarr:sonarr-main:episode:305"]);
  assert.deepEqual(selectRows(analyzedRows, { query: "timeout" }).map(({ key }) => key), ["radarr:radarr-main:movie:84"]);
  assert.deepEqual(selectRows(analyzedRows, { sort: "confidence-desc" }).map(({ key }) => key), ["radarr:radarr-main:movie:84", "sonarr:sonarr-main:episode:305", "radarr:radarr-main:movie:85"]);
  assert.deepEqual(selectRows(analyzedRows, { sort: "analyzed-desc" }).map(({ key }) => key), ["sonarr:sonarr-main:episode:305", "radarr:radarr-main:movie:84", "radarr:radarr-main:movie:85"]);
  const unresolvedRow = rowsWithAnalysis([rows[2]!], new Map([["radarr:radarr-main:movie:85", itemAnalysisSummary({ state: "policy_unresolved" })]]));
  const noAcceptedRow = rowsWithAnalysis([rows[2]!], new Map([["radarr:radarr-main:movie:85", {
    state: "ready",
    bestConfidence: "none",
    releaseCount: 2,
    acceptedCount: 0,
    requiredCoverage: "no_accepted_release",
    requiredLanguages: [{ code: "en", confidence: "unknown" }],
    providerEvidence: "available",
    providerResultCount: 1,
    availableProviderResultCount: 1,
    providerFailures: [],
  }]]));
  assert.equal(selectRows(unresolvedRow, { confidence: "none" }).length, 0);
  assert.equal(selectRows(noAcceptedRow, { confidence: "none" }).length, 1);
  assert.ok(rows.every((row) => row.analysis === undefined));
});

test("PEG-DASH-011 required-language coverage uses only Arr-accepted releases and preserves Unknown", () => {
  const mapped = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    report: buildFeasibilityReport(demoFeasibilityInput),
  });
  assert.equal(mapped.state, "ready");
  if (mapped.state !== "ready") return;
  const accepted = mapped.releases.find(({ downloadAllowed }) => downloadAllowed)!;
  const rejected = mapped.releases.find(({ downloadAllowed }) => !downloadAllowed)!;
  const requiredUnknown = { ...accepted, languages: accepted.languages.map((language) => language.required ? { ...language, confidence: "unknown" as const } : language) };
  const rejectedConfirmed = { ...rejected, languages: rejected.languages.map((language) => language.required ? { ...language, confidence: "confirmed" as const } : language) };
  const unknownSummary = itemAnalysisSummary({ ...mapped, releases: [rejectedConfirmed, requiredUnknown] });

  assert.equal(unknownSummary.requiredCoverage, "unknown");
  assert.deepEqual(unknownSummary.requiredLanguages, [{ code: "pt-BR", displayCode: "pt-BR", confidence: "unknown" }]);

  const noMatch = { ...accepted, languages: accepted.languages.map((language) => language.required ? { ...language, confidence: "no_match_found" as const } : language) };
  assert.equal(itemAnalysisSummary({ ...mapped, releases: [noMatch] }).requiredCoverage, "no_match_found");
  assert.equal(itemAnalysisSummary({ ...mapped, releases: [] }).requiredCoverage, "no_accepted_release");
  assert.equal(itemAnalysisSummary({ ...mapped, languages: mapped.languages.map((language) => ({ ...language, required: false })) }).requiredCoverage, "no_required_languages");
});

test("PEG-DASH-012 provider-evidence health distinguishes available, partial, unavailable, and unknown", () => {
  const mapped = feasibilityView({
    kind: "item-feasibility",
    status: "ready",
    mode: "read_only",
    report: buildFeasibilityReport(demoFeasibilityInput),
  });
  assert.equal(mapped.state, "ready");
  if (mapped.state !== "ready") return;

  const available = itemAnalysisSummary({ ...mapped, providers: [{ provider: "one", status: "success" }] });
  const partial = itemAnalysisSummary({ ...mapped, providers: [{ provider: "one", status: "success" }, { provider: "two", status: "rate_limited" }] });
  const unavailable = itemAnalysisSummary({ ...mapped, providers: [{ provider: "one", status: "timeout" }, { provider: "two", status: "unavailable" }] });
  const unknown = itemAnalysisSummary({ ...mapped, providers: [] });

  assert.deepEqual(
    [available.providerEvidence, partial.providerEvidence, unavailable.providerEvidence, unknown.providerEvidence],
    ["available", "partial", "unavailable", "unknown"],
  );
  assert.deepEqual(partial.providerFailures, ["rate_limited"]);
  assert.equal(partial.availableProviderResultCount, 1);
  assert.equal(partial.providerResultCount, 2);
});

test("PEG-DASH-002 search, filtering, and sorting are pure local operations", () => {
  const rows = rowsFromInventory(inventory);

  assert.deepEqual(
    selectRows(rows, { kind: "movie", sort: "title-asc" }).map(({ title }) => title),
    ["A Synthetic Movie", "Later Movie"],
  );
  assert.deepEqual(
    selectRows(rows, { query: "s03e05" }).map(({ key }) => key),
    ["sonarr:sonarr-main:episode:305"],
  );
  assert.deepEqual(
    selectRows(rows, { sort: "available-desc" }).map(({ key }) => key),
    ["radarr:radarr-main:movie:84", "sonarr:sonarr-main:episode:305", "radarr:radarr-main:movie:85"],
  );
  assert.deepEqual(rowsFromInventory({ sources: [{ status: "ready", page: { items: [{}] } }] }), []);
});
