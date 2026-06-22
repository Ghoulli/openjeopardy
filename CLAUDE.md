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
server/avatars/          Player avatar images — NOT in git
server/accounts.json     Player accounts (usernames, hashed passwords, stats, achievements)
client/src/App.jsx       WS connection, top-level routing, player state
client/src/components/
  AdminPanel.jsx         Full admin UI (tabs: Game Control / Edit Board / Players / Sessions / Settings)
  Board.jsx              Jeopardy grid, accepts onUnmarkCell for admin restore
  QuestionModal.jsx      Question overlay shown to all viewers (normal, daily double, drawing)
  BuzzerDisplay.jsx      Buzzer results (first buzz + ms deltas)
  Scoreboard.jsx         Live score strip shown in the player board view
  SetupView.jsx          Player join / register / login screen
  ProfileModal.jsx       Player stats, achievements, avatar upload
  FinalJeopardyPage.jsx  Full-screen /final route for projector display
  EmojiPicker.jsx        Emoji reaction picker
client/src/config.js     WS URL (auto-switches ws/wss based on protocol)
client/dist/             Built output served by Express — NOT in git
```

## WebSocket message reference (common ones)

| type | direction | notes |
|------|-----------|-------|
| `join` | player→server | guest join with display name |
| `register_player` | player→server | create account; server responds with `player_auth` |
| `login_player` | player→server | account login; server responds with `player_auth` |
| `player_rejoin` | player→server | reconnect with stored token |
| `set_active_cell` | admin→server | opens a question for all viewers |
| `mark_answered` | admin→server | marks active cell answered, clears it; updates streak |
| `wrong_answer` | admin→server | deducts points from top buzzer (or DD wagerer), resets streak |
| `unmark_answered` | admin→server | restores an answered cell; takes `col`, `row` |
| `close_question` | admin→server | closes without marking answered |
| `activate_buzzer` / `stop_buzzer` / `reset_buzzers` | admin→server | buzzer control |
| `update_board` | admin→server | partial update: categories, pointValues, cells |
| `update_players` | admin→server | full player list replacement |
| `add_player` | admin→server | adds a named player |
| `next_player` / `set_active_player` | admin→server | turn management |
| `upload_image` / `remove_image` | admin→server | base64 image for a cell |
| `toggle_daily_double` | admin→server | toggle DD flag on a cell; takes `col`, `row` |
| `toggle_drawing_type` | admin→server | toggle cell type between `text` and `drawing` |
| `set_daily_double_wager` | player or admin→server | set the DD wager (integer ≥ 1) |
| `upload_drawing` | player→server | player submits a drawing for the active drawing-type cell |
| `set_carousel_index` | admin→server | advance/navigate drawing carousel for all viewers |
| `create_session` / `set_current_session` / `delete_session` | admin→server | session management |
| `open_final_jeopardy` / `close_final_jeopardy` / `reveal_final_answer` | admin→server | Final Jeopardy flow |
| `update_final_jeopardy` | admin→server | patch FJ category/question/answer text |
| `upload_final_image` / `remove_final_image` | admin→server | image for Final Jeopardy |
| `upload_avatar` | player→server | base64 avatar image for logged-in player |
| `player_reaction` | player→server | broadcast emoji reaction; rate-limited to 1 per 2 s |
| `request_open_cell` | active player→server | request to open a cell (pending admin approval) |
| `approve_cell_request` / `deny_cell_request` | admin→server | respond to pending cell request |
| `cancel_cell_request` | requesting player→server | cancel own pending request |
| `reset_game` | admin→server | full game reset; records stats for logged-in players first |
| `reset_board` | admin→server | clear cells/buzzers only, keep players |
| `add_column` / `add_row` | admin→server | grow the board |
| `state` | server→all | full game state broadcast after any change |
| `player_auth` | server→player | token + stats + achievements after login/register/rejoin |
| `achievements_unlocked` | server→player | new achievements earned (on reset_game) |
| `stats_updated` | server→player | updated lifetime stats (on reset_game) |
| `avatar_updated` | server→player | new avatar URL after successful upload |

## Auth

- Default admin password: `jeopardy` (override with `ADMIN_PASSWORD` env var)
- Server issues short-lived tokens after login; clients reconnect with token (no password retransmit)
- Player accounts use scrypt-hashed passwords stored in `server/accounts.json`
- Player login is brute-force protected: 10 failures per IP → 10-minute block

## What's internet-facing

This is deployed publicly. Changes to auth, WebSocket handling, or file upload code need security review. Images are served from `server/uploads/` and `server/avatars/` via Express static middleware.

## Maintenance rules

- **README.md** — keep it up to date whenever site features, Docker usage, environment variables, or architecture change. It is the primary user-facing documentation.
- **.gitignore** — update it whenever new build artifacts, runtime files, secrets, or editor/OS patterns are introduced that should not be committed.
