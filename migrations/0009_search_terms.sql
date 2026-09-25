-- Submitted searches (the /search page, not type-ahead), per day and term, with how many
-- results the last one returned. Aggregates only: no IP, no user id; rows older than 90 days
-- are deleted by scripts/health.ts. Terms with no results become the catalog's to-do list.
CREATE TABLE search_terms (
  day      TEXT NOT NULL,              -- UTC date, YYYY-MM-DD
  term     TEXT NOT NULL,              -- normalised: NFKC, lower case, single spaces, <= 30 chars
  n        INTEGER NOT NULL DEFAULT 0,
  results  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, term)
);
CREATE INDEX ix_search_terms_misses ON search_terms (results, day);
