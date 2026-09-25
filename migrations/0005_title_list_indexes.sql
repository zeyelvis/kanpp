-- Home and schedule rails filtered on columns no index covered (each was a scan of every
-- indexable title): recently updated (hero), next episode date (追剧日历), top rated.
-- Composite with `indexable` first: without table statistics SQLite otherwise prefers any
-- index on `indexable` alone.
CREATE INDEX ix_titles_recent ON titles (indexable, source_updated_at);
CREATE INDEX ix_titles_next_episode ON titles (indexable, next_episode_date);
CREATE INDEX ix_titles_rated ON titles (indexable, vote_average);
