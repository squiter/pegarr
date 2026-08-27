export interface DashboardRow {
  readonly key: string;
  readonly itemId: number;
  readonly application: "sonarr" | "radarr";
  readonly kind: "episode" | "movie";
  readonly title: string;
  readonly context: string;
  readonly availableAt?: string;
}

export function rowsFromInventory(value: unknown): readonly DashboardRow[];
export function selectRows(
  rows: readonly DashboardRow[],
  options: { readonly query?: string; readonly kind?: string; readonly sort?: string },
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
  readonly confidence: "confirmed" | "likely" | "possible" | "no_match_found" | "unknown";
  readonly languages: readonly {
    readonly language: string;
    readonly required: boolean;
    readonly confidence: "confirmed" | "likely" | "possible" | "no_match_found" | "unknown";
    readonly providerCount: number;
    readonly warnings: readonly string[];
    readonly evidence?: { readonly provider: string; readonly releaseName: string; readonly reasons: readonly string[] };
  }[];
}

export type FeasibilityView =
  | { readonly state: "ready"; readonly title: string; readonly context: string; readonly policyName: string; readonly languages: readonly { readonly code: string; readonly required: boolean }[]; readonly providers: readonly { readonly provider: string; readonly status: string; readonly detail: string; readonly cacheStatus?: "hit" | "miss"; readonly cachedAt?: string; readonly cacheExpiresAt?: string; readonly quota: { readonly remaining?: number; readonly limit?: number; readonly resetAtEpochSeconds?: number } }[]; readonly releases: readonly FeasibilityReleaseRow[]; readonly analysis: { readonly source: "computed" | "memory_cache"; readonly generatedAt?: string; readonly expiresAt?: string; readonly elapsedMs: number; readonly arrRequests: number; readonly bazarrRequests: number; readonly providerRequests: number } }
  | { readonly state: "invalid" | "disabled" | "policy_unresolved" | "inventory_unavailable" | "integration_failure" | "not_found"; readonly message: string };

export function feasibilityView(value: unknown): FeasibilityView;
