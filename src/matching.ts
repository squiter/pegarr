import type {
  ArrReleaseCandidate,
  FeasibilityInput,
  FeasibilityReport,
  LanguageAssessment,
  MatchEvidence,
  MediaIdentity,
  ProviderSearchResult,
  ReleaseAssessment,
  SubtitleCandidate,
  SubtitleConfidence,
  SubtitleLanguageRequirement,
} from "./domain.js";
import { normalizeLanguage, normalizeRelease } from "./normalization.js";

interface ScoredCandidate {
  readonly candidate: SubtitleCandidate;
  readonly score: number;
  readonly confidence: "confirmed" | "likely" | "possible";
  readonly reasons: readonly string[];
}

const confidenceRank: Readonly<Record<"confirmed" | "likely" | "possible", number>> = {
  confirmed: 3,
  likely: 2,
  possible: 1,
};

export function buildFeasibilityReport(input: FeasibilityInput): FeasibilityReport {
  return {
    fixture: input.fixture,
    mode: "read_only",
    item: input.item,
    policy: input.policy,
    providerStatus: input.providerResults.map(({ provider, status, searchedLanguages, detail, quota, cache }) => ({
      provider,
      status,
      ...(searchedLanguages === undefined ? {} : { searchedLanguages }),
      ...(detail === undefined ? {} : { detail }),
      ...(quota === undefined ? {} : { quota }),
      ...(cache === undefined ? {} : { cache }),
    })),
    releases: input.releases.map((release) => assessRelease(input, release)),
  };
}

export function assessRelease(input: FeasibilityInput, release: ArrReleaseCandidate): ReleaseAssessment {
  const languages = input.policy.languages.map((requirement) =>
    assessLanguage(input.item, release, requirement, input.providerResults),
  );

  return {
    releaseId: release.id,
    releaseTitle: release.title,
    video: {
      downloadAllowed: release.downloadAllowed,
      rejectionReasons: release.rejectionReasons,
      customFormatScore: release.customFormatScore,
      evidence: release.evidence,
      ...(release.traits === undefined ? {} : { traits: release.traits }),
    },
    subtitle: {
      confidence: overallConfidence(languages),
      languages,
    },
  };
}

export function assessLanguage(
  item: MediaIdentity,
  release: ArrReleaseCandidate,
  requirement: SubtitleLanguageRequirement,
  providerResults: readonly ProviderSearchResult[],
): LanguageAssessment {
  const normalizedLanguage = normalizeLanguage(requirement.code);
  const relevantProviderResults = providerResults.filter(({ searchedLanguages }) =>
    searchedLanguages === undefined ||
    searchedLanguages.some((language) => normalizeLanguage(language) === normalizedLanguage),
  );
  const unavailableProviders = relevantProviderResults.filter(({ status }) => status !== "success");
  const mediaIdentityCandidates = relevantProviderResults
    .flatMap(({ subtitles }) => subtitles)
    .filter((candidate) => normalizeLanguage(candidate.language) === normalizedLanguage)
    .filter((candidate) => mediaIdentityMatches(item, candidate));
  const mediaLanguageCandidates = mediaIdentityCandidates.filter((candidate) =>
    coverageMatches(item, candidate),
  );
  const matchingCandidates = mediaLanguageCandidates
    .filter((candidate) => subtitleTypeMatches(requirement, candidate))
    .map((candidate) => scoreCandidate(release, candidate))
    .sort((left, right) => right.score - left.score);
  const best = matchingCandidates[0];
  const warnings = unavailableProviders.map(
    ({ provider, status }) => `${provider} search ${describeProviderFailure(status)}`,
  );

  if (best !== undefined) {
    return {
      language: requirement.code,
      required: requirement.required,
      confidence: best.confidence,
      providerCount: new Set(matchingCandidates.map(({ candidate }) => candidate.provider)).size,
      evidence: toEvidence(best),
      warnings,
    };
  }

  const incompleteTypeEvidence = mediaLanguageCandidates.filter((candidate) =>
    subtitleTypeEvidenceMissing(requirement, candidate),
  );
  if (incompleteTypeEvidence.length > 0) {
    return {
      language: requirement.code,
      required: requirement.required,
      confidence: "unknown",
      providerCount: new Set(incompleteTypeEvidence.map(({ provider }) => provider)).size,
      warnings: [
        ...warnings,
        ...new Set(
          incompleteTypeEvidence.map(
            ({ provider }) => `${provider} did not report the required subtitle-type evidence`,
          ),
        ),
      ],
    };
  }

  const incompleteCoverageEvidence = mediaIdentityCandidates.filter(
    (candidate) => item.kind === "season" && candidate.fullSeason === undefined,
  );
  if (incompleteCoverageEvidence.length > 0) {
    return {
      language: requirement.code,
      required: requirement.required,
      confidence: "unknown",
      providerCount: new Set(incompleteCoverageEvidence.map(({ provider }) => provider)).size,
      warnings: [
        ...warnings,
        ...new Set(
          incompleteCoverageEvidence.map(
            ({ provider }) => `${provider} did not report full-season coverage evidence`,
          ),
        ),
      ],
    };
  }

  if (unavailableProviders.length > 0) {
    return {
      language: requirement.code,
      required: requirement.required,
      confidence: "unknown",
      providerCount: 0,
      warnings,
    };
  }

  if (relevantProviderResults.length === 0) {
    return {
      language: requirement.code,
      required: requirement.required,
      confidence: "unknown",
      providerCount: 0,
      warnings: ["No provider search covered this language"],
    };
  }

  return {
    language: requirement.code,
    required: requirement.required,
    confidence: "no_match_found",
    providerCount: 0,
    warnings: [],
  };
}

