---
name: memory-os
description: >
  Use when you need to remember, recall, or search past decisions, rules, patterns,
  or experiences across sessions. Triggers on: "remember this", "what did we decide",
  "recall", "save this for later", "search memory", "what happened last time",
  "import memories", "sync obsidian", any reference to past conversations or decisions
  that should persist across sessions. Also use at session start to load recent context.
---

# Memory OS Skill

Persistent memory system for Claude Code with verified writes, hybrid Chinese/English
search, auto-capture hooks, and Obsidian sync.

## When to Use

- **Session start**: Call `memory_recall` to load recent context
- **Important decision**: Call `memory_store` with category `semantic`
- **New rule/constraint**: Call `memory_store` with category `rules`
- **Task tracking**: Call `memory_store` with category `task`
- **Search past work**: Call `memory_search` with any query
- **Sync with Obsidian**: Call `memory_sync_obsidian`
- **Import claude-mem**: Call `memory_import_claude_mem` (one-time migration)

## Quick Reference

```
memory_store(content, category, tags, source, project)
memory_search(query, category, project, limit)
memory_recall(hours, category, project, limit)
memory_timeline(days)
memory_stats()
memory_delete(id)
memory_sync_obsidian(direction)
memory_import_claude_mem(limit, project, since)
```

Categories: `episodic`, `semantic`, `rules`, `task`

## Gotchas

- **FTS5 trigram requires 3+ character queries** — shorter queries automatically
  fall back to LIKE search, which is slower but still works
- **Duplicate detection uses content hash** — slightly different wording creates
  a new memory even if the meaning is the same. Be consistent.
- **Obsidian sync defaults to ~/第二大脑** — set OBSIDIAN_VAULT_PATH env var
  in ~/.claude.json if your vault is elsewhere
- **Hook-captured memories are low-detail** — they only record file path + tool.
  For important context, use `memory_store` explicitly with rich content.
- **Session-complete hook needs sqlite3** — pre-installed on macOS/Linux, but
  verify with `which sqlite3` if memories aren't being captured

## References

See [references/examples.md](references/examples.md) for usage patterns.
See [references/architecture.md](references/architecture.md) for technical details.
