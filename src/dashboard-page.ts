export const dashboardPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Pegarr — Discover subtitle-ready media</title>
  <link rel="stylesheet" href="/assets/dashboard.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to discovery</a>
  <header class="topbar">
    <a class="brand" href="/" aria-label="Pegarr home">
      <span class="brand-mark" aria-hidden="true">P</span>
      <span><strong>Pegarr</strong><small>Subtitle-aware release selection</small></span>
    </a>
    <div class="topbar-actions">
      <span class="phase-badge">Discovery-first P0</span>
      <button id="session-logout" class="quiet-button" type="button" hidden>Sign out</button>
    </div>
  </header>

  <main id="main" class="shell">
    <section class="hero" aria-labelledby="page-title">
      <p class="eyebrow">Discover before you add</p>
      <h1 id="page-title">Find the version with your subtitles.</h1>
      <p class="lede">Search the Sonarr and Radarr catalogs for a new series or movie. Pegarr is building the complete path from subtitle coverage preview to explicit add and exact release selection.</p>
    </section>

    <section id="access-panel" class="access-panel" aria-labelledby="access-title">
      <div>
        <p class="eyebrow">Private access</p>
        <h2 id="access-title">Sign in to Pegarr</h2>
        <p>Use the Pegarr username and password configured on this server. Pegarr exchanges them for a private, expiring server session and clears the password immediately.</p>
      </div>
      <form id="access-form" class="access-form">
        <label for="login-username">Username</label>
        <input id="login-username" name="username" type="text" maxlength="64" autocomplete="username" spellcheck="false">
        <label for="login-password">Password</label>
        <div class="token-row">
          <input id="login-password" name="password" type="password" minlength="32" autocomplete="current-password" spellcheck="false">
          <button id="connect-button" class="primary-button" type="submit">Sign in</button>
        </div>
        <details class="legacy-access">
          <summary>Use a legacy access token</summary>
          <label for="access-token">Access token</label>
          <input id="access-token" name="access-token" type="password" minlength="32" autocomplete="off" spellcheck="false">
        </details>
      </form>
    </section>

    <p id="status-message" class="status-message" role="status" aria-live="polite"></p>

    <section id="onboarding" class="onboarding-panel" aria-labelledby="onboarding-title" hidden>
      <div class="onboarding-heading">
        <div>
          <p class="eyebrow">First-run guide</p>
          <h2 id="onboarding-title">Your Pegarr path</h2>
        </div>
        <span id="onboarding-state" class="source-chip">Checking setup</span>
      </div>
      <p id="onboarding-summary" class="catalog-explainer">Pegarr is checking the server-owned configuration needed for discovery and subtitle preview.</p>
      <ol id="onboarding-steps" class="onboarding-steps" aria-label="Pegarr setup steps"></ol>
      <p id="onboarding-access" class="onboarding-access"></p>
    </section>

    <section id="subtitle-settings" class="settings-panel" aria-labelledby="subtitle-settings-title" hidden>
      <div>
        <p class="eyebrow">Subtitle policy</p>
        <h2 id="subtitle-settings-title">What subtitles do you want?</h2>
        <p class="catalog-explainer">Set the default languages Pegarr should verify before a title is added, then connect SubDL or OpenSubtitles below. Provider credentials are written to private server-side files and are never returned here.</p>
      </div>
      <form id="subtitle-settings-form" class="settings-form">
        <label for="subtitle-languages"><span>Language codes</span></label>
        <input id="subtitle-languages" type="text" maxlength="256" placeholder="pt-BR, en" autocomplete="off" spellcheck="false">
        <button id="subtitle-settings-save" class="secondary-button" type="submit">Save policy</button>
      </form>
      <p class="settings-hint">Comma-separated BCP 47 language codes. Each language is required by default; advanced forced and hearing-impaired preferences remain preserved by the API.</p>
      <div id="provider-configuration" class="provider-configuration" aria-label="Subtitle provider configuration"></div>
      <p id="subtitle-settings-status" class="status-message" role="status" aria-live="polite"></p>
    </section>

    <section id="catalog" class="catalog-panel" aria-labelledby="catalog-title" hidden>
      <div>
        <p class="eyebrow">Sonarr and Radarr catalog</p>
        <h2 id="catalog-title">Search for something new</h2>
        <p class="catalog-explainer">Search safely, preview title-level subtitle evidence, then explicitly add with automatic search disabled when catalog add is enabled. Pegarr never downloads a release from this action.</p>
      </div>
      <form id="catalog-form" class="catalog-form">
        <label for="catalog-query"><span>Series or movie</span></label>
        <input id="catalog-query" type="search" minlength="2" maxlength="200" required placeholder="For example: Severance" autocomplete="off">
        <label for="catalog-application"><span>Catalog</span></label>
        <select id="catalog-application">
          <option value="all">Sonarr and Radarr</option>
          <option value="sonarr">Series in Sonarr</option>
          <option value="radarr">Movies in Radarr</option>
        </select>
        <button id="catalog-submit" class="primary-button" type="submit">Search</button>
      </form>
      <p id="catalog-status" class="status-message" role="status" aria-live="polite"></p>
      <ol id="catalog-results" class="catalog-results" aria-label="Catalog results"></ol>
    </section>

    <section id="dashboard" class="dashboard" aria-labelledby="inventory-title" hidden>
      <div class="summary-row">
        <div>
          <p class="eyebrow">Monitored and missing</p>
          <h2 id="inventory-title"><span id="visible-count">0</span> <span id="visible-label">items</span></h2>
        </div>
        <div id="source-status" class="source-status" aria-label="Integration status"></div>
        <div class="summary-actions">
          <button id="grab-history-open" class="secondary-button" type="button">Grab history</button>
          <button id="refresh-button" class="secondary-button" type="button">Refresh inventory</button>
        </div>
      </div>

      <div class="controls" aria-label="Inventory controls">
        <label class="search-control" for="search-input">
          <span>Search</span>
          <input id="search-input" type="search" placeholder="Title, series, or application" autocomplete="off">
        </label>
        <label for="application-filter">
          <span>Application</span>
          <select id="application-filter">
            <option value="all">Sonarr and Radarr</option>
            <option value="sonarr">Sonarr</option>
            <option value="radarr">Radarr</option>
          </select>
        </label>
        <label for="kind-filter">
          <span>Type</span>
          <select id="kind-filter">
            <option value="all">All items</option>
            <option value="episode">Episodes</option>
            <option value="movie">Movies</option>
          </select>
        </label>
        <label for="analysis-filter">
          <span>Analysis</span>
          <select id="analysis-filter">
            <option value="all">All analysis states</option>
            <option value="not_analyzed">Not analyzed</option>
            <option value="analyzed">Analyzed or attempted</option>
            <option value="needs_attention">Needs attention</option>
            <option value="stale">Stale</option>
          </select>
        </label>
        <label for="best-confidence-filter">
          <span>Best accepted subtitle</span>
          <select id="best-confidence-filter">
            <option value="all">All confidence levels</option>
            <option value="confirmed">Confirmed</option>
            <option value="likely">Likely</option>
            <option value="possible">Possible</option>
            <option value="no_match_found">No match found</option>
            <option value="unknown">Unknown</option>
            <option value="none">No accepted release</option>
          </select>
        </label>
        <label for="required-coverage-filter">
          <span>Required languages</span>
          <select id="required-coverage-filter">
            <option value="all">All coverage states</option>
            <option value="strong">Strong coverage</option>
            <option value="possible">Possible coverage</option>
            <option value="no_match_found">No match found</option>
            <option value="unknown">Unknown</option>
            <option value="no_accepted_release">No accepted release</option>
            <option value="no_required_languages">No required languages</option>
          </select>
        </label>
        <label for="provider-evidence-filter">
          <span>Provider evidence</span>
          <select id="provider-evidence-filter">
            <option value="all">All provider states</option>
            <option value="available">Available</option>
            <option value="partial">Partial</option>
            <option value="unavailable">Unavailable</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label for="profile-filter">
          <span>Bazarr profile</span>
          <select id="profile-filter">
            <option value="all">All analyzed profiles</option>
          </select>
        </label>
        <label for="policy-language-filter">
          <span>Policy language</span>
          <select id="policy-language-filter">
            <option value="all">All analyzed languages</option>
          </select>
        </label>
        <label for="analysis-age-filter">
          <span>Analysis age</span>
          <select id="analysis-age-filter">
            <option value="all">Any analysis age</option>
            <option value="recent">Analyzed in the last hour</option>
            <option value="older">Older than one hour</option>
            <option value="unknown">No analysis timestamp</option>
          </select>
        </label>
        <label for="sort-order">
          <span>Sort</span>
          <select id="sort-order">
            <option value="available-desc">Newest availability</option>
            <option value="available-asc">Oldest availability</option>
            <option value="title-asc">Title A–Z</option>
            <option value="kind-asc">Type</option>
            <option value="confidence-desc">Best subtitle confidence</option>
            <option value="analyzed-desc">Recently analyzed</option>
          </select>
        </label>
        <div class="inventory-filter-state">
          <span id="active-filter-count" role="status" aria-live="polite">0 filters active</span>
          <button id="clear-inventory-filters" class="quiet-button" type="button" disabled>Clear filters</button>
        </div>
      </div>

      <div id="empty-state" class="empty-state" hidden>
        <h3>No matching missing items</h3>
        <p>Try a different search or analysis filter.</p>
      </div>
      <ol id="inventory-list" class="inventory-list" aria-label="Missing items"></ol>
    </section>

    <section id="feasibility-panel" class="feasibility-panel" aria-labelledby="feasibility-title" hidden>
      <div class="feasibility-heading">
        <div>
          <p class="eyebrow">Read-only release analysis</p>
          <h2 id="feasibility-title" tabindex="-1">Selected item</h2>
          <p id="feasibility-context" class="feasibility-context"></p>
        </div>
        <div class="feasibility-actions">
          <button id="feasibility-refresh" class="secondary-button" type="button">Refresh analysis</button>
          <button id="feasibility-close" class="quiet-button" type="button">Close</button>
        </div>
      </div>
      <div id="feasibility-summary" class="feasibility-summary"></div>
      <div id="release-controls" class="release-controls" aria-label="Release controls" hidden>
        <label class="release-search-control" for="release-search-input">
          <span>Search releases</span>
          <input id="release-search-input" type="search" placeholder="Title, indexer, group, or format" autocomplete="off">
        </label>
        <label for="release-decision-filter">
          <span>Arr decision</span>
          <select id="release-decision-filter">
            <option value="all">All decisions</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label for="release-confidence-filter">
          <span>Subtitle confidence</span>
          <select id="release-confidence-filter">
            <option value="all">All confidence levels</option>
            <option value="confirmed">Confirmed</option>
            <option value="likely">Likely</option>
            <option value="possible">Possible</option>
            <option value="no_match_found">No match found</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label for="release-protocol-filter">
          <span>Protocol</span>
          <select id="release-protocol-filter">
            <option value="all">All protocols</option>
            <option value="torrent">Torrent</option>
            <option value="usenet">Usenet</option>
          </select>
        </label>
        <label for="release-required-fit-filter">
          <span>Required-language fit</span>
          <select id="release-required-fit-filter">
            <option value="all">All required-language fits</option>
            <option value="strong">Strong fit</option>
            <option value="possible">Possible fit</option>
            <option value="no_match_found">No match found</option>
            <option value="unknown">Unknown</option>
            <option value="no_required_languages">No required languages</option>
          </select>
        </label>
        <label for="release-language-filter">
          <span>Policy language</span>
          <select id="release-language-filter">
            <option value="all">All policy languages</option>
          </select>
        </label>
        <label for="release-language-confidence-filter">
          <span>Language confidence</span>
          <select id="release-language-confidence-filter">
            <option value="all">All language confidence</option>
            <option value="confirmed">Confirmed</option>
            <option value="likely">Likely</option>
            <option value="possible">Possible</option>
            <option value="no_match_found">No match found</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label for="release-sort-order">
          <span>Sort</span>
          <select id="release-sort-order">
            <option value="recommended">Arr decision, then confidence</option>
            <option value="confidence-desc">Subtitle confidence</option>
            <option value="custom-format-desc">Custom format score</option>
            <option value="seeders-desc">Most seeders</option>
            <option value="size-asc">Smallest size</option>
            <option value="size-desc">Largest size</option>
            <option value="age-asc">Newest release age</option>
            <option value="title-asc">Release title A–Z</option>
          </select>
        </label>
        <p id="release-visible-count" class="release-visible-count"></p>
      </div>
      <section id="release-leading" class="release-leading" aria-labelledby="release-leading-heading" hidden>
        <div>
          <p class="eyebrow">Decision support only</p>
          <strong id="release-leading-heading">Leading Arr-accepted candidate</strong>
          <span>Recommended ordering keeps Arr acceptance first. Pegarr never Grabs automatically.</span>
        </div>
        <div class="release-leading-result">
          <strong id="release-leading-title"></strong>
          <span id="release-leading-detail"></span>
        </div>
      </section>
      <section id="release-shortlist" class="release-shortlist" aria-labelledby="release-shortlist-title" hidden>
        <div>
          <strong id="release-shortlist-title">Compare shortlisted releases</strong>
          <span id="release-shortlist-count" aria-live="polite">0 of 3 selected</span>
        </div>
        <button id="release-shortlist-clear" class="quiet-button" type="button" hidden>Clear shortlist</button>
        <div id="release-shortlist-items" class="release-shortlist-items"></div>
      </section>
      <div id="feasibility-notice" class="feasibility-notice" role="status" aria-live="polite"></div>
      <div id="release-table-wrap" class="release-table-wrap" hidden>
        <table class="release-table">
          <caption>Interactive release candidates enriched with subtitle evidence</caption>
          <thead><tr><th scope="col">Video release</th><th scope="col">Arr decision</th><th scope="col">Subtitle confidence</th><th scope="col">Evidence</th><th scope="col">Shortlist</th><th scope="col">Controlled Grab</th></tr></thead>
          <tbody id="release-table-body"></tbody>
        </table>
      </div>
    </section>
  </main>

  <dialog id="grab-dialog" class="grab-dialog" aria-labelledby="grab-dialog-title">
    <form id="grab-form" method="dialog" class="grab-dialog-card">
      <div class="grab-dialog-heading">
        <div>
          <p class="eyebrow">Administrator action</p>
          <h2 id="grab-dialog-title">Revalidate before Grab</h2>
        </div>
        <button id="grab-close" class="quiet-button" type="button">Cancel</button>
      </div>
      <p class="grab-warning">This asks Sonarr or Radarr to Grab one release. Pegarr will revalidate it twice, preserve Arr rejection decisions, and audit the outcome.</p>
      <dl class="grab-selection">
        <div><dt>Target</dt><dd id="grab-target"></dd></div>
        <div><dt>Release</dt><dd id="grab-release"></dd></div>
      </dl>
      <section id="grab-auth-step" class="grab-step">
        <label for="grab-admin-token"><span>Administrator token</span>
          <input id="grab-admin-token" type="password" minlength="32" required autocomplete="off" spellcheck="false">
        </label>
        <p>The token stays only in this dialog's page memory and is cleared when the dialog closes.</p>
        <button id="grab-prepare" class="primary-button" type="button">Revalidate release</button>
      </section>
      <section id="grab-confirm-step" class="grab-step" hidden>
        <p>Type this exact phrase to authorize the action:</p>
        <code id="grab-confirmation-phrase" class="grab-confirmation-phrase"></code>
        <label for="grab-confirmation"><span>Exact confirmation</span>
          <input id="grab-confirmation" type="text" autocomplete="off" spellcheck="false">
        </label>
        <button id="grab-execute" class="danger-button" type="button" disabled>Confirm Grab</button>
      </section>
      <p id="grab-status" class="grab-status" role="status" aria-live="polite"></p>
    </form>
  </dialog>

  <dialog id="grab-history-dialog" class="grab-dialog history-dialog" aria-labelledby="grab-history-title">
    <form id="grab-history-form" method="dialog" class="grab-dialog-card">
      <div class="grab-dialog-heading">
        <div>
          <p class="eyebrow">Administrator audit</p>
          <h2 id="grab-history-title">Controlled Grab history</h2>
        </div>
        <button id="grab-history-close" class="quiet-button" type="button">Close</button>
      </div>
      <p class="grab-warning">Unknown outcomes must be checked in Sonarr or Radarr before reconciliation. Pegarr preserves the original Unknown result and records your separate attestation.</p>
      <section id="grab-history-auth" class="grab-step">
        <label for="grab-history-token"><span>Administrator token</span>
          <input id="grab-history-token" type="password" minlength="32" required autocomplete="off" spellcheck="false">
        </label>
        <p>The token stays only in this dialog's page memory and is cleared when the dialog closes.</p>
        <button id="grab-history-load" class="primary-button" type="button">Load audit history</button>
      </section>
      <section id="grab-history-results" class="grab-history-results" aria-labelledby="grab-history-results-title" hidden>
        <div class="history-results-heading">
          <h3 id="grab-history-results-title">Recent outcomes</h3>
          <button id="grab-history-refresh" class="quiet-button" type="button">Refresh</button>
        </div>
        <div id="grab-history-list" class="grab-history-list"></div>
      </section>
      <section id="grab-reconcile-step" class="grab-step grab-reconcile-step" hidden>
        <div>
          <p class="eyebrow">Explicit attestation</p>
          <h3>Reconcile Unknown outcome</h3>
        </div>
        <p>First verify the exact release in Arr activity and the download client. Then choose what actually happened.</p>
        <dl class="grab-selection">
          <div><dt>Target</dt><dd id="grab-reconcile-target"></dd></div>
          <div><dt>Release</dt><dd id="grab-reconcile-release"></dd></div>
        </dl>
        <label for="grab-reconcile-outcome"><span>Verified outcome</span>
          <select id="grab-reconcile-outcome">
            <option value="">Choose after checking Arr</option>
            <option value="grabbed">Arr grabbed this release</option>
            <option value="not_grabbed">Arr did not grab this release</option>
          </select>
        </label>
        <p>Type this exact phrase to record the attestation:</p>
        <code id="grab-reconcile-phrase" class="grab-confirmation-phrase"></code>
        <label for="grab-reconcile-confirmation"><span>Exact confirmation</span>
          <input id="grab-reconcile-confirmation" type="text" autocomplete="off" spellcheck="false">
        </label>
        <div class="reconcile-actions">
          <button id="grab-reconcile-cancel" class="quiet-button" type="button">Cancel reconciliation</button>
          <button id="grab-reconcile-submit" class="danger-button" type="button" disabled>Record attestation</button>
        </div>
      </section>
      <p id="grab-history-status" class="grab-status" role="status" aria-live="polite"></p>
    </form>
  </dialog>

  <footer>
    <span>Pegarr keeps video decisions in Sonarr and Radarr.</span>
    <span>Controlled Grab is opt-in, administrator-only, confirmed, and audited.</span>
  </footer>
  <script type="module" src="/assets/dashboard.js"></script>
</body>
</html>`;
