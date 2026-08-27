export interface DashboardRow {
  readonly key: string;
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
