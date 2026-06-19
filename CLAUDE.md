# OpenJeopardy

## After editing client source files

Always rebuild the client before reporting a task done. The server (`./start.sh`) serves the pre-built dist — source changes have no effect until rebuilt.

```
cd /home/noah/Documents/openjeopardy/client
ELECTRON_RUN_AS_NODE=1 /usr/share/code/code node_modules/.pnpm/vite@5.4.21/node_modules/vite/bin/vite.js build
```

## Runtime

- No system `node` or `npm` — use VS Code's bundled Electron as Node: `ELECTRON_RUN_AS_NODE=1 /usr/share/code/code`
- Package manager: `/home/noah/.local/share/pnpm/bin/pnpm`
- Start server: `./start.sh` (serves built client at http://localhost:3001)

## Structure

```
openjeopardy/
├── start.sh                 ← starts server (port 3001)
├── server/index.js          ← Express + WebSocket server
├── client/src/              ← React + Vite source
│   └── components/
│       ├── AdminPanel.jsx
│       ├── Board.jsx
│       ├── QuestionModal.jsx
│       └── BuzzerDisplay.jsx
└── client/dist/             ← built output served by Express
```
