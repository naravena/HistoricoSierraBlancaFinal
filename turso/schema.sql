-- Tabla canónica del histórico. Conserva el origen y los campos originales.
-- Las tablas legacy readings y energy_statistics no se eliminan.
CREATE TABLE IF NOT EXISTS historical_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_type TEXT NOT NULL,
    source_row_id INTEGER NOT NULL,
    entity_id TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    value REAL,
    source_state_id INTEGER,
    source_statistic_id INTEGER,
    statistic_id TEXT,
    mean REAL,
    mean_weight REAL,
    min REAL,
    max REAL,
    last_reset_at TEXT,
    state REAL,
    sum REAL,
    UNIQUE (record_type, source_row_id)
);

CREATE INDEX IF NOT EXISTS idx_historical_entity_date
    ON historical_data (entity_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_historical_type_date
    ON historical_data (record_type, recorded_at);

CREATE INDEX IF NOT EXISTS idx_historical_reading_lookup
    ON historical_data (entity_id, recorded_at, source_row_id)
    WHERE record_type = 'reading';
