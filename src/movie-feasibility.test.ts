import assert from "node:assert/strict";
import test from "node:test";

import {
  mapBazarrLanguageProfiles,
  type BazarrProfileAssignment,
} from "./adapters/bazarr.js";
import { mapRadarrReleaseResponse, RadarrAdapterError } from "./adapters/radarr.js";
import type { SubdlSearchWindow } from "./adapters/subdl.js";
import type { ArrReleaseCandidate, ProviderSearchResult } from "./domain.js";
import { syntheticBazarrLanguageProfilesResponse } from "./fixtures/bazarr-language-policy.js";
import { syntheticRadarrMovieReleaseResponse } from "./fixtures/radarr-release-search.js";
import {
  RadarrMovieFeasibilityService,
  type BazarrMoviePolicySource,
  type RadarrMovieReleaseSource,
} from "./movie-feasibility.js";
import type { SubdlWindowSource } from "./provider-policy-search.js";

class RadarrSource implements RadarrMovieReleaseSource {
  readonly calls: number[] = [];
  failure: Error | undefined;

  async searchMovieReleases(movieId: number): Promise<readonly ArrReleaseCandidate[]> {
    this.calls.push(movieId);
    if (this.failure !== undefined) throw this.failure;
    return mapRadarrReleaseResponse(syntheticRadarrMovieReleaseResponse, "synthetic-radarr");
  }
}

class BazarrSource implements BazarrMoviePolicySource {
  profileCalls = 0;
  readonly assignmentCalls: number[] = [];
  assignment: BazarrProfileAssignment = {
    status: "assigned",
    mediaKind: "movie",
    mediaId: 84,
    profileId: 7,
  };

  async listLanguageProfiles() {
    this.profileCalls += 1;
    return mapBazarrLanguageProfiles(syntheticBazarrLanguageProfilesResponse);
  }

  async readMovieAssignment(movieId: number) {
    this.assignmentCalls.push(movieId);
    return this.assignment;
  }
}

class SubdlSource implements SubdlWindowSource {
  readonly calls: SubdlSearchWindow[] = [];

  async search(window: SubdlSearchWindow): Promise<ProviderSearchResult> {
    this.calls.push(window);
    const subtitles = window.language.policyCode === "pt-BR"
      ? [{
          id: "subdl-movie-exact",
          provider: "subdl",
          language: "pt-BR",
          releaseName: "Example.Movie.2024.Directors.Cut.1080p.BluRay.x265-GROUP",
          mediaIds: window.item.ids,
          hearingImpaired: true,
          forced: false,
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
  movieId: 84,
  item: {
    kind: "movie" as const,
    title: "Example Movie",
    year: 2024,
    ids: { imdb: "tt9000084", tmdb: "900084" },
  },
  subdlLanguages: [
    { policyCode: "en", providerCode: "EN" },
    { policyCode: "pt-BR", providerCode: "PT-BR" },
    { policyCode: "es", providerCode: "ES" },
  ],
} as const;

function service() {
  const radarr = new RadarrSource();
  const bazarr = new BazarrSource();
  const subdl = new SubdlSource();
  const times = [2_000, 2_090];
  return {
    radarr,
    bazarr,
    subdl,
    service: new RadarrMovieFeasibilityService({
      radarr,
      bazarr,
      subdl,
      now: () => times.shift() ?? 2_090,
    }),
  };
}

test("PEG-MOVIEFLOW-001 Radarr releases and Bazarr movie policy produce one report", async () => {
  const harness = service();
  const outcome = await harness.service.build(request);

  assert.equal(outcome.status, "ready");
  if (outcome.status !== "ready") return;
  assert.deepEqual(harness.radarr.calls, [84]);
  assert.equal(harness.bazarr.profileCalls, 1);
  assert.deepEqual(harness.bazarr.assignmentCalls, [84]);
  assert.equal(harness.subdl.calls.length, 3);
  assert.deepEqual(outcome.metrics, {
    radarrRequests: 1,
    bazarrRequests: 2,
    providerRequests: 3,
    elapsedMs: 90,
  });
  assert.equal(outcome.report.releases.length, 2);
  assert.equal(outcome.report.releases[0]?.subtitle.languages[1]?.confidence, "confirmed");
  assert.equal(outcome.report.releases[1]?.video.downloadAllowed, false);
  assert.deepEqual(outcome.report.releases[1]?.video.rejectionReasons, [
    "Quality profile does not allow WEB-720p",
  ]);
});

test("PEG-MOVIEFLOW-002 unassigned Bazarr movie stops SubDL without assuming policy", async () => {
  const harness = service();
  harness.bazarr.assignment = {
    status: "unassigned",
    mediaKind: "movie",
    mediaId: 84,
  };
  const outcome = await harness.service.build(request);

  assert.equal(outcome.status, "policy_unresolved");
  if (outcome.status !== "policy_unresolved") return;
  assert.equal(outcome.reason, "unassigned");
  assert.equal(outcome.releases.length, 2);
  assert.equal(harness.subdl.calls.length, 0);
});

test("PEG-MOVIEFLOW-003 Radarr failures remain classified and stop provider work", async () => {
  const harness = service();
  harness.radarr.failure = new RadarrAdapterError("rate_limited", "private detail", {
    retryAfterSeconds: 45,
  });
  const outcome = await harness.service.build(request);

  assert.equal(outcome.status, "integration_failure");
  if (outcome.status !== "integration_failure") return;
  assert.deepEqual(outcome.failures, [{
    integration: "radarr",
    operation: "release_search",
    state: "rate_limited",
    retryAfterSeconds: 45,
  }]);
  assert.equal(outcome.releases.length, 0);
  assert.equal(harness.subdl.calls.length, 0);
});
