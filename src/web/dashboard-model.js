export function rowsFromInventory(value) {
  if (!isRecord(value) || !Array.isArray(value.sources)) return [];
  const rows = [];
  for (const source of value.sources) {
    if (!isRecord(source) || source.status !== "ready" || !isRecord(source.page) || !Array.isArray(source.page.items)) continue;
    for (const item of source.page.items) {
      const row = dashboardRow(item);
      if (row !== undefined) rows.push(row);
    }
  }
  return rows;
}

export function selectRows(rows, options = {}) {
  const query = String(options.query ?? "").trim().toLocaleLowerCase();
  const kind = options.kind === "episode" || options.kind === "movie" ? options.kind : "all";
  const selected = rows.filter((row) =>
    (kind === "all" || row.kind === kind) &&
    (!query || `${row.title} ${row.context} ${row.application}`.toLocaleLowerCase().includes(query)),
  );
  const sort = options.sort ?? "available-desc";
  return selected.toSorted((left, right) => {
    if (sort === "title-asc") return left.title.localeCompare(right.title);
    if (sort === "kind-asc") return left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title);
    const direction = sort === "available-asc" ? 1 : -1;
    return direction * String(left.availableAt ?? "").localeCompare(String(right.availableAt ?? "")) || left.title.localeCompare(right.title);
  });
}

function dashboardRow(value) {
  if (!isRecord(value) || (value.kind !== "episode" && value.kind !== "movie")) return undefined;
  if ((value.application !== "sonarr" && value.application !== "radarr") || typeof value.title !== "string") return undefined;
  if (!Number.isSafeInteger(value.itemId) || value.itemId < 1 || value.title.trim().length === 0) return undefined;
  const title = value.kind === "episode" && typeof value.parentTitle === "string" && value.parentTitle.trim()
    ? value.parentTitle.trim()
    : value.title.trim();
  const context = value.kind === "episode"
    ? [episodeLabel(value.season, value.episode), value.title.trim()].filter(Boolean).join(" · ")
    : Number.isSafeInteger(value.year) ? String(value.year) : "Movie";
  return {
    key: `${value.application}:${value.kind}:${value.itemId}`,
    application: value.application,
    kind: value.kind,
    title,
    context,
    ...(typeof value.availableAt === "string" && !Number.isNaN(Date.parse(value.availableAt))
      ? { availableAt: value.availableAt }
      : {}),
  };
}

function episodeLabel(season, episode) {
  if (!Number.isSafeInteger(season) || !Number.isSafeInteger(episode)) return "Episode";
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
