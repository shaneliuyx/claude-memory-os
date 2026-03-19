# Claude Memory OS

Standalone Memory OS for Claude Code — persistent memory with verified writes, hybrid Chinese/English search, and Obsidian sync.

## Features

- **Verified writes**: Every memory insert is confirmed with a read-back check inside a transaction, preventing silent failures
- **FTS5 trigram search**: SQLite's FTS5 virtual table with `tokenize='trigram'` supports Chinese characters and partial-word matching without word boundaries
- **Hybrid search with recency scoring**: FTS5 results are supplemented by LIKE fallback, then scored with a 30-day exponential decay so recent memories rank higher
- **Content-hash deduplication**: SHA-256 hash of normalized content prevents duplicate entries; re-submitted memories update access count instead
- **Obsidian bidirectional sync**: Import markdown files from a `记忆库/` folder structure, export new memories as dated markdown with YAML frontmatter
- **Startup context injection**: `memory_recall` is designed for session-start use — load the last 72 hours of memories to prime each conversation
- **Multi-project memory scoping**: Every memory carries an optional `project` field; search and recall can be filtered per project

## Quick Install

**Step 1: Clone the repo**
```bash
git clone https://github.com/user/claude-memory-os.git
cd claude-memory-os
```

**Step 2: Build**
```bash
npm install && npm run build
```

**Step 3: Add MCP config to `~/.claude.json`**

Add the following under `mcpServers`:

```json
{
  "mcpServers": {
    "claude-memory-os": {
      "command": "node",
      "args": ["/absolute/path/to/claude-memory-os/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/your/obsidian/vault"
      }
    }
  }
}
```

`OBSIDIAN_VAULT_PATH` is optional. If omitted, sync defaults to `~/第二大脑`.

Restart Claude Code after updating the config.

## Tools

### `memory_store`
Store a memory with verified write and automatic deduplication.

```
memory_store(
  content: "Switched auth to JWT with 24h expiry. Refresh tokens stored in httpOnly cookie.",
  category: "semantic",
  tags: "auth,jwt,security",
  source: "src/auth/middleware.ts",
  project: "my-app"
)
```

Categories: `episodic` (events/conversations), `semantic` (knowledge/patterns), `rules` (constraints/preferences), `task` (todos).

Returns: `{ success, id, action, message, verified }` — `action` is one of `created`, `duplicate`, `updated`, `error`.

### `memory_search`
Search memories using hybrid FTS5 trigram + LIKE search with recency scoring. Works with Chinese and English queries.

```
memory_search(
  query: "JWT authentication",
  category: "semantic",
  project: "my-app",
  limit: 5
)
```

Returns ranked results with id, category, score, tags, source, and a 200-character content preview.

### `memory_recall`
Recall recent memories for context injection at session start. Returns memories from the last N hours ordered by recency.

```
memory_recall(
  hours: 72,
  project: "my-app",
  limit: 10
)
```

Use this at the beginning of a Claude Code session to load relevant context before starting work.

### `memory_timeline`
View memory activity as a daily timeline showing counts and categories.

```
memory_timeline(days: 30, project: "my-app")
```

Output: one line per day with date, count, and category breakdown.

### `memory_stats`
Get database statistics: total count, breakdown by category and project, last 24h activity, oldest/newest timestamps, DB path.

```
memory_stats()
```

### `memory_delete`
Delete a memory by ID. Prefer leaving memories and adding corrective ones over deletion.

```
memory_delete(id: 42)
```

### `memory_sync_obsidian`
Bidirectional sync between the SQLite database and an Obsidian vault.

```
memory_sync_obsidian(direction: "both")
memory_sync_obsidian(direction: "import")
memory_sync_obsidian(direction: "export", category: "semantic")
```

**Import** reads markdown files from `{OBSIDIAN_VAULT_PATH}/记忆库/` with subdirectories `情景记忆/`, `语义记忆/`, `强制规则/` and the task file `任务清单.md`.

**Export** writes memories created in the last 24 hours as dated markdown files with YAML frontmatter into the matching category subdirectory.

## Architecture

```
SQLite (WAL mode)
  memories              — main table with content_hash UNIQUE constraint
  memories_fts          — FTS5 virtual table, trigram tokenizer
  memory_relations      — optional relation graph between memories
  Triggers (ai/ad/au)  — keep FTS index in sync automatically

Search pipeline:
  1. FTS5 MATCH query        → ranked by BM25 (rank column)
  2. LIKE fallback           → if FTS returns < 3 results
  3. Recency decay scoring   → exp(-age_hours / 720), 30-day half-life
  4. Dedup merge             → exclude IDs already in FTS results
```

Verified writes use a SQLite transaction: INSERT then SELECT by id+hash inside the same transaction. If the SELECT returns nothing, the transaction throws and rolls back.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MEMORY_OS_DATA_DIR` | `~/.claude-memory-os/` | Directory for the SQLite database file |
| `OBSIDIAN_VAULT_PATH` | `~/第二大脑` | Path to your Obsidian vault root |

## License

MIT — Copyright 2026