function subtitleTypeEvidenceMissing(
  requirement: SubtitleLanguageRequirement,
  candidate: SubtitleCandidate,
): boolean {
  if (requirement.forced && candidate.forced === undefined) {
    return true;
  }
  return (
    (requirement.hearingImpaired === "required" || requirement.hearingImpaired === "avoid") &&
    candidate.hearingImpaired === undefined
  );
}

function subtitleTypeMatches(
  requirement: SubtitleLanguageRequirement,
  candidate: SubtitleCandidate,
): boolean {
  if (requirement.forced ? candidate.forced !== true : candidate.forced === true) {
    return false;
  }
  if (requirement.hearingImpaired === "required") {
    return candidate.hearingImpaired === true;
  }
  if (requirement.hearingImpaired === "avoid") {
    return candidate.hearingImpaired !== true;
  }
  return true;
}

function scoreCandidate(release: ArrReleaseCandidate, candidate: SubtitleCandidate): ScoredCandidate {
  const video = normalizeRelease(release.title, release.traits);
  const subtitle = normalizeRelease(candidate.releaseName, candidate.traits);
  const reasons: string[] = [];

  if (
    video.canonical === subtitle.canonical &&
    (video.edition === undefined || sameDefined(video.edition, subtitle.edition)) &&
    (video.frameRate === undefined || sameFrameRate(video.frameRate, subtitle.frameRate))
  ) {
    return { candidate, score: 100, confidence: "confirmed", reasons: ["Exact normalized release name"] };
  }

  const multiEpisode = (candidate.episodeNumbers?.length ?? 0) > 1;
  let score = candidate.fullSeason === true ? 45 : multiEpisode ? 48 : 50;
  reasons.push(candidate.fullSeason === true
    ? "Full-season subtitle pack covers the requested season or episode"
    : multiEpisode
      ? "Explicit multi-episode subtitle coverage includes the requested episode"
      : "Correct media item, episode, and language");

  if (sameDefined(video.releaseGroup, subtitle.releaseGroup)) {
    score += 20;
    reasons.push("Same release group");
  } else if (conflicting(video.releaseGroup, subtitle.releaseGroup)) {
    score -= 10;
    reasons.push("Release group differs");
  }

  if (sameDefined(video.source, subtitle.source)) {
    score += 15;
    reasons.push("Same source");
  } else if (conflicting(video.source, subtitle.source)) {
    score -= 15;
    reasons.push("Source differs");
  }

  if (sameDefined(video.resolution, subtitle.resolution)) {
    score += 10;
    reasons.push("Same resolution");
  } else if (conflicting(video.resolution, subtitle.resolution)) {
    score -= 10;
    reasons.push("Resolution differs");
  }

  if (sameDefined(video.codec, subtitle.codec)) {
    score += 5;
    reasons.push("Same video codec");
  } else if (conflicting(video.codec, subtitle.codec)) {
    score -= 5;
    reasons.push("Video codec differs");
  }

  if (sameDefined(video.edition, subtitle.edition)) {
    score += 10;
    reasons.push("Same movie edition or cut");
  } else if (conflicting(video.edition, subtitle.edition)) {
    score -= 40;
    reasons.push("Movie edition or cut differs");
  } else if (video.edition !== undefined) {
    score -= 30;
    reasons.push("Subtitle did not report movie edition or cut");
  }

  if (sameFrameRate(video.frameRate, subtitle.frameRate)) {
    score += 5;
    reasons.push("Same frame rate");
  } else if (conflictingFrameRate(video.frameRate, subtitle.frameRate)) {
    score -= 10;
    reasons.push("Frame rate differs");
  }

  const boundedScore = Math.max(1, Math.min(score, 99));
  return {
    candidate,
    score: boundedScore,
    confidence: boundedScore >= 70 ? "likely" : "possible",
    reasons,
  };
}

