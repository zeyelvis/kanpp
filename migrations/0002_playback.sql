-- Playback outcomes per day x viewer country x line, reported by the player (navigator.sendBeacon).
-- Aggregates only: no IP, no user id. Used to put the line that works best in the viewer's
-- country first.
CREATE TABLE playback_daily (
  day          TEXT NOT NULL,              -- UTC date, YYYY-MM-DD
  country      TEXT NOT NULL,              -- cf-ipcountry (ISO 3166-1 alpha-2, XX unknown, T1 Tor)
  source_id    TEXT NOT NULL,
  ok           INTEGER NOT NULL DEFAULT 0, -- loads that reached the first frame
  fail         INTEGER NOT NULL DEFAULT 0, -- loads that ended in a fatal error (line failover)
  ttff_ms_sum  INTEGER NOT NULL DEFAULT 0, -- sum of time to first frame over `ok`
  PRIMARY KEY (day, country, source_id)
);
