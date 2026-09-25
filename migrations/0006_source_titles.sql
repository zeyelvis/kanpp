-- Titles built from the CMS sources' own metadata (Chinese animation and variety shows that
-- TMDB does not list). See lib/ingest/source-titles.ts.

-- Plain-text synopsis and the source's genre list (vod_content, vod_class).
ALTER TABLE source_items ADD COLUMN content TEXT;
ALTER TABLE source_items ADD COLUMN classes TEXT;

-- 'tmdb': built from TMDB; 'source': built from the CMS sources (no tmdb_id).
ALTER TABLE titles ADD COLUMN origin TEXT NOT NULL DEFAULT 'tmdb' CHECK (origin IN ('tmdb', 'source'));

-- Source posters served from our own domain (/img/src/{key}.{ext}). Only URLs registered here
-- are ever fetched: the image route is not an open proxy.
CREATE TABLE source_images (
  key         TEXT PRIMARY KEY,          -- first 20 hex chars of sha1(url)
  url         TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
