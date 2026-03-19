# Claude Memory OS

Standalone Memory OS for Claude Code -- persistent memory with verified writes, hybrid Chinese/English search, auto-capture hooks, claude-mem import, and Obsidian sync.

Inspired by the [MemOS 4-Agent Memory Architecture](https://github.com/MemTensor/MemOS) and built following [Anthropic's skill best practices](https://x.com/trq212/status/2033949937936085378).

## Features

- **Verified writes** -- every insert is confirmed with a read-back check inside a transaction, preventing silent "fake success" failures
- **FTS5 trigram search** -- SQLite FTS5 with `tokenize='trigram'` supports Chinese, Japanese, Korean, and partial-word matching
- **Hybrid search with recency scoring** -- FTS5 + LIKE fallback, scored with 30-day exponential decay so recent memories rank higher
- **Content-hash deduplication** -- SHA-256 prevents duplicates; re-submitted memories update access count
- **Auto-capture hooks** -- PostToolUse hook records file edits; Stop hook saves session summaries. Zero manual effort.
- **claude-mem import** -- automatically migrates all observations from the claude-mem plugin during setup
- **Obsidian bidirectional sync** -- import from / export to an Obsidian vault with three-layer memory structure
- **Startup context injection** -- `memory_recall` loads recent memories to prime each conversation
- **Multi-project scoping** -- every memory carries a `project` field; search and recall can filter per project
- **System-level skill** -- installed as a Claude Code skill with auto-trigger description for seamless activation
- **Progressive disclosure** -- reference docs in `references/` folder that Claude reads on demand, not upfront

## Quick Install

```bash
git clone https://github.com/shaneliuyx/claude-memory-os.git
cd claude-memory-os
./setup.sh
```

The setup script automatically:

1. **Builds** the project (`npm install && npm run build`)
2. **MCP server** -- adds `memory-os` to `~/.claude.json` mcpServers
3. **Hooks** -- adds PostToolUse (file edit capture) and Stop (session summary) hooks to `~/.claude/settings.json`
4. **Skill** -- symlinks to `~/.claude/skills/memory-os` for auto-triggering from any project
5. **Import** -- migrates existing claude-mem observations from `~/.claude-mem/claude-mem.db` (if present)

Restart Claude Code after setup.

### Optional: Obsidian Vault Sync

Edit `~/.claude.json` and add the vault path to the `memory-os` env:

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

### Manual Installation

If `./setup.sh` doesn't work for your setup:

1. Build: `npm install && npm run build`
2. Add MCP server to `~/.claude.json` (see above)
3. Add hooks to `~/.claude/settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{"type": "command", "command": "bash /path/to/claude-memory-os/hooks/post-tool-use.sh"}]
    }],
    "Stop": [{
      "hooks": [{"type": "command", "command": "bash /path/to/claude-memory-os/hooks/session-complete.sh"}]
    }]
  }
}
```
4. Symlink skill: `ln -sfn /path/to/claude-memory-os ~/.claude/skills/memory-os`
5. Import claude-mem (optional): use the `memory_import_claude_mem` tool after restart

## What Gets Installed

```
~/.claude.json                     MCP server config (memory-os entry)
~/.claude/settings.json            Hooks (PostToolUse + Stop)
~/.claude/skills/memory-os/        Skill symlink (auto-trigger)
~/.claude-memory-os/memories.db    SQLite database (created on first use)
```

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

### memory_timeline

Daily activity timeline with counts and categories.

```
memory_timeline(days: 30, project: "my-app")
```

### memory_stats

Database statistics: total count, category/project breakdown, recent activity.

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

### memory_import_claude_mem

Import observations from the claude-mem plugin into Memory OS.

```
memory_import_claude_mem()
memory_import_claude_mem(project: "my-app", since: "2026-03-01")
```

Safe to run multiple times (deduplicates by content hash).

## Auto-Capture Hooks

| Hook | Trigger | What it captures |
|------|---------|-----------------|
| **PostToolUse** | Edit/Write tools | File path and tool used |
| **Stop** | Session end | Session summary with edit count |

Hooks write directly to SQLite -- no MCP overhead, no token cost, non-blocking.

Skips: Read, Bash, Grep, Glob, and Memory OS's own files.

## Skill Auto-Triggering

The `SKILL.md` description tells Claude when to activate Memory OS. Triggers include:

- "remember this", "save this for later"
- "what did we decide", "recall"
- "search memory", "what happened last time"
- Any reference to past conversations or decisions
- Session start (for context loading)

## Project Structure

```
claude-memory-os/
  SKILL.md              Skill definition with auto-trigger description
  config.json           User preferences (vault path, recall settings)
  setup.sh              One-command installer
  package.json          Node.js project config
  tsconfig.json         TypeScript config
  src/
    index.ts            MCP server entry point (8 tools)
    db.ts               SQLite schema + FTS5 trigram setup
    memory.ts           Store, search, recall, timeline, stats, delete
    sync.ts             Obsidian bidirectional sync
    import-claude-mem.ts  claude-mem observation importer
  hooks/
    post-tool-use.sh    Auto-capture file edits
    session-complete.sh Auto-capture session summaries
  references/
    examples.md         Usage patterns (progressive disclosure)
    architecture.md     Technical details (progressive disclosure)
```

## Architecture

```
Write pipeline (verified):
  Content -> SHA-256 hash -> dedup check -> INSERT in txn -> read-back verify -> commit

Search pipeline (hybrid):
  Query -> FTS5 MATCH (trigram) -> LIKE fallback -> merge + dedup -> recency decay -> top N

Auto-capture:
  PostToolUse hook -> sqlite3 direct write (async)
  Stop hook -> session summary with edit count

Storage:
  SQLite WAL mode, FTS5 trigram tokenizer, content_hash UNIQUE constraint
```

## Gotchas

- **FTS5 trigram requires 3+ character queries** -- shorter queries fall back to LIKE search
- **Duplicate detection uses content hash** -- slightly different wording creates a new memory
- **Hook-captured memories are low-detail** -- they only record file path + tool. Use `memory_store` for rich context.
- **Session-complete hook needs sqlite3** -- pre-installed on macOS/Linux
- **Obsidian sync defaults to ~/第二大脑** -- set `OBSIDIAN_VAULT_PATH` env var if different

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_OS_DATA_DIR` | `~/.claude-memory-os/` | SQLite database directory |
| `OBSIDIAN_VAULT_PATH` | `~/第二大脑` | Obsidian vault for sync |
| `CLAUDE_MEM_DATA_DIR` | `~/.claude-mem/` | claude-mem DB location (for import) |

## Requirements

- Node.js >= 18
- Claude Code
- sqlite3 CLI (for hooks; pre-installed on macOS/Linux)

## License

MIT -- Copyright 2026
