# Memory OS Usage Examples

## Session Start Pattern

At the beginning of every session, load recent context:

```
memory_recall(hours: 72, limit: 10)
```

For project-specific work:

```
memory_recall(hours: 168, project: "my-app", limit: 5)
```

## Storing Decisions

When an important decision is made during a conversation:

```
memory_store(
  content: "Decided to use PostgreSQL over MongoDB for user data because we need ACID transactions for billing",
  category: "semantic",
  tags: "database,architecture,billing",
  source: "architecture-review",
  project: "my-app"
)
```

## Storing Rules

When a constraint or preference is established:

```
memory_store(
  content: "Always use UTC timestamps in API responses. Frontend converts to local time.",
  category: "rules",
  tags: "api,timestamps",
  project: "my-app"
)
```

## Searching Past Decisions

```
memory_search(query: "database choice", category: "semantic")
memory_search(query: "API规范", project: "my-app")
memory_search(query: "authentication", limit: 5)
```

## Obsidian Workflow

Import existing notes into Memory OS:

```
memory_sync_obsidian(direction: "import")
```

Export recent memories to Obsidian for review:

```
memory_sync_obsidian(direction: "export", category: "semantic")
```

## Migration from claude-mem

One-time import of all claude-mem observations:

```
memory_import_claude_mem()
```

Import only recent observations from a specific project:

```
memory_import_claude_mem(project: "my-app", since: "2026-03-01")
```
