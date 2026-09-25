-- People (cast and crew), derived from titles.cast_json / crew_json by lib/ingest/people.ts.
-- One row per TMDB person; `credits` lists their credited indexable titles, so a row is
-- recomputed in place and never needs child rows deleted. Slugs are permanent once assigned.
CREATE TABLE people (
  id            INTEGER PRIMARY KEY,               -- TMDB person id
  name          TEXT NOT NULL,
  profile_path  TEXT,
  credits       TEXT NOT NULL DEFAULT '[]',        -- JSON [{t: title id, r: role, c: character}]
  title_count   INTEGER NOT NULL DEFAULT 0,        -- distinct indexable titles
  slug          TEXT,
  indexable     INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX ux_people_slug ON people (slug) WHERE slug IS NOT NULL;
CREATE INDEX ix_people_indexable ON people (indexable, title_count DESC);

CREATE TRIGGER people_slug_permanent BEFORE UPDATE OF slug ON people
WHEN OLD.slug IS NOT NULL AND NEW.slug IS NOT OLD.slug
BEGIN
  SELECT RAISE(ABORT, 'person slugs are permanent');
END;
