CREATE TABLE IF NOT EXISTS access_codes (
  code_id TEXT NOT NULL UNIQUE,
  code_hash TEXT PRIMARY KEY,
  generator_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumed_by_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_codes_expires_at ON access_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_access_codes_consumed_at ON access_codes (consumed_at);
