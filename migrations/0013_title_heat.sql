-- How many of our sources carry a title playably (lib/ingest/publish.ts keeps it current).
-- The sources serve Chinese-speaking viewers and pick up whatever those viewers watch, so this
-- is the catalog's own heat signal for home page sections and charts (lib/data/home.ts),
-- next to Douban's hot lists (lib/ingest/hot-lists.ts).
ALTER TABLE titles ADD COLUMN source_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX ix_titles_heat ON titles (indexable, kind, source_count DESC, popularity DESC);
