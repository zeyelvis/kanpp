-- Search by a word inside a Chinese name ("三十岁" -> 东京三十岁左右, lib/data/titles.ts
-- searchTitles): a scan of this narrow index instead of the titles table, whose rows carry the
-- cast and overview. The scan took seconds on D1.
CREATE INDEX ix_titles_name_search ON titles (name, popularity) WHERE indexable = 1;

-- Unmatched rows of one source category in rowid order (lib/ingest/source-titles-job.ts).
-- Paging every eligible category at once re-read all ~150k unmatched rows per page.
CREATE INDEX ix_source_items_unmatched_type ON source_items (type_name) WHERE match_status = 'unmatched';
