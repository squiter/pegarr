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

export function selectReleases(rows, options = {}) {
  const decision = options.decision === "accepted" || options.decision === "rejected"
    ? options.decision
    : "all";
  const confidence = confidenceValues.includes(options.confidence) ? options.confidence : "all";
  const selected = rows.filter((row) =>
    (decision === "all" || (decision === "accepted") === row.downloadAllowed) &&
    (confidence === "all" || row.confidence === confidence),
  );
  const sort = options.sort ?? "recommended";
  return selected.toSorted((left, right) => {
    if (sort === "title-asc") return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
    if (sort === "custom-format-desc") {
      return right.customFormatScore - left.customFormatScore
        || compareVideoDecision(left, right)
        || compareConfidence(left, right)
        || left.title.localeCompare(right.title)
        || left.id.localeCompare(right.id);
    }
    if (sort === "confidence-desc") {
      return compareConfidence(left, right)
        || compareVideoDecision(left, right)
        || right.customFormatScore - left.customFormatScore
        || left.title.localeCompare(right.title)
        || left.id.localeCompare(right.id);
    }
    return compareReleases(left, right);
  });
}

export function feasibilityView(value) {
  if (!isRecord(value) || value.kind !== "item-feasibility" || typeof value.status !== "string") {
    return { state: "invalid", message: "Pegarr returned an unreadable feasibility report." };
  }
  if (value.status !== "ready") return unavailableView(value);
  if (!isRecord(value.report) || !isRecord(value.report.item) || !isRecord(value.report.policy) || !Array.isArray(value.report.releases)) {
    return { state: "invalid", message: "Pegarr returned an unreadable feasibility report." };
  }
  const item = value.report.item;
  const policy = value.report.policy;
  const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Selected item";
  const context = item.kind === "episode" && Number.isSafeInteger(item.season) && Number.isSafeInteger(item.episode)
    ? episodeLabel(item.season, item.episode)
    : Number.isSafeInteger(item.year) ? String(item.year) : item.kind === "movie" ? "Movie" : "Item";
  const languages = Array.isArray(policy.languages)
    ? policy.languages.flatMap((language) => isRecord(language) && typeof language.code === "string"
      ? [{ code: language.code, required: language.required === true }]
      : [])
    : [];
  const providers = Array.isArray(value.report.providerStatus)
    ? value.report.providerStatus.flatMap(providerView)
    : [];
  const releases = value.report.releases.flatMap(releaseView).toSorted(compareReleases);
  const metrics = isRecord(value.metrics) ? value.metrics : {};
  const analysis = isRecord(value.analysis) ? value.analysis : {};
  const analysisSource = analysis.source === "memory_cache" || analysis.source === "stale_cache"
    ? analysis.source
    : "computed";
  const refreshFailure = ["inventory_unavailable", "integration_failure", "unexpected_failure"].includes(analysis.refreshFailure)
    ? analysis.refreshFailure
    : undefined;
  return {
    state: "ready",
    title,
    context,
    policyName: typeof policy.profileName === "string" ? policy.profileName : "Resolved Bazarr policy",
    languages,
    providers,
    releases,
    analysis: {
      source: analysisSource,
      ...(safeTimestamp(analysis.generatedAt) === undefined ? {} : { generatedAt: safeTimestamp(analysis.generatedAt) }),
      ...(safeTimestamp(analysis.expiresAt) === undefined ? {} : { expiresAt: safeTimestamp(analysis.expiresAt) }),
      ...(safeTimestamp(analysis.staleUntil) === undefined ? {} : { staleUntil: safeTimestamp(analysis.staleUntil) }),
      ...(refreshFailure === undefined ? {} : { refreshFailure }),
      unavailableIntegrations: Array.isArray(analysis.unavailableIntegrations)
        ? analysis.unavailableIntegrations.filter((integration) => ["sonarr", "radarr", "bazarr", "subdl"].includes(integration))
        : [],
      elapsedMs: safeCount(metrics.elapsedMs),
      arrRequests: safeCount(metrics.sonarrRequests) + safeCount(metrics.radarrRequests),
      bazarrRequests: safeCount(metrics.bazarrRequests),
      providerRequests: safeCount(metrics.providerRequests),
    },
  };
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
    itemId: value.itemId,
    application: value.application,
    kind: value.kind,
    title,
    context,
    ...(typeof value.availableAt === "string" && !Number.isNaN(Date.parse(value.availableAt))
      ? { availableAt: value.availableAt }
      : {}),
  };
}

function unavailableView(value) {
  if (value.status === "disabled") {
    const integrations = Array.isArray(value.missingIntegrations)
      ? value.missingIntegrations.filter((entry) => typeof entry === "string").join(", ")
      : "required integrations";
    return { state: "disabled", message: `Configure ${integrations || "required integrations"} before investigating this item.` };
  }
  if (value.status === "policy_unresolved") {
    const reason = typeof value.reason === "string" ? value.reason.replaceAll("_", " ") : "unresolved";
    return { state: "policy_unresolved", message: `Bazarr policy is ${reason}. Pegarr did not assume a subtitle language.` };
  }
  if (value.status === "inventory_unavailable") {
    const state = typeof value.state === "string" ? value.state.replaceAll("_", " ") : "unavailable";
    return { state: "inventory_unavailable", message: `The selected Arr inventory is ${state}. No release analysis was started.` };
  }
  if (value.status === "integration_failure") {
    const names = Array.isArray(value.failures)
      ? value.failures.flatMap((failure) => isRecord(failure) && typeof failure.integration === "string" ? [failure.integration] : [])
      : [];
    return { state: "integration_failure", message: `${names.join(" and ") || "An integration"} could not complete the read-only analysis. Subtitle availability remains Unknown.` };
  }
  if (value.status === "not_found") return { state: "not_found", message: "This item is no longer in the bounded missing inventory." };
  return { state: "invalid", message: "Pegarr could not build a feasibility report for this item." };
}

