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
  const filters = inventorySelectionOptions(options);
  const selected = rows.filter((row) =>
    (filters.application === "all" || row.application === filters.application) &&
    (filters.kind === "all" || row.kind === filters.kind) &&
    matchesAnalysis(row.analysis, filters.analysis) &&
    matchesSummaryConfidence(row.analysis, filters.confidence) &&
    matchesRequiredCoverage(row.analysis, filters.requiredCoverage) &&
    matchesProviderEvidence(row.analysis, filters.providerEvidence) &&
    matchesProfile(row.analysis, filters.profile) &&
    matchesPolicyLanguage(row.analysis, filters.language) &&
    matchesAnalysisAge(row.analysis, filters.analysisAge, filters.nowEpochMs) &&
    (!filters.query || rowSearchText(row).includes(filters.query)),
  );
  const sort = options.sort ?? "available-desc";
  return selected.toSorted((left, right) => {
    if (sort === "title-asc") return left.title.localeCompare(right.title);
    if (sort === "kind-asc") return left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title);
    if (sort === "confidence-desc") return compareRowAnalysis(left, right) || left.title.localeCompare(right.title);
    if (sort === "analyzed-desc") {
      return compareAnalysisPresence(left, right)
        || String(right.analysis?.generatedAt ?? "").localeCompare(String(left.analysis?.generatedAt ?? ""))
        || left.title.localeCompare(right.title);
    }
    const direction = sort === "available-asc" ? 1 : -1;
    return direction * String(left.availableAt ?? "").localeCompare(String(right.availableAt ?? "")) || left.title.localeCompare(right.title);
  });
}

export function activeInventoryFilterCount(options = {}) {
  const filters = inventorySelectionOptions(options);
  return [
    filters.query,
    filters.application,
    filters.kind,
    filters.analysis,
    filters.confidence,
    filters.requiredCoverage,
    filters.providerEvidence,
    filters.profile,
    filters.language,
    filters.analysisAge,
  ].filter((value) => value !== "" && value !== "all").length;
}

export function subtitleLanguageRequirements(value, preferences = []) {
  if (typeof value !== "string" || !Array.isArray(preferences)) throw new TypeError("Invalid subtitle language policy");
  const codes = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (codes.length < 1 || codes.length > 16) throw new TypeError("Subtitle policy requires 1 through 16 languages");
  const preferenceMap = new Map(preferences.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.code !== "string") return [];
    return [[languagePreferenceKey(entry.code), entry]];
  }));
  const seen = new Set();
  return codes.map((code) => {
    if (code.length > 32 || /[\u0000-\u002c\u007f]/u.test(code)) throw new TypeError("Invalid subtitle language code");
    const key = languagePreferenceKey(code);
    if (seen.has(key)) throw new TypeError("Subtitle languages must be unique");
    seen.add(key);
    const preference = preferenceMap.get(key);
    const hearingImpaired = hearingImpairedValues.includes(preference?.hearingImpaired)
      ? preference.hearingImpaired
      : "either";
    return {
      code,
      required: preference?.required !== false,
      forced: preference?.forced === true,
      hearingImpaired,
    };
  });
}

export function rowsWithAnalysis(rows, analyses) {
  return rows.map((row) => {
    const analysis = analyses.get(row.key);
    return analysis === undefined ? row : { ...row, analysis };
  });
}

export function itemAnalysisSummary(view) {
  if (!isRecord(view) || typeof view.state !== "string") {
    return emptyAnalysisSummary("invalid");
  }
  if (view.state !== "ready") {
    const state = ["disabled", "policy_unresolved", "inventory_unavailable", "integration_failure", "not_found"].includes(view.state)
      ? view.state
      : "invalid";
    return {
      ...emptyAnalysisSummary(state),
      ...(typeof view.message === "string" ? { message: view.message } : {}),
    };
  }
  const releases = Array.isArray(view.releases) ? view.releases : [];
  const accepted = releases.filter((release) => release.downloadAllowed === true).toSorted(compareReleases);
  const analysis = isRecord(view.analysis) ? view.analysis : {};
  const languages = Array.isArray(view.languages)
    ? view.languages.flatMap((language) => isRecord(language) && typeof language.code === "string"
      ? [{ code: language.code, required: language.required === true }]
      : [])
    : [];
  const requiredCoverage = summarizeRequiredCoverage(languages, accepted);
  const providerEvidence = summarizeProviderEvidence(Array.isArray(view.providers) ? view.providers : []);
  return {
    state: analysis.source === "stale_cache" ? "stale" : "ready",
    bestConfidence: accepted[0]?.confidence ?? "none",
    releaseCount: releases.length,
    acceptedCount: accepted.length,
    policyName: typeof view.policyName === "string" ? view.policyName : "Resolved Bazarr policy",
    languages,
    ...requiredCoverage,
    ...providerEvidence,
    ...(safeTimestamp(analysis.generatedAt) === undefined ? {} : { generatedAt: safeTimestamp(analysis.generatedAt) }),
  };
}

