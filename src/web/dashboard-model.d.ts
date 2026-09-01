export interface DashboardRow {
  readonly key: string;
  readonly itemId: number;
  readonly application: "sonarr" | "radarr";
  readonly kind: "episode" | "movie";
  readonly title: string;
  readonly context: string;
  readonly availableAt?: string;
  readonly analysis?: DashboardAnalysisSummary;
}

export type DashboardAnalysisState = "ready" | "stale" | "disabled" | "policy_unresolved" | "inventory_unavailable" | "integration_failure" | "not_found" | "invalid";
export type RequiredCoverage = "strong" | "possible" | "no_match_found" | "unknown" | "no_accepted_release" | "no_required_languages";
export type ProviderEvidence = "available" | "partial" | "unavailable" | "unknown";
export interface DashboardAnalysisSummary {
  readonly state: DashboardAnalysisState;
  readonly bestConfidence: FeasibilityReleaseRow["confidence"] | "none";
  readonly releaseCount: number;
  readonly acceptedCount: number;
  readonly policyName?: string;
  readonly languages?: readonly { readonly code: string; readonly displayCode?: string; readonly required: boolean }[];
  readonly requiredCoverage: RequiredCoverage;
  readonly requiredLanguages: readonly { readonly code: string; readonly displayCode?: string; readonly confidence: FeasibilityReleaseRow["confidence"] }[];
  readonly providerEvidence: ProviderEvidence;
  readonly providerResultCount: number;
  readonly availableProviderResultCount: number;
  readonly providerFailures: readonly string[];
  readonly generatedAt?: string;
  readonly message?: string;
}

export function rowsFromInventory(value: unknown): readonly DashboardRow[];
export type CatalogCoverageView =
  | {
      readonly state: "ready";
      readonly languages: readonly { readonly code: string; readonly displayCode: string; readonly state: "available" | "no_match_found" | "unknown" | "unsupported"; readonly label: string }[];
      readonly providers: readonly { readonly id: "subdl" | "opensubtitles" | "provider"; readonly name: string; readonly status: string; readonly message: string }[];
    }
  | { readonly state: "invalid"; readonly message: string };
export function catalogCoverageView(value: unknown): CatalogCoverageView;
export function displayLanguageCode(value: unknown): string;
export function selectRows(
  rows: readonly DashboardRow[],
  options: { readonly query?: string; readonly application?: string; readonly kind?: string; readonly analysis?: string; readonly confidence?: string; readonly requiredCoverage?: string; readonly providerEvidence?: string; readonly profile?: string; readonly language?: string; readonly analysisAge?: string; readonly nowEpochMs?: number; readonly sort?: string },
): readonly DashboardRow[];
export function activeInventoryFilterCount(
  options: { readonly query?: string; readonly application?: string; readonly kind?: string; readonly analysis?: string; readonly confidence?: string; readonly requiredCoverage?: string; readonly providerEvidence?: string; readonly profile?: string; readonly language?: string; readonly analysisAge?: string; readonly sort?: string },
): number;
export interface SubtitleLanguageRequirementInput {
  readonly code: string;
  readonly required: boolean;
  readonly forced: boolean;
  readonly hearingImpaired: "required" | "prefer" | "avoid" | "either";
}
export function subtitleLanguageRequirements(
  value: string,
  preferences?: readonly SubtitleLanguageRequirementInput[],
): readonly SubtitleLanguageRequirementInput[];
export function rowsWithAnalysis(
  rows: readonly DashboardRow[],
  analyses: ReadonlyMap<string, DashboardAnalysisSummary>,
): readonly DashboardRow[];

