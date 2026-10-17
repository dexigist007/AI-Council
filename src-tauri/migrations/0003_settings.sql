-- Small app-wide preferences (e.g. the discovery profile). Values are JSON.
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