function emptyAnalysisSummary(state) {
  return {
    state,
    bestConfidence: "none",
    releaseCount: 0,
    acceptedCount: 0,
    requiredCoverage: "unknown",
    requiredLanguages: [],
    providerEvidence: "unknown",
    providerResultCount: 0,
    availableProviderResultCount: 0,
    providerFailures: [],
  };
}

function summarizeRequiredCoverage(languages, acceptedReleases) {
  const required = languages.filter(({ required }) => required);
  if (required.length === 0) return { requiredCoverage: "no_required_languages", requiredLanguages: [] };
  if (acceptedReleases.length === 0) {
    return {
      requiredCoverage: "no_accepted_release",
      requiredLanguages: required.map(({ code }) => ({ code, confidence: "unknown" })),
    };
  }
  const requiredLanguages = required.map(({ code }) => {
    const assessments = acceptedReleases.flatMap(({ languages: releaseLanguages }) =>
      Array.isArray(releaseLanguages)
        ? releaseLanguages.filter(({ language }) => language === code).map(({ confidence }) => safeConfidence(confidence))
        : [],
    );
    return { code, confidence: bestLanguageConfidence(assessments) };
  });
  const confidences = requiredLanguages.map(({ confidence }) => confidence);
  const requiredCoverage = confidences.includes("unknown")
    ? "unknown"
    : confidences.includes("no_match_found")
      ? "no_match_found"
      : confidences.includes("possible")
        ? "possible"
        : "strong";
  return { requiredCoverage, requiredLanguages };
}

function bestLanguageConfidence(confidences) {
  for (const confidence of ["confirmed", "likely", "possible"]) {
    if (confidences.includes(confidence)) return confidence;
  }
  if (confidences.includes("unknown") || confidences.length === 0) return "unknown";
  return "no_match_found";
}

function summarizeProviderEvidence(providers) {
  const statuses = providers.flatMap((provider) => isRecord(provider) && typeof provider.status === "string" ? [provider.status] : []);
  const availableProviderResultCount = statuses.filter((status) => status === "success").length;
  const providerFailures = [...new Set(statuses.filter((status) => status !== "success"))].toSorted();
  let providerEvidence = "unknown";
  if (statuses.length > 0 && availableProviderResultCount === statuses.length) providerEvidence = "available";
  else if (availableProviderResultCount > 0) providerEvidence = "partial";
  else if (statuses.length > 0 && statuses.every((status) => providerFailureStatuses.includes(status))) providerEvidence = "unavailable";
  return {
    providerEvidence,
    providerResultCount: statuses.length,
    availableProviderResultCount,
    providerFailures,
  };
}

