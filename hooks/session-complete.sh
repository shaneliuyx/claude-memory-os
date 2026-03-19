#!/bin/bash
# Memory OS Hook: Stop (session complete)
# Captures a session summary as episodic memory when Claude Code session ends.

HOOK_INPUT=$(cat)
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // empty')

PROJECT=$(basename "$(pwd)" 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

MEMORY_DB="${MEMORY_OS_DATA_DIR:-$HOME/.claude-memory-os}/memories.db"

if [ ! -f "$MEMORY_DB" ]; then
  exit 0
fi

# Count edits made this session (files touched via hooks)
EDIT_COUNT=$(sqlite3 "$MEMORY_DB" "
  SELECT COUNT(*) FROM memories
  WHERE source = 'hook:post-tool-use'
  AND project = '$PROJECT'
  AND created_at > datetime('now', '-4 hours');
" 2>/dev/null || echo "0")

if [ "$EDIT_COUNT" -gt 0 ]; then
  CONTENT="Session ended for project '$PROJECT'. $EDIT_COUNT file edits captured during this session."
  HASH=$(echo -n "${CONTENT}${TIMESTAMP}" | shasum -a 256 | cut -d' ' -f1)

  sqlite3 "$MEMORY_DB" "
    INSERT OR IGNORE INTO memories (content, category, tags, source, project, agent, confidence, content_hash, created_at, updated_at)
    VALUES ('$CONTENT', 'episodic', 'session-summary', 'hook:session-complete', '$PROJECT', 'claude', 1.0, '$HASH', '$TIMESTAMP', '$TIMESTAMP');
  " 2>/dev/null

  # Also sync FTS index for the new entries
  sqlite3 "$MEMORY_DB" "
    INSERT OR IGNORE INTO memories_fts(rowid, content, tags, source, project)
    SELECT id, content, tags, source, project FROM memories
    WHERE source IN ('hook:post-tool-use', 'hook:session-complete')
    AND created_at > datetime('now', '-4 hours')
    AND id NOT IN (SELECT rowid FROM memories_fts);
  " 2>/dev/null
fi
