import assert from "node:assert/strict";
import test from "node:test";

import {
  mapBazarrLanguageProfiles,
  type BazarrProfileAssignment,
} from "./adapters/bazarr.js";
import type { SubdlSearchWindow } from "./adapters/subdl.js";
import type { ArrReleaseCandidate, ProviderSearchResult } from "./domain.js";
import {
  SonarrEpisodeFeasibilityService,
  type BazarrEpisodePolicySource,
  type SonarrEpisodeReleaseSource,
  type SubdlWindowSource,
} from "./episode-feasibility.js";
import {
  syntheticBazarrLanguageProfilesResponse,
} from "./fixtures/bazarr-language-policy.js";
import { demoFeasibilityInput } from "./fixtures/demo.js";

class SonarrSource implements SonarrEpisodeReleaseSource {
  readonly calls: number[] = [];
  failure: Error | undefined;

  async searchEpisodeReleases(episodeId: number): Promise<readonly ArrReleaseCandidate[]> {
    this.calls.push(episodeId);
    if (this.failure !== undefined) throw this.failure;
    return demoFeasibilityInput.releases;
  }
}

class BazarrSource implements BazarrEpisodePolicySource {
  profileCalls = 0;
  readonly assignmentCalls: number[] = [];
  assignment: BazarrProfileAssignment = {
    status: "assigned",
    mediaKind: "series",
    mediaId: 42,
    profileId: 7,
  };

  async listLanguageProfiles() {
    this.profileCalls += 1;
    return mapBazarrLanguageProfiles(syntheticBazarrLanguageProfilesResponse);
  }

  async readSeriesAssignment(seriesId: number) {
    this.assignmentCalls.push(seriesId);
    return this.assignment;
  }
}

class SubdlSource implements SubdlWindowSource {
  readonly calls: SubdlSearchWindow[] = [];
  failureResult: ProviderSearchResult | undefined;

  async search(window: SubdlSearchWindow): Promise<ProviderSearchResult> {
    this.calls.push(window);
    if (this.failureResult !== undefined) return this.failureResult;
    const subtitles = window.language.policyCode === "pt-BR"
      ? [{
          id: "subdl-flow-exact",
          provider: "subdl",
          language: "pt-BR",
          releaseName: demoFeasibilityInput.releases[0]!.title,
          mediaIds: window.item.ids,
          ...(window.item.season === undefined ? {} : { season: window.item.season }),
          ...(window.item.episode === undefined ? {} : { episode: window.item.episode }),
          forced: false,
          hearingImpaired: true,
        }]
      : [];
    return {
      provider: "subdl",
      status: "success",
      searchedLanguages: [window.language.policyCode],
      subtitles,
    };
  }
}

const request = {
  episodeId: 305,
  sonarrSeriesId: 42,
  item: {
    kind: "episode" as const,
    title: "Synthetic Show — S03E05",
    season: 3,
    episode: 5,
    ids: { imdb: "tt9000005", tmdb: "900005" },
  },
  subdlLanguages: [
    { policyCode: "en", providerCode: "EN" },
    { policyCode: "pt_br", providerCode: "PT-BR" },
    { policyCode: "es", providerCode: "ES" },
  ],
} as const;

function service() {
  const sonarr = new SonarrSource();
  const bazarr = new BazarrSource();
  const subdl = new SubdlSource();
  const times = [1_000, 1_075];
  return {
    sonarr,
    bazarr,
    subdl,
    service: new SonarrEpisodeFeasibilityService({
      sonarr,
      bazarr,
      subdl,
      now: () => times.shift() ?? 1_075,
    }),
  };
}

test("PEG-FLOW-001 resolved Bazarr policy drives one SubDL search per language and one report", async () => {
  const harness = service();
  const outcome = await harness.service.build(request);

  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.deepEqual(harness.sonarr.calls, [305]);
  assert.equal(harness.bazarr.profileCalls, 1);
  assert.deepEqual(harness.bazarr.assignmentCalls, [42]);
  assert.deepEqual(
    harness.subdl.calls.map(({ language }) => language),
    [
      { policyCode: "en", providerCode: "EN" },
      { policyCode: "pt-BR", providerCode: "PT-BR" },
      { policyCode: "es", providerCode: "ES" },
    ],
  );
  assert.deepEqual(outcome.metrics, {
    sonarrRequests: 1,
    bazarrRequests: 2,
    providerRequests: 3,
    elapsedMs: 75,
  });
  assert.equal(outcome.report.mode, "read_only");
  assert.equal(outcome.report.releases.length, 4);
  assert.equal(outcome.report.releases[0]?.subtitle.languages[1]?.confidence, "confirmed");
  assert.equal(outcome.report.releases[2]?.video.downloadAllowed, false);
});

test("PEG-FLOW-002 missing language mapping remains scoped Unknown without an extra request", async () => {
  const harness = service();
  const outcome = await harness.service.build({
    ...request,
    subdlLanguages: request.subdlLanguages.slice(0, 2),
  });

  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.equal(harness.subdl.calls.length, 2);
  assert.equal(outcome.metrics.providerRequests, 2);
  assert.deepEqual(outcome.report.providerStatus[2], {
    provider: "subdl",
    status: "unsupported",
    searchedLanguages: ["es"],
    detail: "No explicit SubDL language mapping is configured",
  });
  const languages = outcome.report.releases[0]?.subtitle.languages ?? [];
  assert.equal(languages[0]?.confidence, "no_match_found");
  assert.equal(languages[1]?.confidence, "confirmed");
  assert.equal(languages[2]?.confidence, "unknown");
});

test("PEG-FLOW-003 unresolved Bazarr assignment stops provider work without assuming policy", async () => {
  const harness = service();
  harness.bazarr.assignment = {
    status: "unassigned",
    mediaKind: "series",
    mediaId: 42,
  };
  const outcome = await harness.service.build(request);

  assert.equal(outcome.status, "policy_unresolved");
  if (outcome.status !== "policy_unresolved") return;
  assert.equal(outcome.reason, "unassigned");
  assert.equal(outcome.releases.length, 4);
  assert.equal(harness.subdl.calls.length, 0);
  assert.equal(outcome.metrics.providerRequests, 0);
});

test("PEG-FLOW-004 provider failure stops further searches and keeps all languages Unknown", async () => {
  const harness = service();
  harness.subdl.failureResult = {
    provider: "subdl",
    status: "rate_limited",
    searchedLanguages: ["en"],
    subtitles: [],
    detail: "Synthetic quota reached",
  };
  const outcome = await harness.service.build(request);

  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.equal(harness.subdl.calls.length, 1);
  assert.equal(outcome.metrics.providerRequests, 1);
  assert.deepEqual(
    outcome.report.releases[0]?.subtitle.languages.map(({ confidence }) => confidence),
    ["unknown", "unknown", "unknown"],
  );
  assert.deepEqual(outcome.report.providerStatus[0]?.searchedLanguages, ["en"]);
});
