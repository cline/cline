CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace TEXT NOT NULL,
  item_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  client_id_hash TEXT NOT NULL,
  ai_hydro_version TEXT,
  item_type TEXT,
  item_version TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_events_marketplace_item
  ON events (marketplace, item_id);

CREATE INDEX IF NOT EXISTS idx_events_created_at
  ON events (created_at);

CREATE TABLE IF NOT EXISTS item_counts (
  marketplace TEXT NOT NULL,
  item_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (marketplace, item_id, event_type)
);

CREATE TABLE IF NOT EXISTS item_stars (
  marketplace TEXT NOT NULL,
  item_id TEXT NOT NULL,
  client_id_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (marketplace, item_id, client_id_hash)
);

CREATE INDEX IF NOT EXISTS idx_item_stars_marketplace_item
  ON item_stars (marketplace, item_id);
