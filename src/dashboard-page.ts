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
      <p class="lede">See monitored episodes and movies waiting for a file. Filtering and sorting happen here, without making new requests to Sonarr or Radarr.</p>
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
          <h2 id="inventory-title"><span id="visible-count">0</span> items</h2>
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
        <label for="sort-order">
          <span>Sort</span>
          <select id="sort-order">
            <option value="available-desc">Newest availability</option>
            <option value="available-asc">Oldest availability</option>
            <option value="title-asc">Title A–Z</option>
            <option value="kind-asc">Type</option>
          </select>
        </label>
      </div>

      <div id="empty-state" class="empty-state" hidden>
        <h3>No matching missing items</h3>
        <p>Try a different search or type filter.</p>
      </div>
      <ol id="inventory-list" class="inventory-list" aria-label="Missing items"></ol>
    </section>
  </main>

  <footer>
    <span>Pegarr keeps video decisions in Sonarr and Radarr.</span>
    <span>No Grab actions are available in this phase.</span>
  </footer>
  <script type="module" src="/assets/dashboard.js"></script>
</body>
</html>`;