export interface FeasibilityReleaseRow {
  readonly id: string;
  readonly title: string;
  readonly downloadAllowed: boolean;
  readonly rejectionReasons: readonly string[];
  readonly customFormatScore: number;
  readonly quality: string;
  readonly indexer: string;
  readonly protocol: string;
  readonly sizeBytes?: number;
  readonly ageHours?: number;
  readonly seeders?: number;
  readonly leechers?: number;
  readonly arrLanguages: readonly string[];
  readonly customFormats: readonly string[];
  readonly releaseGroup?: string;
  readonly edition?: string;
  readonly confidence: "confirmed" | "likely" | "possible" | "no_match_found" | "unknown";
  readonly requiredFit: "strong" | "possible" | "no_match_found" | "unknown" | "no_required_languages";
  readonly languages: readonly {
    readonly language: string;
    readonly required: boolean;
    readonly confidence: "confirmed" | "likely" | "possible" | "no_match_found" | "unknown";
    readonly providerCount: number;
    readonly warnings: readonly string[];
    readonly evidence?: { readonly provider: string; readonly releaseName: string; readonly reasons: readonly string[] };
  }[];
}

export function selectReleases(
  rows: readonly FeasibilityReleaseRow[],
  options: { readonly query?: string; readonly decision?: string; readonly confidence?: string; readonly protocol?: string; readonly requiredFit?: string; readonly language?: string; readonly languageConfidence?: string; readonly sort?: string },
): readonly FeasibilityReleaseRow[];
export function leadingRelease(rows: readonly FeasibilityReleaseRow[]): FeasibilityReleaseRow | undefined;
export function shortlistedReleases(
  rows: readonly FeasibilityReleaseRow[],
  releaseIds: readonly string[] | unknown,
): readonly FeasibilityReleaseRow[];
export interface ReleaseComparisonCandidate extends FeasibilityReleaseRow {
  readonly strengths: {
    readonly subtitleConfidence: boolean;
    readonly requiredFit: boolean;
    readonly customFormatScore: boolean;
    readonly seeders: boolean;
    readonly age: boolean;
  };
}
export interface ReleaseComparisonLanguage {
  readonly code: string;
  readonly displayCode: string;
  readonly required: boolean;
  readonly assessments: readonly {
    readonly releaseId: string;
    readonly confidence: FeasibilityReleaseRow["confidence"];
    readonly providerCount: number;
    readonly warnings: readonly string[];
    readonly evidence?: { readonly provider: string; readonly releaseName: string; readonly reasons: readonly string[] };
    readonly strongest: boolean;
  }[];
}
export function releaseComparison(
  rows: readonly FeasibilityReleaseRow[],
  releaseIds: readonly string[] | unknown,
): { readonly candidates: readonly ReleaseComparisonCandidate[]; readonly languages: readonly ReleaseComparisonLanguage[] };

export type FeasibilityView =
  | { readonly state: "ready"; readonly title: string; readonly context: string; readonly policyName: string; readonly policySource: "bazarr" | "explicit_default" | "unknown"; readonly languages: readonly { readonly code: string; readonly displayCode: string; readonly required: boolean; readonly forced: boolean; readonly hearingImpaired: "required" | "prefer" | "avoid" | "either"; readonly applicability?: "always" | "audio_matches" | "audio_does_not_match"; readonly cutoff?: boolean }[]; readonly providers: readonly { readonly provider: string; readonly status: string; readonly detail: string; readonly cacheStatus?: "hit" | "miss"; readonly cachedAt?: string; readonly cacheExpiresAt?: string; readonly quota: { readonly remaining?: number; readonly limit?: number; readonly resetAtEpochSeconds?: number; readonly windowSeconds?: number } }[]; readonly releases: readonly FeasibilityReleaseRow[]; readonly controlledGrab: boolean; readonly analysis: { readonly source: "computed" | "memory_cache" | "stale_cache"; readonly generatedAt?: string; readonly expiresAt?: string; readonly staleUntil?: string; readonly refreshFailure?: "inventory_unavailable" | "integration_failure" | "unexpected_failure"; readonly unavailableIntegrations: readonly ("sonarr" | "radarr" | "bazarr" | "subdl")[]; readonly elapsedMs: number; readonly arrRequests: number; readonly bazarrRequests: number; readonly providerRequests: number } }
  | { readonly state: "invalid" | "disabled" | "policy_unresolved" | "inventory_unavailable" | "integration_failure" | "not_found"; readonly message: string };

export function feasibilityView(value: unknown): FeasibilityView;
export function itemAnalysisSummary(view: FeasibilityView | unknown): DashboardAnalysisSummary;