export function selectReleases(rows, options = {}) {
  const query = String(options.query ?? "").trim().toLocaleLowerCase();
  const decision = options.decision === "accepted" || options.decision === "rejected"
    ? options.decision
    : "all";
  const confidence = confidenceValues.includes(options.confidence) ? options.confidence : "all";
  const protocol = releaseProtocols.includes(options.protocol) ? options.protocol : "all";
  const requiredFit = requiredFitValues.includes(options.requiredFit) ? options.requiredFit : "all";
  const language = typeof options.language === "string" && options.language.trim()
    ? options.language.trim().toLocaleLowerCase()
    : "all";
  const languageConfidence = confidenceValues.includes(options.languageConfidence)
    ? options.languageConfidence
    : "all";
  const selected = rows.filter((row) =>
    (decision === "all" || (decision === "accepted") === row.downloadAllowed) &&
    (confidence === "all" || row.confidence === confidence) &&
    (protocol === "all" || row.protocol.toLocaleLowerCase() === protocol) &&
    (requiredFit === "all" || row.requiredFit === requiredFit) &&
    matchesLanguageAssessment(row.languages, language, languageConfidence) &&
    (!query || releaseSearchText(row).includes(query)),
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
    if (sort === "seeders-desc") {
      return compareOptionalReleaseNumber(left, right, "seeders", "desc")
        || compareVideoDecision(left, right)
        || compareConfidence(left, right)
        || left.title.localeCompare(right.title);
    }
    if (sort === "size-asc" || sort === "size-desc") {
      return compareOptionalReleaseNumber(left, right, "sizeBytes", sort === "size-asc" ? "asc" : "desc")
        || compareVideoDecision(left, right)
        || compareConfidence(left, right)
        || left.title.localeCompare(right.title);
    }
    if (sort === "age-asc") {
      return compareOptionalReleaseNumber(left, right, "ageHours", "asc")
        || compareVideoDecision(left, right)
        || compareConfidence(left, right)
        || left.title.localeCompare(right.title);
    }
    return compareReleases(left, right);
  });
}

export function leadingRelease(rows) {
  return selectReleases(rows, { decision: "accepted", sort: "recommended" })[0];
}

