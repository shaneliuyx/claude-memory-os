#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building Claude Memory OS..."
npm install
npm run build

echo ""
echo "Build complete."
echo ""

# --- Auto-configure MCP server in ~/.claude.json ---
CLAUDE_JSON="$HOME/.claude.json"
if [ -f "$CLAUDE_JSON" ]; then
  if grep -q '"memory-os"' "$CLAUDE_JSON" 2>/dev/null; then
    echo "MCP server 'memory-os' already configured in ~/.claude.json"
  else
    echo "Adding memory-os MCP server to ~/.claude.json..."
    # Use python3 to safely modify JSON
    python3 -c "
import json, sys
with open('$CLAUDE_JSON', 'r') as f:
    cfg = json.load(f)
if 'mcpServers' not in cfg:
    cfg['mcpServers'] = {}
cfg['mcpServers']['memory-os'] = {
    'command': 'node',
    'args': ['${SCRIPT_DIR}/dist/index.js'],
    'env': {}
}
with open('$CLAUDE_JSON', 'w') as f:
    json.dump(cfg, f, indent=2)
print('  Added memory-os to mcpServers')
" 2>/dev/null && echo "  Done." || echo "  Auto-config failed. See manual instructions below."
  fi
else
  echo "~/.claude.json not found. Creating with memory-os MCP server..."
  cat > "$CLAUDE_JSON" <<MCPEOF
{
  "mcpServers": {
    "memory-os": {
      "command": "node",
      "args": ["${SCRIPT_DIR}/dist/index.js"],
      "env": {}
    }
  }
}
MCPEOF
  echo "  Created ~/.claude.json"
fi

# --- Install hooks in ~/.claude/settings.json ---
SETTINGS_JSON="$HOME/.claude/settings.json"
HOOKS_DIR="${SCRIPT_DIR}/hooks"

if [ -f "$SETTINGS_JSON" ]; then
  if grep -q "memory-os" "$SETTINGS_JSON" 2>/dev/null; then
    echo "Hooks already configured in ~/.claude/settings.json"
  else
    echo "Adding auto-capture hooks to ~/.claude/settings.json..."
    python3 -c "
import json
with open('$SETTINGS_JSON', 'r') as f:
    cfg = json.load(f)
if 'hooks' not in cfg:
    cfg['hooks'] = {}
# PostToolUse hook for file edits
if 'PostToolUse' not in cfg['hooks']:
    cfg['hooks']['PostToolUse'] = []
cfg['hooks']['PostToolUse'].append({
    'matcher': 'Edit|Write',
    'hooks': [{
        'type': 'command',
        'command': 'bash ${HOOKS_DIR}/post-tool-use.sh'
    }]
})
# Stop hook for session summary
if 'Stop' not in cfg['hooks']:
    cfg['hooks']['Stop'] = []
cfg['hooks']['Stop'].append({
    'hooks': [{
        'type': 'command',
        'command': 'bash ${HOOKS_DIR}/session-complete.sh'
    }]
})
with open('$SETTINGS_JSON', 'w') as f:
    json.dump(cfg, f, indent=2)
print('  Added PostToolUse and Stop hooks')
" 2>/dev/null && echo "  Done." || echo "  Auto-config failed. Add hooks manually (see README)."
  fi
else
  echo "Creating ~/.claude/settings.json with auto-capture hooks..."
  mkdir -p "$HOME/.claude"
  cat > "$SETTINGS_JSON" <<HOOKEOF
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${HOOKS_DIR}/post-tool-use.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ${HOOKS_DIR}/session-complete.sh"
          }
        ]
      }
    ]
  }
}
HOOKEOF
  echo "  Created ~/.claude/settings.json"
fi

# --- Auto-import claude-mem observations ---
CLAUDE_MEM_DB="$HOME/.claude-mem/claude-mem.db"
if [ -f "$CLAUDE_MEM_DB" ]; then
  MEM_COUNT=$(sqlite3 "$CLAUDE_MEM_DB" "SELECT COUNT(*) FROM observations" 2>/dev/null || echo "0")
  if [ "$MEM_COUNT" -gt 0 ]; then
    echo ""
    echo "Found claude-mem database with $MEM_COUNT observations."
    echo "Importing into Memory OS..."
    # Start the MCP server briefly to trigger DB creation, then use sqlite3 directly
    node "${SCRIPT_DIR}/dist/index.js" &
    MCP_PID=$!
    sleep 1
    kill $MCP_PID 2>/dev/null
    wait $MCP_PID 2>/dev/null

    MEMORY_DB="$HOME/.claude-memory-os/memories.db"
    if [ -f "$MEMORY_DB" ]; then
      IMPORTED=0
      SKIPPED=0
      while IFS='|' read -r id type title subtitle narrative text facts concepts project created_at; do
        # Build content from fields
        CONTENT=""
        [ -n "$title" ] && CONTENT="# $title"
        [ -n "$subtitle" ] && CONTENT="$CONTENT\n$subtitle"
        [ -n "$narrative" ] && CONTENT="$CONTENT\n$narrative"
        [ -n "$facts" ] && CONTENT="$CONTENT\nFacts: $facts"

        if [ -z "$CONTENT" ]; then
          SKIPPED=$((SKIPPED + 1))
          continue
        fi

        # Map type to category
        case "$type" in
          decision|discovery) CATEGORY="semantic" ;;
          *) CATEGORY="episodic" ;;
        esac

        HASH=$(echo -n "$CONTENT" | shasum -a 256 | cut -d' ' -f1)
        sqlite3 "$MEMORY_DB" "
          INSERT OR IGNORE INTO memories (content, category, tags, source, project, agent, confidence, content_hash, created_at, updated_at)
          VALUES ('$(echo "$CONTENT" | sed "s/'/''/g")', '$CATEGORY', '$type,$concepts', 'claude-mem:$id', '$project', 'claude', 1.0, '$HASH', '$created_at', '$created_at');
        " 2>/dev/null
        if [ $? -eq 0 ]; then
          IMPORTED=$((IMPORTED + 1))
        else
          SKIPPED=$((SKIPPED + 1))
        fi
      done < <(sqlite3 -separator '|' "$CLAUDE_MEM_DB" "SELECT id, type, title, subtitle, narrative, text, facts, concepts, project, created_at FROM observations ORDER BY created_at_epoch ASC" 2>/dev/null)
      echo "  Imported: $IMPORTED, Skipped: $SKIPPED"
    fi
  fi
else
  echo "No claude-mem database found (skipping import)."
fi

echo ""
echo "=== Claude Memory OS is ready ==="
echo ""
echo "  MCP server: configured in ~/.claude.json"
echo "  Auto-capture hooks: configured in ~/.claude/settings.json"
echo "  Database: ~/.claude-memory-os/memories.db (created on first use)"
echo ""
echo "Optional: Set OBSIDIAN_VAULT_PATH in ~/.claude.json to enable Obsidian sync:"
echo "  \"env\": { \"OBSIDIAN_VAULT_PATH\": \"/path/to/your/vault\" }"
echo ""
echo "Restart Claude Code to activate."
