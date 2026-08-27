export const dashboardPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Pegarr — Missing releases</title>
  <link rel="stylesheet" href="/assets/dashboard.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to missing items</a>
  <header class="topbar">
    <a class="brand" href="/" aria-label="Pegarr home">
      <span class="brand-mark" aria-hidden="true">P</span>
      <span><strong>Pegarr</strong><small>Subtitle-aware release selection</small></span>
    </a>
    <span class="phase-badge">Read-only MVP</span>
  </header>

  <main id="main" class="shell">
    <section class="hero" aria-labelledby="page-title">
      <p class="eyebrow">Your missing library</p>
      <h1 id="page-title">Choose what to investigate next.</h1>
      <p class="lede">See monitored episodes and movies waiting for a file. Analyze an item once, then use its confidence and freshness here without making new requests.</p>
    </section>

    <section id="access-panel" class="access-panel" aria-labelledby="access-title">
      <div>
        <p class="eyebrow">Private access</p>
        <h2 id="access-title">Connect to your library</h2>
        <p>Enter the Pegarr access token configured on this server. It stays only in this page's memory and clears when you reload or close it.</p>
      </div>
      <form id="access-form" class="access-form">
        <label for="access-token">Access token</label>
        <div class="token-row">
          <input id="access-token" name="access-token" type="password" minlength="32" required autocomplete="off" spellcheck="false">
          <button id="connect-button" class="primary-button" type="submit">Connect</button>
        </div>
      </form>
    </section>

    <p id="status-message" class="status-message" role="status" aria-live="polite"></p>

    <section id="dashboard" class="dashboard" aria-labelledby="inventory-title" hidden>
      <div class="summary-row">
        <div>
          <p class="eyebrow">Monitored and missing</p>
          <h2 id="inventory-title"><span id="visible-count">0</span> <span id="visible-label">items</span></h2>
        </div>
        <div id="source-status" class="source-status" aria-label="Integration status"></div>
        <button id="refresh-button" class="secondary-button" type="button">Refresh inventory</button>
      </div>

      <div class="controls" aria-label="Inventory controls">
        <label class="search-control" for="search-input">
          <span>Search</span>
          <input id="search-input" type="search" placeholder="Title, series, or application" autocomplete="off">
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
        <label for="release-sort-order">
          <span>Sort</span>
          <select id="release-sort-order">
            <option value="recommended">Arr decision, then confidence</option>
            <option value="confidence-desc">Subtitle confidence</option>
            <option value="custom-format-desc">Custom format score</option>
            <option value="title-asc">Release title A–Z</option>
          </select>
        </label>
        <p id="release-visible-count" class="release-visible-count"></p>
      </div>
      <div id="feasibility-notice" class="feasibility-notice" role="status" aria-live="polite"></div>
      <div id="release-table-wrap" class="release-table-wrap" hidden>
        <table class="release-table">
          <caption>Interactive release candidates enriched with subtitle evidence</caption>
          <thead><tr><th scope="col">Video release</th><th scope="col">Arr decision</th><th scope="col">Subtitle confidence</th><th scope="col">Evidence</th></tr></thead>
          <tbody id="release-table-body"></tbody>
        </table>
      </div>
    </section>
  </main>

  <footer>
    <span>Pegarr keeps video decisions in Sonarr and Radarr.</span>
    <span>No Grab actions are available in this phase.</span>
  </footer>
  <script type="module" src="/assets/dashboard.js"></script>
</body>
</html>`;
