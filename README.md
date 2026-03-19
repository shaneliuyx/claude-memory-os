# Claude Memory OS

Standalone Memory OS for Claude Code -- persistent memory with verified writes, hybrid Chinese/English search, auto-capture hooks, claude-mem import, and Obsidian sync.

Inspired by the [MemOS 4-Agent Memory Architecture](https://github.com/MemTensor/MemOS) and built to work as a drop-in MCP server for Claude Code.

## Features

- **Verified writes** -- every insert is confirmed with a read-back check inside a transaction, preventing silent "fake success" failures
- **FTS5 trigram search** -- SQLite FTS5 with `tokenize='trigram'` supports Chinese, Japanese, Korean, and partial-word matching
- **Hybrid search with recency scoring** -- FTS5 + LIKE fallback, scored with 30-day exponential decay so recent memories rank higher
- **Content-hash deduplication** -- SHA-256 prevents duplicates; re-submitted memories update access count
- **Auto-capture hooks** -- PostToolUse hook records file edits; Stop hook saves session summaries. Zero manual effort.
- **claude-mem import** -- automatically migrates all observations from the claude-mem plugin during setup
- **Obsidian bidirectional sync** -- import from / export to an Obsidian vault with `记忆库/` folder structure
- **Startup context injection** -- `memory_recall` loads recent memories to prime each conversation
- **Multi-project scoping** -- every memory carries a `project` field; search and recall can filter per project

## Quick Install

```bash
git clone https://github.com/shaneliuyx/claude-memory-os.git
cd claude-memory-os
./setup.sh
```

The setup script automatically:
1. Builds the project (`npm install && npm run build`)
2. Adds the MCP server to `~/.claude.json`
3. Installs auto-capture hooks in `~/.claude/settings.json`
4. Imports existing claude-mem observations (if `~/.claude-mem/claude-mem.db` exists)

Restart Claude Code after setup.

### Optional: Obsidian Vault Sync

To enable bidirectional sync with an Obsidian vault, edit `~/.claude.json` and add the vault path:

```json
"memory-os": {
  "command": "node",
  "args": ["/path/to/claude-memory-os/dist/index.js"],
  "env": {
    "OBSIDIAN_VAULT_PATH": "/path/to/your/obsidian/vault"
  }
}
```

If omitted, sync defaults to `~/第二大脑`.

## Tools (8 total)

### memory_store

Store a memory with verified write and automatic deduplication.

```
memory_store(
  content: "Switched auth to JWT with 24h expiry",
  category: "semantic",
  tags: "auth,jwt",
  source: "src/auth/middleware.ts",
  project: "my-app"
)
```

Categories: `episodic` (events/conversations), `semantic` (knowledge/patterns), `rules` (constraints/preferences), `task` (todos).

Returns: `{ success, id, action, message, verified }` -- `action` is `created`, `duplicate`, or `error`.

### memory_search

Hybrid FTS5 trigram + LIKE search with recency scoring. Works with Chinese and English.

```
memory_search(query: "JWT authentication", category: "semantic", limit: 5)
memory_search(query: "白名单路径")
```

### memory_recall

Load recent memories for context injection at session start.

```
memory_recall(hours: 72, project: "my-app", limit: 10)
```

Use at the beginning of a Claude Code session to prime context.

### memory_timeline

Daily activity timeline with counts and categories.

```
memory_timeline(days: 30, project: "my-app")
```

### memory_stats

Database statistics: total count, category/project breakdown, recent activity, DB path.

```
memory_stats()
```

### memory_delete

Delete a memory by ID.

```
memory_delete(id: 42)
```

### memory_sync_obsidian

Bidirectional sync between SQLite and an Obsidian vault.

```
memory_sync_obsidian(direction: "both")
memory_sync_obsidian(direction: "import")
memory_sync_obsidian(direction: "export", category: "semantic")
```

**Import** reads markdown from `{OBSIDIAN_VAULT_PATH}/记忆库/` subdirectories (`情景记忆/`, `语义记忆/`, `强制规则/`) and `任务清单.md`.

**Export** writes recent memories as dated markdown with YAML frontmatter.

### memory_import_claude_mem

Import observations from the claude-mem plugin into Memory OS.

```
memory_import_claude_mem()
memory_import_claude_mem(project: "my-app", since: "2026-03-01", limit: 100)
```

Maps claude-mem types to Memory OS categories: `decision`/`discovery` -> `semantic`, `bugfix`/`feature`/`refactor`/`change` -> `episodic`.

Safe to run multiple times (deduplicates by content hash).

## Auto-Capture Hooks

The setup script installs two Claude Code hooks:

| Hook | Trigger | What it captures |
|------|---------|-----------------|
| **PostToolUse** | Edit/Write tools | File path and tool used (skips Read, Bash, etc.) |
| **Stop** | Session end | Session summary with edit count |

These run in the background and write directly to SQLite -- no MCP overhead, no token cost.

Hooks are installed at:
- `hooks/post-tool-use.sh` -- captures file edits as episodic memories
- `hooks/session-complete.sh` -- records session summary at session end

## Architecture

```
SQLite (WAL mode) at ~/.claude-memory-os/memories.db

Tables:
  memories          -- main table, content_hash UNIQUE constraint
  memories_fts      -- FTS5 virtual table, trigram tokenizer
  memory_relations  -- relation graph between memories
  Triggers          -- keep FTS in sync on INSERT/UPDATE/DELETE

Search pipeline:
  1. FTS5 MATCH       -> ranked by BM25
  2. LIKE fallback    -> if FTS returns < 3 results
  3. Recency decay    -> exp(-age / 720h), 30-day half-life
  4. Dedup merge      -> combine results, exclude duplicates

Write pipeline:
  1. SHA-256 hash     -> check for existing duplicate
  2. INSERT in txn    -> write memory row
  3. Verify read-back -> SELECT by id+hash in same transaction
  4. FTS trigger      -> auto-index via SQLite trigger

Auto-capture:
  PostToolUse hook -> sqlite3 direct write (async, non-blocking)
  Stop hook        -> session summary with edit count
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_OS_DATA_DIR` | `~/.claude-memory-os/` | SQLite database directory |
| `OBSIDIAN_VAULT_PATH` | `~/第二大脑` | Obsidian vault for sync |
| `CLAUDE_MEM_DATA_DIR` | `~/.claude-mem/` | claude-mem DB location (for import) |

## Requirements

- Node.js >= 18
- Claude Code
- SQLite3 (for hooks; pre-installed on macOS/Linux)

## License

MIT -- Copyright 2026
