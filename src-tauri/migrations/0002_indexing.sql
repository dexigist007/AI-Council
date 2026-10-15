-- Local project index: file metadata, text chunks and a full-text index over the chunks.

CREATE TABLE files (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  lang        TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('source','test','config','doc','manifest','other')),
  size        INTEGER NOT NULL,
  mtime_ms    INTEGER NOT NULL,
  hash        TEXT,
  -- Why content was not indexed: sensitive, lockfile, binary, too_large. NULL = indexed.
  skip_reason TEXT,
  indexed_at  TEXT NOT NULL,
  UNIQUE (project_id, path)
);

CREATE TABLE chunks (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  symbol      TEXT,
  content     TEXT NOT NULL,
  token_est   INTEGER NOT NULL
);
CREATE INDEX idx_chunks_file ON chunks(file_id);

-- Kept in sync by the app (not triggers) so deletes stay explicit. "_" is part of identifiers;
-- `words` holds identifiers split into parts (loadPlaylist → load playlist) so parts are searchable.
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content, path, symbol, words,
  chunk_id UNINDEXED, project_id UNINDEXED,
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'"
);

ALTER TABLE projects ADD COLUMN indexed_at TEXT;
ALTER TABLE projects ADD COLUMN index_stats_json TEXT;
