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
  | "unsupported"
  | "unauthorized"
  | "invalid_response"
  | "unexpected_status";

export interface MediaIdentity {
  readonly kind: "movie" | "episode" | "season";
  readonly title: string;
  readonly year?: number;
  readonly season?: number;
  readonly episode?: number;
  readonly ids: Readonly<Record<string, string>>;
}

export interface MissingItemQuery {
  readonly page?: number;
  readonly pageSize?: number;
}

export interface MissingMediaItem {
  readonly application: "sonarr" | "radarr";
  readonly instanceId: string;
  readonly kind: "episode" | "movie";
  readonly itemId: number;
  readonly parentId?: number;
  readonly title: string;
  readonly parentTitle?: string;
  readonly year?: number;
  readonly season?: number;
  readonly episode?: number;
  readonly monitored: boolean;
  readonly hasFile: boolean;
  readonly availableAt?: string;
  readonly ids: Readonly<Record<string, string>>;
}

export interface MissingItemPage {
  readonly page: number;
  readonly pageSize: number;
  readonly totalRecords: number;
  readonly items: readonly MissingMediaItem[];
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
  readonly fullSeason?: boolean;
  readonly seasonNumber?: number;
  readonly episodeNumbers?: readonly number[];
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

/** Server-only handle returned by Arr release search and never serialized to the browser. */
export interface ArrReleaseHandle {
  readonly guid: string;
  readonly indexerId: number;
}

export interface RevalidatedArrRelease {
  readonly candidate: ArrReleaseCandidate;
  readonly handle: ArrReleaseHandle;
}

export interface ArrGrabReceipt {
  readonly status: "accepted";
  readonly responseStatus: 200;
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
  readonly providerLanguage?: string;
  readonly releaseName: string;
  readonly mediaIds: Readonly<Record<string, string>>;
  readonly season?: number;
  readonly episode?: number;
  readonly hearingImpaired?: boolean;
  readonly forced?: boolean;
  readonly fullSeason?: boolean;
  readonly traits?: ReleaseTraits;
}

export interface ProviderQuotaEvidence {
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAtEpochSeconds?: number;
  readonly windowSeconds?: number;
}

export interface ProviderCacheEvidence {
  readonly status: "hit" | "miss";
  readonly storedAt: string;
  readonly expiresAt: string;
}

export interface ProviderSearchResult {
  readonly provider: string;
  readonly status: ProviderSearchStatus;
  readonly searchedLanguages?: readonly string[];
  readonly subtitles: readonly SubtitleCandidate[];
  readonly detail?: string;
  readonly quota?: ProviderQuotaEvidence;
  readonly cache?: ProviderCacheEvidence;
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
    readonly traits?: ReleaseTraits;
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
    readonly searchedLanguages?: readonly string[];
    readonly detail?: string;
    readonly quota?: ProviderQuotaEvidence;
    readonly cache?: ProviderCacheEvidence;
  }[];
  readonly releases: readonly ReleaseAssessment[];
}
