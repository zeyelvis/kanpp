-- Episode update history: one row each time a title's latest_label changes (a new episode, a
-- finished season). Written by triggers, so every code path that updates titles (ingest,
-- source titles, the mirror push) records it without knowing about this table.
-- source_time is the source's own update time (titles.source_updated_at) when the label was
-- seen; the title page shows it as the update timeline.
CREATE TABLE title_updates (
  id           INTEGER PRIMARY KEY,
  title_id     INTEGER NOT NULL,
  label        TEXT NOT NULL,
  source_time  TEXT,
  seen_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_title_updates_title ON title_updates (title_id, id DESC);

CREATE TRIGGER title_updates_on_insert AFTER INSERT ON titles
WHEN NEW.latest_label IS NOT NULL AND TRIM(NEW.latest_label) <> ''
BEGIN
  INSERT INTO title_updates (title_id, label, source_time) VALUES (NEW.id, NEW.latest_label, NEW.source_updated_at);
END;

CREATE TRIGGER title_updates_on_change AFTER UPDATE OF latest_label ON titles
WHEN NEW.latest_label IS NOT NULL AND TRIM(NEW.latest_label) <> '' AND NEW.latest_label IS NOT OLD.latest_label
BEGIN
  INSERT INTO title_updates (title_id, label, source_time) VALUES (NEW.id, NEW.latest_label, NEW.source_updated_at);
END;

-- Baseline: the label every published title shows today.
INSERT INTO title_updates (title_id, label, source_time)
SELECT id, latest_label, source_updated_at FROM titles
WHERE indexable = 1 AND latest_label IS NOT NULL AND TRIM(latest_label) <> '';
