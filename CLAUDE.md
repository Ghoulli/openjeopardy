# OpenJeopardy — Claude context

Browser-based Jeopardy game. Node/WebSocket backend, React/Vite frontend.

## Key constraint: no system Node

The machine has no standalone `node`/`npm`. Use VS Code's bundled Electron:
```
ELECTRON_RUN_AS_NODE=1 /usr/share/code/code <script.js>
```
Package manager binary: `/home/noah/.local/share/pnpm/bin/pnpm`

## Running

```
./start.sh          # starts Express server at http://localhost:3001
```

The server serves the pre-built `client/dist/`. **After any edit to `client/src/`, rebuild:**
```
cd client
ELECTRON_RUN_AS_NODE=1 /usr/share/code/code node_modules/.pnpm/vite@5.4.21/node_modules/vite/bin/vite.js build
```
Report the task complete only after the build succeeds.

If esbuild is missing after a fresh install, run:
```
ELECTRON_RUN_AS_NODE=1 /usr/share/code/code node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/install.js
```

## Architecture

```
server/index.js          Express + ws WebSocket server (single file)
server/uploads/          Runtime image uploads — NOT in git
client/src/App.jsx       WS connection, top-level routing, player state
client/src/components/
  AdminPanel.jsx         Full admin UI (tabs: Game Control / Edit Board / Players / Sessions / Settings)
  Board.jsx              Jeopardy grid, accepts onUnmarkCell for admin restore
  QuestionModal.jsx      Question overlay shown to all viewers
  BuzzerDisplay.jsx      Buzzer results (first buzz + ms deltas)
  Scoreboard.jsx         Read-only score display for a second screen
  SetupView.jsx          Player join / name entry screen
client/src/config.js     WS URL (auto-switches ws/wss based on protocol)
client/dist/             Built output served by Express — NOT in git
```

## WebSocket message reference (common ones)

| type | direction | notes |
|------|-----------|-------|
| `set_active_cell` | admin→server | opens a question for all viewers |
| `mark_answered` | admin→server | marks active cell answered, clears it |
| `unmark_answered` | admin→server | restores an answered cell; takes `col`, `row` |
| `close_question` | admin→server | closes without marking answered |
| `activate_buzzer` / `reset_buzzers` | admin→server | buzzer control |
| `update_board` | admin→server | partial update: categories, pointValues, cells |
| `update_players` | admin→server | full player list replacement |
| `add_player` | admin→server | adds a named player |
| `next_player` / `set_active_player` | admin→server | turn management |
| `upload_image` | admin→server | base64 image for a cell |
| `create_session` / `set_current_session` | admin→server | session management |
| `open_final_jeopardy` / `close_final_jeopardy` | admin→server | Final Jeopardy flow |
| `state` | server→all | full game state broadcast after any change |

## Auth

- Default admin password: `jeopardy` (override with `ADMIN_PASSWORD` env var)
- Server issues short-lived tokens after login; clients reconnect with token (no password retransmit)

## What's internet-facing

This is deployed publicly. Changes to auth, WebSocket handling, or file upload code need security review. Images are served from `server/uploads/` via Express static middleware.

## Maintenance rules

- **README.md** — keep it up to date whenever site features, Docker usage, environment variables, or architecture change. It is the primary user-facing documentation.
- **.gitignore** — update it whenever new build artifacts, runtime files, secrets, or editor/OS patterns are introduced that should not be committed.
