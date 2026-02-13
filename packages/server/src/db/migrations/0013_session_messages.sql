-- Migration: Extract session messages from JSON array to normalized table
-- This improves addMessage from O(n) read-modify-write to O(1) INSERT.

CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS session_messages_session_id_idx ON session_messages(session_id);
CREATE INDEX IF NOT EXISTS session_messages_session_timestamp_idx ON session_messages(session_id, timestamp);

-- Migrate existing messages from JSON array to the new table.
-- Uses json_each() to iterate over the embedded JSON arrays.
INSERT INTO session_messages (id, session_id, role, content, timestamp, created_at)
SELECT
  json_extract(j.value, '$.id'),
  s.id,
  json_extract(j.value, '$.role'),
  json_extract(j.value, '$.content'),
  json_extract(j.value, '$.timestamp'),
  json_extract(j.value, '$.timestamp')
FROM sessions s, json_each(s.messages) j
WHERE json_array_length(s.messages) > 0;
