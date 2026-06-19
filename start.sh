#!/usr/bin/env bash
# OpenJeopardy startup script
# Uses VS Code's bundled Node.js (no system Node required)
NODE="ELECTRON_RUN_AS_NODE=1 /usr/share/code/code"

cd "$(dirname "$0")"

echo "Starting OpenJeopardy server on http://localhost:3001"
echo "Press Ctrl+C to stop."
echo ""

exec env ELECTRON_RUN_AS_NODE=1 /usr/share/code/code server/index.js