function mediaIdentityMatches(item: MediaIdentity, candidate: SubtitleCandidate): boolean {
  if (item.kind === "episode") {
    if (candidate.season !== undefined && candidate.season !== item.season) {
      return false;
    }
    if (candidate.fullSeason !== true) {
      if (
        candidate.episodeNumbers !== undefined &&
        !candidate.episodeNumbers.includes(item.episode ?? 0)
      ) {
        return false;
      }
      if (candidate.episode !== undefined && candidate.episode !== item.episode) {
        return false;
      }
    }
  }
  if (item.kind === "season" && candidate.season !== undefined && candidate.season !== item.season) {
    return false;
  }

  const candidateIds = Object.entries(candidate.mediaIds);
  if (candidateIds.length === 0) {
    return (
      item.kind === "episode" &&
      candidate.season === item.season &&
      (
        candidate.fullSeason === true ||
        candidate.episode === item.episode ||
        candidate.episodeNumbers?.includes(item.episode ?? 0) === true
      )
    ) || (
      item.kind === "season" && candidate.season === item.season
    );
  }

  return candidateIds.some(([namespace, id]) => item.ids[namespace] === id);
}

function coverageMatches(item: MediaIdentity, candidate: SubtitleCandidate): boolean {
  return item.kind !== "season" || candidate.fullSeason === true;
}

function overallConfidence(languages: readonly LanguageAssessment[]): SubtitleConfidence {
  const required = languages.filter(({ required: isRequired }) => isRequired);
  if (required.length === 0) {
    return "unknown";
  }
  if (required.some(({ confidence }) => confidence === "no_match_found")) {
    return "no_match_found";
  }
  if (required.some(({ confidence }) => confidence === "unknown")) {
    return "unknown";
  }

  return required.reduce<"confirmed" | "likely" | "possible">((lowest, assessment) => {
    const confidence = assessment.confidence as "confirmed" | "likely" | "possible";
    return confidenceRank[confidence] < confidenceRank[lowest] ? confidence : lowest;
  }, "confirmed");
}

function toEvidence(scored: ScoredCandidate): MatchEvidence {
  return {
    subtitleId: scored.candidate.id,
    provider: scored.candidate.provider,
    subtitleReleaseName: scored.candidate.releaseName,
    score: scored.score,
    reasons: scored.reasons,
  };
}

function sameDefined(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left === right;
}

function conflicting(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left !== right;
}

function sameFrameRate(left: number | undefined, right: number | undefined): boolean {
  return left !== undefined && right !== undefined && Math.abs(left - right) < 0.001;
}

function conflictingFrameRate(left: number | undefined, right: number | undefined): boolean {
  return left !== undefined && right !== undefined && !sameFrameRate(left, right);
}

function describeProviderFailure(status: ProviderSearchResult["status"]): string {
  switch (status) {
    case "rate_limited":
      return "was rate limited";
    case "timeout":
      return "timed out";
    case "unavailable":
      return "was unavailable";
    case "unsupported":
      return "does not support this search";
    case "unauthorized":
      return "rejected the configured credentials";
    case "invalid_response":
      return "returned an invalid response";
    case "unexpected_status":
      return "rejected the search request";
    case "success":
      return "succeeded";
  }
}
