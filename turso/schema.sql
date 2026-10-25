CREATE TABLE IF NOT EXISTS readings (
  entity_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (entity_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_readings_entity_recorded_at
  ON readings (entity_id, recorded_at);
