-- Web push for new episodes of followed titles (opt-in, no accounts). One row per browser
-- push subscription: the push service endpoint, its encryption keys, and the ids of the titles
-- the viewer follows on that device. Deleted when the viewer turns reminders off or the push
-- service reports the subscription gone (scripts/push-updates.ts).
CREATE TABLE push_subscriptions (
  endpoint      TEXT PRIMARY KEY,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  follows       TEXT NOT NULL DEFAULT '[]',   -- JSON array of title ids
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_sent_at  TEXT
);
