CREATE TABLE IF NOT EXISTS user_progress (
  progress_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_progress_updated_at ON user_progress (updated_at);
