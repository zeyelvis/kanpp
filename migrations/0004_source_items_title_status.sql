-- Title-scoped reads (the player's lines, the publish gate) filter on title_id AND match_status.
-- Without it SQLite picked ix_source_items_status and walked every matched row for each title.
CREATE INDEX ix_source_items_title_status ON source_items (title_id, match_status, vod_time DESC);
