#!/usr/bin/env bash
set -e

echo "Building Claude Memory OS..."
npm install
npm run build

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "Build complete."
echo ""
echo "Add the following to the mcpServers section of ~/.claude.json:"
echo ""
echo '  "claude-memory-os": {'
echo '    "command": "node",'
echo "    \"args\": [\"${SCRIPT_DIR}/dist/index.js\"],"
echo '    "env": {'
echo '      "OBSIDIAN_VAULT_PATH": "/path/to/your/obsidian/vault"'
echo '    }'
echo '  }'
echo ""
echo "OBSIDIAN_VAULT_PATH is optional. Remove it if you do not use Obsidian."
echo "Restart Claude Code after updating the config."
