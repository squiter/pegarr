import assert from "node:assert/strict";
import test from "node:test";

import { mapBazarrLanguageProfiles, type BazarrProfileAssignment } from "./adapters/bazarr.js";
import { mapSonarrReleaseResponse, SonarrAdapterError } from "./adapters/sonarr.js";
import type { SubdlSearchWindow } from "./adapters/subdl.js";
import type { ArrReleaseCandidate, ProviderSearchResult } from "./domain.js";
import { syntheticBazarrLanguageProfilesResponse } from "./fixtures/bazarr-language-policy.js";
import { syntheticSonarrSeasonReleaseResponse } from "./fixtures/sonarr-season-release-search.js";
import type { SubdlWindowSource } from "./provider-policy-search.js";
import {
  SonarrSeasonFeasibilityService,
  type BazarrSeasonPolicySource,
  type SonarrSeasonReleaseSource,
} from "./season-feasibility.js";

class SonarrSource implements SonarrSeasonReleaseSource {
  readonly calls: { seriesId: number; seasonNumber: number }[] = [];
  failure: Error | undefined;

  async searchSeasonReleases(seriesId: number, seasonNumber: number): Promise<readonly ArrReleaseCandidate[]> {
    this.calls.push({ seriesId, seasonNumber });
    if (this.failure !== undefined) throw this.failure;
    return mapSonarrReleaseResponse(syntheticSonarrSeasonReleaseResponse, "synthetic-sonarr");
  }
}

class BazarrSource implements BazarrSeasonPolicySource {
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
  includeFullSeason = true;

  async search(window: SubdlSearchWindow): Promise<ProviderSearchResult> {
    this.calls.push(window);
    return {
      provider: "subdl",
      status: "success",
      searchedLanguages: [window.language.policyCode],
      subtitles: window.language.policyCode === "pt-BR" ? [
        {
          id: "subdl-individual-episode",
          provider: "subdl",
          language: "pt-BR",
          releaseName: "Example.Show.S03E05.1080p.WEB-DL.H264-GROUP",
          mediaIds: window.item.ids,
          season: 3,
          episode: 5,
          fullSeason: false,
          hearingImpaired: true,
          forced: false,
        },
        ...(this.includeFullSeason ? [{
          id: "subdl-season-pack",
          provider: "subdl",
          language: "pt-BR",
          releaseName: "Example.Show.S03.1080p.WEB-DL.H264-GROUP",
          mediaIds: window.item.ids,
          season: 3,
          fullSeason: true,
          hearingImpaired: true,
          forced: false,
        }] : []),
      ] : [],
    };
  }
}

const request = {
  sonarrSeriesId: 42,
  seasonNumber: 3,
  item: {
    kind: "season" as const,
    title: "Example Show — Season 3",
    season: 3,
    ids: { imdb: "tt9000005", tmdb: "900005" },
  },
  subdlLanguages: [
    { policyCode: "en", providerCode: "EN" },
    { policyCode: "pt-BR", providerCode: "PT-BR" },
    { policyCode: "es", providerCode: "ES" },
  ],
} as const;

function service() {
  const sonarr = new SonarrSource();
  const bazarr = new BazarrSource();
  const subdl = new SubdlSource();
  const times = [3_000, 3_095];
  return {
    sonarr,
    bazarr,
    subdl,
    service: new SonarrSeasonFeasibilityService({
      sonarr,
      bazarr,
      subdl,
      now: () => times.shift() ?? 3_095,
    }),
  };
}

test("PEG-SEASONFLOW-001 season releases and full-season subtitle evidence produce one report", async () => {
  const harness = service();
  const outcome = await harness.service.build(request);

  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.deepEqual(harness.sonarr.calls, [{ seriesId: 42, seasonNumber: 3 }]);
  assert.deepEqual(harness.bazarr.assignmentCalls, [42]);
  assert.equal(harness.subdl.calls.length, 3);
  assert.ok(harness.subdl.calls.every(({ item }) => item.kind === "season"));
  assert.deepEqual(outcome.metrics, {
    sonarrRequests: 1,
    bazarrRequests: 2,
    providerRequests: 3,
    elapsedMs: 95,
  });
  assert.equal(outcome.report.releases.length, 2);
  assert.equal(outcome.report.releases[0]?.video.evidence.fullSeason, true);
  assert.equal(outcome.report.releases[0]?.subtitle.languages[1]?.confidence, "confirmed");
  assert.equal(outcome.report.releases[1]?.video.downloadAllowed, false);
});

test("PEG-SEASONFLOW-002 unresolved series policy stops season provider work", async () => {
  const harness = service();
  harness.bazarr.assignment = { status: "unassigned", mediaKind: "series", mediaId: 42 };
  const outcome = await harness.service.build(request);

  assert.equal(outcome.status, "policy_unresolved");
  if (outcome.status !== "policy_unresolved") return;
  assert.equal(outcome.reason, "unassigned");
  assert.equal(outcome.releases.length, 2);
  assert.equal(harness.subdl.calls.length, 0);
});

test("PEG-SEASONFLOW-003 Sonarr season failure remains classified and stops provider work", async () => {
  const harness = service();
  harness.sonarr.failure = new SonarrAdapterError("rate_limited", "private", {
    retryAfterSeconds: 30,
  });
  const outcome = await harness.service.build(request);

  assert.equal(outcome.status, "integration_failure");
  if (outcome.status !== "integration_failure") return;
  assert.deepEqual(outcome.failures, [{
    integration: "sonarr",
    operation: "release_search",
    state: "rate_limited",
    retryAfterSeconds: 30,
  }]);
  assert.equal(harness.subdl.calls.length, 0);
});

test("PEG-SEASONFLOW-004 individual episode evidence cannot satisfy a season release", async () => {
  const harness = service();
  harness.subdl.includeFullSeason = false;
  const outcome = await harness.service.build(request);

  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.equal(
    outcome.report.releases[0]?.subtitle.languages[1]?.confidence,
    "no_match_found",
  );
  assert.equal(
    outcome.report.releases[0]?.subtitle.languages[1]?.providerCount,
    0,
  );
});

test("PEG-SPECIALS-001 season zero remains a valid explicit specials scope", async () => {
  const harness = service();
  const outcome = await harness.service.build({
    ...request,
    seasonNumber: 0,
    item: { ...request.item, title: "Example Show — Specials", season: 0 },
  });

  assert.equal(outcome.status, "ready");
  assert.deepEqual(harness.sonarr.calls, [{ seriesId: 42, seasonNumber: 0 }]);
  assert.ok(harness.subdl.calls.every(({ item }) => item.kind === "season" && item.season === 0));
});
