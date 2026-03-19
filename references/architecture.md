# Memory OS Architecture

## Storage

SQLite in WAL mode at `~/.claude-memory-os/memories.db`.

```
memories table
  id              INTEGER PRIMARY KEY
  content         TEXT NOT NULL
  category        TEXT (episodic|semantic|rules|task)
  tags            TEXT (comma-separated)
  source          TEXT (where this memory came from)
  project         TEXT (project scoping)
  agent           TEXT (who wrote it)
  confidence      REAL (0.0-1.0)
  access_count    INTEGER
  content_hash    TEXT UNIQUE (SHA-256 dedup)
  created_at      TEXT
  updated_at      TEXT

memories_fts (FTS5 virtual table)
  tokenize = trigram (Chinese/CJK friendly)
  Synced via INSERT/UPDATE/DELETE triggers

memory_relations table
  from_id, to_id, relation_type
```

## Search Pipeline

```
Query
  |
  v
FTS5 MATCH (trigram)  ──>  Ranked by BM25
  |
  v  (if < 3 results)
LIKE fallback         ──>  Pattern match
  |
  v
Merge + dedup IDs
  |
  v
Recency decay         ──>  score * (0.5 + 0.5 * exp(-age/720h))
  |
  v
Return top N
```

## Write Pipeline (Verified)

```
Content
  |
  v
SHA-256 hash  ──>  Check existing? ──yes──>  Update access_count (dedup)
  |                                   |
  no                                  return "duplicate"
  |
  v
BEGIN TRANSACTION
  INSERT INTO memories (...)
  SELECT id WHERE id=? AND hash=?   ──>  Verify read-back
COMMIT
  |
  v
Return { verified: true, id: N }
```

## Auto-Capture (Hooks)

```
PostToolUse (Edit|Write)
  |
  v
Extract file_path + tool_name
  |
  v
sqlite3 direct write (async, non-blocking)
  |
  v
Stored as: category=episodic, source=hook:post-tool-use

Stop (session end)
  |
  v
Count edits from this session
  |
  v
Store session summary with edit count
```

## Category Model

| Category | Purpose | Examples |
|----------|---------|----------|
| episodic | Specific events, conversations | "Deployed v2.1 to production" |
| semantic | Knowledge, patterns, decisions | "JWT tokens expire after 24h" |
| rules | Constraints, preferences | "Never use force push on main" |
| task | Todos, action items | "Migrate auth to OAuth2 by Friday" |
