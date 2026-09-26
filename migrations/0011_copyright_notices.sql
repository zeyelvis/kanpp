-- Copyright notices (dmca@kanpp.tv) and what was done about them: the record behind the
-- 24-hour handling target (scripts/takedown.ts writes it, scripts/health.ts reports overdue
-- ones). Titles themselves are only ever status-changed, never deleted.
CREATE TABLE copyright_notices (
  id            INTEGER PRIMARY KEY,
  received_at   TEXT NOT NULL,                 -- when the notice arrived (UTC, from the email)
  sender        TEXT NOT NULL,                 -- who sent it (company / agent)
  works         TEXT,                          -- the works named in the notice
  urls          TEXT NOT NULL DEFAULT '[]',    -- JSON array of our URLs it lists
  title_ids     TEXT NOT NULL DEFAULT '[]',    -- JSON array of titles actioned
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'actioned', 'rejected', 'restored')),
  handled_at    TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_copyright_notices_status ON copyright_notices (status, received_at);
