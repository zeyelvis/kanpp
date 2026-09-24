-- 看片片 entity registry. D1 is the single source of truth.
--
-- Invariants (enforced here, not in prose):
--   * titles.id is AUTOINCREMENT: an id is never reused, even after a row is removed.
--   * a slug, once written, always points at the same title (slugs are never updated
--     or deleted; a title gets a new canonical slug by inserting a row).
--   * one TMDB entity and one external id (douban/imdb) map to at most one title.
--   * taking a title down is a status change, never a DELETE.

CREATE TABLE titles (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                  TEXT NOT NULL CHECK (kind IN ('movie', 'tv', 'anime', 'variety', 'doc')),
  name                  TEXT NOT NULL,            -- simplified-Chinese display name
  original_name         TEXT,
  year                  INTEGER,
  tmdb_type             TEXT CHECK (tmdb_type IN ('movie', 'tv')),
  tmdb_id               INTEGER,
  imdb_id               TEXT,
  overview              TEXT,
  tagline               TEXT,
  poster_path           TEXT,                     -- TMDB path, e.g. /abc.jpg
  backdrop_path         TEXT,
  genres                TEXT NOT NULL DEFAULT '[]',   -- JSON string[] (zh)
  countries             TEXT NOT NULL DEFAULT '[]',   -- JSON string[] (ISO 3166-1)
  languages             TEXT NOT NULL DEFAULT '[]',   -- JSON string[] (ISO 639-1)
  runtime               INTEGER,                  -- minutes
  release_date          TEXT,                     -- release_date / first_air_date
  last_air_date         TEXT,
  tv_status             TEXT,                     -- TMDB status for series
  number_of_seasons     INTEGER,
  number_of_episodes    INTEGER,
  next_episode_date     TEXT,
  next_episode_season   INTEGER,
  next_episode_number   INTEGER,
  vote_average          REAL,
  vote_count            INTEGER,
  popularity            REAL,
  cast_json             TEXT NOT NULL DEFAULT '[]',   -- JSON [{id,name,character,profile}]
  crew_json             TEXT NOT NULL DEFAULT '[]',   -- JSON [{id,name,job}]
  latest_label          TEXT,                     -- freshest source remark, e.g. 更新至第12集
  source_updated_at     TEXT,                     -- newest vod_time among linked sources
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'hidden', 'merged', 'removed')),
  status_reason         TEXT,
  merged_into           INTEGER REFERENCES titles(id),
  indexable             INTEGER NOT NULL DEFAULT 0,
  content_hash          TEXT,
  tmdb_synced_at        TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  published_at          TEXT,
  CHECK (status <> 'merged' OR merged_into IS NOT NULL)
);

CREATE UNIQUE INDEX ux_titles_tmdb ON titles (tmdb_type, tmdb_id) WHERE tmdb_id IS NOT NULL;
CREATE INDEX ix_titles_feed ON titles (indexable, kind, source_updated_at DESC);
CREATE INDEX ix_titles_popular ON titles (indexable, kind, popularity DESC);

-- External identities. Douban gives each TV season its own subject, so a douban id may
-- resolve to a (title, season) pair.
CREATE TABLE external_ids (
  provider       TEXT NOT NULL CHECK (provider IN ('douban', 'imdb')),
  external_id    TEXT NOT NULL,
  title_id       INTEGER NOT NULL REFERENCES titles(id),
  season_number  INTEGER,
  PRIMARY KEY (provider, external_id)
);
CREATE INDEX ix_external_ids_title ON external_ids (title_id);

-- Every URL a title has ever had. Resolution is slug -> title, never "parse an id out of
-- the URL", so a slug can never start pointing at a different film.
CREATE TABLE slugs (
  slug          TEXT PRIMARY KEY,
  title_id      INTEGER NOT NULL REFERENCES titles(id),
  is_canonical  INTEGER NOT NULL DEFAULT 0 CHECK (is_canonical IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX ux_slugs_canonical ON slugs (title_id) WHERE is_canonical = 1;

CREATE TRIGGER slugs_no_retarget BEFORE UPDATE OF title_id, slug ON slugs
BEGIN
  SELECT RAISE(ABORT, 'slugs are permanent: insert a new slug instead of editing one');
END;

CREATE TRIGGER slugs_no_delete BEFORE DELETE ON slugs
BEGIN
  SELECT RAISE(ABORT, 'slugs are permanent and cannot be deleted');
END;

CREATE TRIGGER titles_no_delete BEFORE DELETE ON titles
BEGIN
  SELECT RAISE(ABORT, 'titles are never deleted: set status instead');
END;

-- Names used to match source items and to answer searches (简/繁/原名/译名).
CREATE TABLE aliases (
  title_id  INTEGER NOT NULL REFERENCES titles(id),
  norm      TEXT NOT NULL,     -- normalized matching key (see lib/domain/normalize.ts)
  alias     TEXT NOT NULL,     -- display form
  lang      TEXT,              -- zh-Hans | zh-Hant | original | en | source
  PRIMARY KEY (title_id, norm)
);
CREATE INDEX ix_aliases_norm ON aliases (norm);

CREATE TABLE seasons (
  title_id       INTEGER NOT NULL REFERENCES titles(id),
  season_number  INTEGER NOT NULL,
  name           TEXT,
  overview       TEXT,
  air_date       TEXT,
  episode_count  INTEGER,
  poster_path    TEXT,
  PRIMARY KEY (title_id, season_number)
);

-- Raw catalog rows from CMS sources (苹果CMS). Matching attaches them to a title/season.
CREATE TABLE source_items (
  source_id      TEXT NOT NULL,
  vod_id         TEXT NOT NULL,
  vod_name       TEXT NOT NULL,
  vod_sub        TEXT,
  vod_year       INTEGER,
  type_name      TEXT,
  area           TEXT,
  lang           TEXT,
  douban_id      TEXT,
  remarks        TEXT,
  vod_time       TEXT,
  pic            TEXT,
  actor          TEXT,
  director       TEXT,
  play_from      TEXT,
  play_url       TEXT,
  episode_count  INTEGER,
  title_id       INTEGER REFERENCES titles(id),
  season_number  INTEGER,
  match_status   TEXT NOT NULL DEFAULT 'pending'
                 CHECK (match_status IN ('pending', 'matched', 'review', 'unmatched', 'rejected')),
  match_score    REAL,
  match_note     TEXT,
  first_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_id, vod_id)
);
CREATE INDEX ix_source_items_title ON source_items (title_id, season_number);
CREATE INDEX ix_source_items_status ON source_items (match_status, vod_time DESC);
CREATE INDEX ix_source_items_douban ON source_items (douban_id) WHERE douban_id IS NOT NULL;

CREATE TABLE sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