export function shortlistedReleases(rows, releaseIds) {
  if (!Array.isArray(releaseIds)) return [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selected = [];
  const seen = new Set();
  for (const id of releaseIds) {
    if (typeof id !== "string" || seen.has(id)) continue;
    const row = byId.get(id);
    if (row === undefined) continue;
    selected.push(row);
    seen.add(id);
    if (selected.length === maximumShortlistSize) break;
  }
  return selected;
}

export function releaseComparison(rows, releaseIds) {
  const releases = shortlistedReleases(rows, releaseIds);
  const comparable = releases.length > 1;
  const bestConfidenceRank = minimumDefined(releases.map(({ confidence }) => strongConfidenceRank[confidence]));
  const bestRequiredFitRank = minimumDefined(releases.map(({ requiredFit }) => strongRequiredFitRank[requiredFit]));
  const highestCustomFormatScore = maximumDefined(releases.map(({ customFormatScore }) => customFormatScore));
  const highestSeeders = maximumDefined(releases.map(({ seeders }) => seeders));
  const newestAgeHours = minimumDefined(releases.map(({ ageHours }) => ageHours));
  const languageDefinitions = [];
  const seenLanguages = new Set();
  for (const release of releases) {
    for (const language of release.languages) {
      const key = language.language.toLocaleLowerCase();
      if (seenLanguages.has(key)) continue;
      languageDefinitions.push({ code: language.language, key, required: language.required === true });
      seenLanguages.add(key);
    }
  }
  const bestLanguageRanks = new Map(languageDefinitions.map(({ key }) => [
    key,
    minimumDefined(releases.map((release) => {
      const language = release.languages.find(({ language: code }) => code.toLocaleLowerCase() === key);
      return strongConfidenceRank[language?.confidence ?? "unknown"];
    })),
  ]));

  return {
    candidates: releases.map((release) => ({
      ...release,
      strengths: comparable
        ? {
            subtitleConfidence: bestConfidenceRank !== undefined && strongConfidenceRank[release.confidence] === bestConfidenceRank,
            requiredFit: bestRequiredFitRank !== undefined && strongRequiredFitRank[release.requiredFit] === bestRequiredFitRank,
            customFormatScore: release.customFormatScore === highestCustomFormatScore,
            seeders: release.seeders !== undefined && release.seeders === highestSeeders,
            age: release.ageHours !== undefined && release.ageHours === newestAgeHours,
          }
        : {
            subtitleConfidence: false,
            requiredFit: false,
            customFormatScore: false,
            seeders: false,
            age: false,
          },
    })),
    languages: languageDefinitions.map(({ code, key, required }) => ({
      code,
      required,
      assessments: releases.map((release) => {
        const assessment = release.languages.find(({ language }) => language.toLocaleLowerCase() === key);
        const confidence = assessment?.confidence ?? "unknown";
        return {
          releaseId: release.id,
          confidence,
          providerCount: assessment?.providerCount ?? 0,
          warnings: assessment?.warnings ?? [],
          ...(assessment?.evidence === undefined ? {} : { evidence: assessment.evidence }),
          strongest: comparable && bestLanguageRanks.get(key) !== undefined && strongConfidenceRank[confidence] === bestLanguageRanks.get(key),
        };
      }),
    })),
  };
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
    : item.kind === "season" && Number.isSafeInteger(item.season)
      ? item.season === 0 ? "Specials" : `Season ${item.season}`
    : Number.isSafeInteger(item.year) ? String(item.year) : item.kind === "movie" ? "Movie" : "Item";
  const languages = Array.isArray(policy.languages)
    ? policy.languages.flatMap((language) => isRecord(language) && typeof language.code === "string"
      ? [{
          code: language.code,
          required: language.required === true,
          forced: language.forced === true,
          hearingImpaired: hearingImpairedValues.includes(language.hearingImpaired) ? language.hearingImpaired : "either",
          ...(applicabilityValues.includes(language.applicability) ? { applicability: language.applicability } : {}),
          ...(typeof language.cutoff === "boolean" ? { cutoff: language.cutoff } : {}),
        }]
      : [])
    : [];
  const providers = Array.isArray(value.report.providerStatus)
    ? value.report.providerStatus.flatMap(providerView)
    : [];
  const releases = value.report.releases.flatMap(releaseView).toSorted(compareReleases);
  const metrics = isRecord(value.metrics) ? value.metrics : {};
  const analysis = isRecord(value.analysis) ? value.analysis : {};
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
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
    policySource: policy.source === "bazarr" || policy.source === "explicit_default" ? policy.source : "unknown",
    languages,
    providers,
    releases,
    controlledGrab: capabilities.controlledGrab === true,
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
  if (typeof value.instanceId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(value.instanceId)) return undefined;
  const title = value.kind === "episode" && typeof value.parentTitle === "string" && value.parentTitle.trim()
    ? value.parentTitle.trim()
    : value.title.trim();
  const context = value.kind === "episode"
    ? [episodeLabel(value.season, value.episode), value.title.trim()].filter(Boolean).join(" · ")
    : Number.isSafeInteger(value.year) ? String(value.year) : "Movie";
  return {
    key: `${value.application}:${value.instanceId}:${value.kind}:${value.itemId}`,
    itemId: value.itemId,
    application: value.application,
    instanceId: value.instanceId,
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
    if (value.reason === "explicit_default_unconfigured") {
      return { state: "policy_unresolved", message: "Configure at least one Pegarr subtitle language before exact release analysis." };
    }
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
  const traits = isRecord(value.video.traits) ? value.video.traits : {};
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
    ...(safeOptionalCount(evidence.sizeBytes) === undefined ? {} : { sizeBytes: safeOptionalCount(evidence.sizeBytes) }),
    ...(safeDecimal(evidence.ageHours) === undefined ? {} : { ageHours: safeDecimal(evidence.ageHours) }),
    ...(safeOptionalCount(evidence.seeders) === undefined ? {} : { seeders: safeOptionalCount(evidence.seeders) }),
    ...(safeOptionalCount(evidence.leechers) === undefined ? {} : { leechers: safeOptionalCount(evidence.leechers) }),
    arrLanguages: Array.isArray(evidence.languages) ? evidence.languages.filter((language) => typeof language === "string") : [],
    customFormats: Array.isArray(evidence.customFormats)
      ? evidence.customFormats.flatMap((format) => isRecord(format) && typeof format.name === "string" ? [format.name] : [])
      : [],
    ...(typeof traits.releaseGroup === "string" ? { releaseGroup: traits.releaseGroup } : {}),
    ...(typeof traits.edition === "string" ? { edition: traits.edition } : {}),
    confidence: safeConfidence(value.subtitle.confidence),
    languages,
    requiredFit: requiredLanguageFit(languages),
  }];
}