function releaseView(value) {
  if (!isRecord(value) || typeof value.releaseId !== "string" || typeof value.releaseTitle !== "string" || !isRecord(value.video) || !isRecord(value.subtitle)) return [];
  const evidence = isRecord(value.video.evidence) ? value.video.evidence : {};
  const languages = Array.isArray(value.subtitle.languages)
    ? value.subtitle.languages.flatMap((language) => languageView(language))
    : [];
  const rejectionReasons = Array.isArray(value.video.rejectionReasons)
    ? value.video.rejectionReasons.filter((reason) => typeof reason === "string")
    : [];
  return [{
    id: value.releaseId,
    title: value.releaseTitle,
    downloadAllowed: value.video.downloadAllowed === true,
    rejectionReasons,
    customFormatScore: Number.isFinite(value.video.customFormatScore) ? value.video.customFormatScore : 0,
    quality: typeof evidence.quality === "string" ? evidence.quality : "Quality unavailable",
    indexer: typeof evidence.indexer === "string" ? evidence.indexer : "Indexer unavailable",
    protocol: typeof evidence.protocol === "string" ? evidence.protocol : "Protocol unavailable",
    confidence: safeConfidence(value.subtitle.confidence),
    languages,
  }];
}

function languageView(value) {
  if (!isRecord(value) || typeof value.language !== "string") return [];
  const evidence = isRecord(value.evidence) ? value.evidence : undefined;
  return [{
    language: value.language,
    required: value.required === true,
    confidence: safeConfidence(value.confidence),
    providerCount: Number.isSafeInteger(value.providerCount) ? value.providerCount : 0,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning) => typeof warning === "string") : [],
    ...(evidence === undefined ? {} : {
      evidence: {
        provider: typeof evidence.provider === "string" ? evidence.provider : "Provider",
        releaseName: typeof evidence.subtitleReleaseName === "string" ? evidence.subtitleReleaseName : "Release evidence unavailable",
        reasons: Array.isArray(evidence.reasons) ? evidence.reasons.filter((reason) => typeof reason === "string") : [],
      },
    }),
  }];
}

function providerView(value) {
  if (!isRecord(value) || typeof value.provider !== "string" || typeof value.status !== "string") return [];
  const cache = isRecord(value.cache) ? value.cache : {};
  const quota = isRecord(value.quota) ? value.quota : {};
  return [{
    provider: value.provider,
    status: value.status,
    detail: typeof value.detail === "string" ? value.detail : "",
    cacheStatus: cache.status === "hit" || cache.status === "miss" ? cache.status : undefined,
    ...(safeTimestamp(cache.storedAt) === undefined ? {} : { cachedAt: safeTimestamp(cache.storedAt) }),
    ...(safeTimestamp(cache.expiresAt) === undefined ? {} : { cacheExpiresAt: safeTimestamp(cache.expiresAt) }),
    quota: {
      ...(safeOptionalCount(quota.remaining) === undefined ? {} : { remaining: safeOptionalCount(quota.remaining) }),
      ...(safeOptionalCount(quota.limit) === undefined ? {} : { limit: safeOptionalCount(quota.limit) }),
      ...(safeEpochSeconds(quota.resetAtEpochSeconds) === undefined ? {} : { resetAtEpochSeconds: safeEpochSeconds(quota.resetAtEpochSeconds) }),
    },
  }];
}

function safeCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1_000_000) : 0;
}

function safeOptionalCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), Number.MAX_SAFE_INTEGER) : undefined;
}

function safeEpochSeconds(value) {
  return Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000
    ? Math.round(value)
    : undefined;
}

function safeTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function safeConfidence(value) {
  return confidenceValues.includes(value) ? value : "unknown";
}

function compareReleases(left, right) {
  return compareVideoDecision(left, right)
    || compareConfidence(left, right)
    || right.customFormatScore - left.customFormatScore
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id);
}

function compareVideoDecision(left, right) {
  if (left.downloadAllowed === right.downloadAllowed) return 0;
  return left.downloadAllowed ? -1 : 1;
}

function compareConfidence(left, right) {
  return confidenceRank[left.confidence] - confidenceRank[right.confidence];
}

function episodeLabel(season, episode) {
  if (!Number.isSafeInteger(season) || !Number.isSafeInteger(episode)) return "Episode";
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const confidenceValues = ["confirmed", "likely", "possible", "no_match_found", "unknown"];
const confidenceRank = { confirmed: 0, likely: 1, possible: 2, no_match_found: 3, unknown: 4 };
