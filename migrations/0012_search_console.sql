-- Google Search Console data for kanpp.tv, pulled daily on this Mac (scripts/gsc-sync.ts; the
-- service-account key stays in .env.gsc.json and never reaches Cloudflare).

-- Search performance per day and page. Complete totals: Search Console drops anonymised
-- queries only when "query" is one of the dimensions.
CREATE TABLE gsc_page_daily (
  date        TEXT NOT NULL,                  -- YYYY-MM-DD, Search Console's day (Pacific time)
  page        TEXT NOT NULL,                  -- decoded path, e.g. /tv/繁花-2023
  clicks      INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  position    REAL NOT NULL,                  -- average position
  PRIMARY KEY (date, page)
);

-- The same by query (what people searched to see the page).
CREATE TABLE gsc_query_daily (
  date        TEXT NOT NULL,
  page        TEXT NOT NULL,
  query       TEXT NOT NULL,
  clicks      INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  position    REAL NOT NULL,
  PRIMARY KEY (date, page, query)
);
CREATE INDEX ix_gsc_query_daily_query ON gsc_query_daily (query, date);

-- URL Inspection results for a rotating sample of sitemap URLs: how much of each page type
-- Google has indexed, how recently it crawled, and whether it kept our canonical.
CREATE TABLE gsc_inspections (
  path             TEXT PRIMARY KEY,          -- decoded path
  page_type        TEXT NOT NULL,             -- hub, topic, title, person
  checked_at       TEXT NOT NULL,             -- UTC ISO time of the inspection
  verdict          TEXT,                      -- PASS, NEUTRAL, FAIL, VERDICT_UNSPECIFIED
  coverage         TEXT,                      -- coverageState, in English (e.g. "Submitted and indexed")
  last_crawl       TEXT,                      -- UTC ISO time of Google's last crawl, if any
  fetch_state      TEXT,                      -- pageFetchState, e.g. SUCCESSFUL
  google_canonical TEXT                       -- Google's canonical when it differs from ours
);
CREATE INDEX ix_gsc_inspections_type ON gsc_inspections (page_type, checked_at);