function requiredLanguageFit(languages) {
  const required = languages.filter(({ required }) => required);
  if (required.length === 0) return "no_required_languages";
  const confidences = required.map(({ confidence }) => confidence);
  if (confidences.includes("unknown")) return "unknown";
  if (confidences.includes("no_match_found")) return "no_match_found";
  if (confidences.includes("possible")) return "possible";
  return "strong";
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
      ...(safeQuotaWindow(quota.windowSeconds) === undefined ? {} : { windowSeconds: safeQuotaWindow(quota.windowSeconds) }),
    },
  }];
}

function safeCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1_000_000) : 0;
}

function safeOptionalCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), Number.MAX_SAFE_INTEGER) : undefined;
}

function safeDecimal(value) {
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 1_000_000) : undefined;
}

function safeEpochSeconds(value) {
  return Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000
    ? Math.round(value)
    : undefined;
}

function safeQuotaWindow(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 86_400 ? value : undefined;
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

function compareOptionalReleaseNumber(left, right, field, direction) {
  const leftValue = left[field];
  const rightValue = right[field];
  if (leftValue === undefined && rightValue === undefined) return 0;
  if (leftValue === undefined) return 1;
  if (rightValue === undefined) return -1;
  return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
}

function releaseSearchText(row) {
  return [
    row.title,
    row.quality,
    row.indexer,
    row.protocol,
    row.releaseGroup,
    row.edition,
    ...row.arrLanguages,
    ...row.customFormats,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function matchesLanguageAssessment(languages, language, confidence) {
  const targeted = language === "all"
    ? languages
    : languages.filter(({ language: code }) => code.toLocaleLowerCase() === language);
  return (language === "all" || targeted.length > 0) &&
    (confidence === "all" || targeted.some((assessment) => assessment.confidence === confidence));
}

function matchesAnalysis(summary, filter) {
  if (filter === "all") return true;
  if (filter === "not_analyzed") return summary === undefined;
  if (filter === "analyzed") return summary !== undefined;
  if (filter === "stale") return summary?.state === "stale";
  return summary !== undefined && (
    summary.state !== "ready" || ["possible", "no_match_found", "unknown", "none"].includes(summary.bestConfidence)
  );
}

function matchesSummaryConfidence(summary, confidence) {
  if (confidence === "all") return true;
  return (summary?.state === "ready" || summary?.state === "stale") && summary.bestConfidence === confidence;
}

function matchesRequiredCoverage(summary, requiredCoverage) {
  if (requiredCoverage === "all") return true;
  return (summary?.state === "ready" || summary?.state === "stale") && summary.requiredCoverage === requiredCoverage;
}

function matchesProviderEvidence(summary, providerEvidence) {
  if (providerEvidence === "all") return true;
  return (summary?.state === "ready" || summary?.state === "stale") && summary.providerEvidence === providerEvidence;
}

function matchesProfile(summary, profile) {
  if (profile === "all") return true;
  return (summary?.state === "ready" || summary?.state === "stale") &&
    summary.policyName?.toLocaleLowerCase() === profile;
}

function matchesPolicyLanguage(summary, language) {
  if (language === "all") return true;
  return (summary?.state === "ready" || summary?.state === "stale") &&
    Array.isArray(summary.languages) &&
    summary.languages.some(({ code }) => code.toLocaleLowerCase() === language);
}

function matchesAnalysisAge(summary, analysisAge, nowEpochMs) {
  if (analysisAge === "all") return true;
  const generatedAt = typeof summary?.generatedAt === "string" ? Date.parse(summary.generatedAt) : Number.NaN;
  if (!Number.isFinite(generatedAt)) return analysisAge === "unknown";
  if (analysisAge === "unknown") return false;
  const ageMs = Math.max(0, nowEpochMs - generatedAt);
  return analysisAge === "recent" ? ageMs <= analysisRecencyWindowMs : ageMs > analysisRecencyWindowMs;
}

function inventorySelectionOptions(options) {
  return {
    query: String(options.query ?? "").trim().toLocaleLowerCase(),
    application: options.application === "sonarr" || options.application === "radarr" ? options.application : "all",
    kind: options.kind === "episode" || options.kind === "movie" ? options.kind : "all",
    analysis: ["not_analyzed", "analyzed", "needs_attention", "stale"].includes(options.analysis) ? options.analysis : "all",
    confidence: [...confidenceValues, "none"].includes(options.confidence) ? options.confidence : "all",
    requiredCoverage: requiredCoverageValues.includes(options.requiredCoverage) ? options.requiredCoverage : "all",
    providerEvidence: providerEvidenceValues.includes(options.providerEvidence) ? options.providerEvidence : "all",
    profile: scopedFilterValue(options.profile, "profile", 256),
    language: scopedFilterValue(options.language, "language", 64),
    analysisAge: analysisAgeValues.includes(options.analysisAge) ? options.analysisAge : "all",
    nowEpochMs: Number.isFinite(options.nowEpochMs) ? options.nowEpochMs : Date.now(),
  };
}

function scopedFilterValue(value, scope, maximumLength) {
  if (typeof value !== "string" || !value.startsWith(`${scope}:`)) return "all";
  const selected = value.slice(scope.length + 1).trim();
  return selected.length > 0 && selected.length <= maximumLength ? selected.toLocaleLowerCase() : "all";
}

function rowSearchText(row) {
  const policy = row.analysis?.policyName ?? "";
  const languages = Array.isArray(row.analysis?.languages)
    ? row.analysis.languages.map(({ code }) => code).join(" ")
    : "";
  const requiredLanguages = Array.isArray(row.analysis?.requiredLanguages)
    ? row.analysis.requiredLanguages.map(({ code, confidence }) => `${code} ${confidence}`).join(" ")
    : "";
  const providerFailures = Array.isArray(row.analysis?.providerFailures) ? row.analysis.providerFailures.join(" ") : "";
  return `${row.title} ${row.context} ${row.application} ${policy} ${languages} ${requiredLanguages} ${providerFailures}`.toLocaleLowerCase();
}

function compareRowAnalysis(left, right) {
  const leftRank = left.analysis === undefined
    ? analysisConfidenceRank.not_analyzed
    : analysisConfidenceRank[left.analysis.bestConfidence] ?? analysisConfidenceRank.none;
  const rightRank = right.analysis === undefined
    ? analysisConfidenceRank.not_analyzed
    : analysisConfidenceRank[right.analysis.bestConfidence] ?? analysisConfidenceRank.none;
  return leftRank - rightRank || compareAnalysisPresence(left, right);
}

function compareAnalysisPresence(left, right) {
  if ((left.analysis === undefined) === (right.analysis === undefined)) return 0;
  return left.analysis === undefined ? 1 : -1;
}

function episodeLabel(season, episode) {
  if (!Number.isSafeInteger(season) || !Number.isSafeInteger(episode)) return "Episode";
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function languagePreferenceKey(value) {
  return value.trim().replaceAll("_", "-").toLocaleLowerCase();
}

const confidenceValues = ["confirmed", "likely", "possible", "no_match_found", "unknown"];
const requiredCoverageValues = ["strong", "possible", "no_match_found", "unknown", "no_accepted_release", "no_required_languages"];
const providerEvidenceValues = ["available", "partial", "unavailable", "unknown"];
const providerFailureStatuses = ["rate_limited", "timeout", "unavailable", "unsupported", "unauthorized", "invalid_response", "unexpected_status"];
const releaseProtocols = ["torrent", "usenet"];
const hearingImpairedValues = ["required", "prefer", "avoid", "either"];
const applicabilityValues = ["always", "audio_matches", "audio_does_not_match"];
const requiredFitValues = ["strong", "possible", "no_match_found", "unknown", "no_required_languages"];
const maximumShortlistSize = 3;
const confidenceRank = { confirmed: 0, likely: 1, possible: 2, no_match_found: 3, unknown: 4 };
const analysisConfidenceRank = { ...confidenceRank, none: 5, not_analyzed: 6 };
const strongConfidenceRank = { confirmed: 0, likely: 1, possible: 2 };
const strongRequiredFitRank = { strong: 0, possible: 1 };
const analysisAgeValues = ["recent", "older", "unknown"];
const analysisRecencyWindowMs = 60 * 60 * 1_000;

function minimumDefined(values) {
  const defined = values.filter(Number.isFinite);
  return defined.length === 0 ? undefined : Math.min(...defined);
}

function maximumDefined(values) {
  const defined = values.filter(Number.isFinite);
  return defined.length === 0 ? undefined : Math.max(...defined);
}
