#!/bin/bash
# Memory OS Hook: PostToolUse
# Captures file edits as episodic memories automatically.
# Only triggers on Edit/Write tools to keep noise low.

HOOK_INPUT=$(cat)
TOOL_NAME=$(echo "$HOOK_INPUT" | jq -r '.tool_name // empty')
FILE_PATH=$(echo "$HOOK_INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

# Only capture file write/edit operations
case "$TOOL_NAME" in
  Edit|Write|NotebookEdit)
    ;;
  *)
    # Pass through without capturing
    echo '{"decision":"approve"}'
    exit 0
    ;;
esac

# Skip if no file path
if [ -z "$FILE_PATH" ]; then
  echo '{"decision":"approve"}'
  exit 0
fi

# Skip memory-os own files, .git, node_modules
case "$FILE_PATH" in
  */.git/*|*/node_modules/*|*claude-memory-os*|*.db)
    echo '{"decision":"approve"}'
    exit 0
    ;;
esac

# Get project name from cwd
PROJECT=$(basename "$(pwd)" 2>/dev/null || echo "unknown")
FILENAME=$(basename "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Store the edit as a memory (async, non-blocking)
MEMORY_DB="${MEMORY_OS_DATA_DIR:-$HOME/.claude-memory-os}/memories.db"

if [ -f "$MEMORY_DB" ]; then
  CONTENT="File edited: $FILE_PATH (tool: $TOOL_NAME)"
  HASH=$(echo -n "$CONTENT" | shasum -a 256 | cut -d' ' -f1)

  sqlite3 "$MEMORY_DB" "
    INSERT OR IGNORE INTO memories (content, category, tags, source, project, agent, confidence, content_hash, created_at, updated_at)
    VALUES ('$CONTENT', 'episodic', 'file-edit,$TOOL_NAME', 'hook:post-tool-use', '$PROJECT', 'claude', 0.8, '$HASH', '$TIMESTAMP', '$TIMESTAMP');
  " 2>/dev/null &
fi

echo '{"decision":"approve"}'
