export type SubtitleConfidence =
  | "confirmed"
  | "likely"
  | "possible"
  | "no_match_found"
  | "unknown";

export type ProviderSearchStatus =
  | "success"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "unsupported";

export interface MediaIdentity {
  readonly kind: "movie" | "episode";
  readonly title: string;
  readonly year?: number;
  readonly season?: number;
  readonly episode?: number;
  readonly ids: Readonly<Record<string, string>>;
}

export interface ReleaseTraits {
  readonly source?: string;
  readonly resolution?: string;
  readonly codec?: string;
  readonly releaseGroup?: string;
  readonly edition?: string;
}

export interface ArrReleaseEvidence {
  readonly application: "sonarr" | "radarr" | "synthetic";
  readonly instanceId: string;
  readonly indexer: string;
  readonly protocol: string;
  readonly quality?: string;
  readonly sizeBytes?: number;
  readonly ageHours?: number;
  readonly seeders?: number;
  readonly leechers?: number;
  readonly languages: readonly string[];
  readonly customFormats: readonly {
    readonly id: number;
    readonly name: string;
  }[];
}

export interface ArrReleaseCandidate {
  readonly id: string;
  readonly title: string;
  readonly downloadAllowed: boolean;
  readonly rejectionReasons: readonly string[];
  readonly customFormatScore: number;
  readonly evidence: ArrReleaseEvidence;
  readonly traits?: ReleaseTraits;
}

export interface SubtitleLanguageRequirement {
  readonly code: string;
  readonly required: boolean;
  readonly forced: boolean;
  readonly hearingImpaired: "required" | "prefer" | "avoid" | "either";
  readonly sourceItemId?: number;
  readonly applicability?: "always" | "audio_matches" | "audio_does_not_match";
  readonly cutoff?: boolean;
}

export interface SubtitlePolicy {
  readonly source: "bazarr" | "explicit_default";
  readonly profileId: string;
  readonly profileName: string;
  readonly languages: readonly SubtitleLanguageRequirement[];
}

export interface SubtitleCandidate {
  readonly id: string;
  readonly provider: string;
  readonly language: string;
  readonly releaseName: string;
  readonly mediaIds: Readonly<Record<string, string>>;
  readonly season?: number;
  readonly episode?: number;
  readonly traits?: ReleaseTraits;
}

export interface ProviderSearchResult {
  readonly provider: string;
  readonly status: ProviderSearchStatus;
  readonly subtitles: readonly SubtitleCandidate[];
  readonly detail?: string;
}

export interface FeasibilityInput {
  readonly fixture: string;
  readonly item: MediaIdentity;
  readonly policy: SubtitlePolicy;
  readonly releases: readonly ArrReleaseCandidate[];
  readonly providerResults: readonly ProviderSearchResult[];
}

export interface MatchEvidence {
  readonly subtitleId: string;
  readonly provider: string;
  readonly subtitleReleaseName: string;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface LanguageAssessment {
  readonly language: string;
  readonly required: boolean;
  readonly confidence: SubtitleConfidence;
  readonly providerCount: number;
  readonly evidence?: MatchEvidence;
  readonly warnings: readonly string[];
}

export interface ReleaseAssessment {
  readonly releaseId: string;
  readonly releaseTitle: string;
  readonly video: {
    readonly downloadAllowed: boolean;
    readonly rejectionReasons: readonly string[];
    readonly customFormatScore: number;
    readonly evidence: ArrReleaseEvidence;
  };
  readonly subtitle: {
    readonly confidence: SubtitleConfidence;
    readonly languages: readonly LanguageAssessment[];
  };
}

export interface FeasibilityReport {
  readonly fixture: string;
  readonly mode: "read_only";
  readonly item: MediaIdentity;
  readonly policy: SubtitlePolicy;
  readonly providerStatus: readonly {
    readonly provider: string;
    readonly status: ProviderSearchStatus;
    readonly detail?: string;
  }[];
  readonly releases: readonly ReleaseAssessment[];
}
