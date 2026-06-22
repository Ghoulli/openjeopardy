# OpenJeopardy

A browser-based Jeopardy game with a real-time WebSocket backend. Supports multiple simultaneous viewers, a buzzer system, image clues, drawing questions, player accounts, sessions, and a full admin control panel.

---

## Quick start with Docker

```bash
docker build -t openjeopardy .
docker run -d \
  -p 3001:3001 \
  -e ADMIN_PASSWORD=yourpassword \
  -v openjeopardy-uploads:/app/server/uploads \
  -v openjeopardy-accounts:/app/server/accounts.json \
  --name openjeopardy \
  openjeopardy
```

Open **http://localhost:3001** in a browser.

> **Security:** Always set `ADMIN_PASSWORD`. Without it the server starts with the default password `jeopardy` and warns you on stdout. For HTTPS deployments, put a reverse proxy (nginx, Caddy) in front — the WebSocket client auto-switches to `wss://` when served over HTTPS.

### Persist uploads and accounts across restarts

Map the uploads directory and the accounts file as volumes. Remove them if you don't need persistence.

### Stop / remove

```bash
docker stop openjeopardy && docker rm openjeopardy
```

---

## Manual setup (dev machine)

Requires VS Code's bundled Electron as Node (no system Node needed) and [pnpm](https://pnpm.io).

```bash
# Install server deps
cd server && pnpm install

# Install client deps
cd ../client && pnpm install

# Build the client
ELECTRON_RUN_AS_NODE=1 /usr/share/code/code \
  node_modules/.pnpm/vite@5.4.21/node_modules/vite/bin/vite.js build

# Start the server
cd .. && ./start.sh
```

Server listens on **http://localhost:3001**.

---

## Site functions

### Player view

| Feature | How it works |
|---------|-------------|
| **Join screen** | Players can join as a guest (name only) or register/log in with a persistent account. A session must be active before joining is possible. |
| **Player accounts** | Optional registration with username + password (min 4 chars, scrypt-hashed). Accounts persist stats across games and unlock achievements. |
| **Profile modal** | Players open their profile to see lifetime stats (games played, wins, total earnings, high score), earned achievements, and upload a custom avatar. |
| **Game board** | Jeopardy grid of categories × point values. Answered cells are dimmed. |
| **Turn system** | The admin designates whose turn it is. Only the active player can request to open a cell; others see a "not your turn" toast. |
| **Cell request** | Active player clicks a cell → request is sent to admin for approval or denial. |
| **Question modal** | When admin opens a cell, the question/clue (and optional image) appear as an overlay for all viewers simultaneously. Click an image to zoom. |
| **Drawing questions** | For drawing-type cells, all players upload their own drawings during the question. Admin then runs them as a synchronized slideshow. |
| **Buzzer** | When the buzzer is active, players press **Space** (or the on-screen button) to buzz in. The first buzz is highlighted; subsequent buzzes show millisecond deltas. |
| **Scoreboard** | Live score strip across the top of the board, with the active player highlighted. Streak badges shown for consecutive correct answers. |
| **Emoji reactions** | Players can send emoji reactions (rate-limited to one every 2 s) via the 😀 button; they float over the board for all viewers. |
| **Final Jeopardy page** | Navigating to `/final` shows a dedicated full-screen Final Jeopardy display. |

---

### Admin panel (`/` → log in with admin password)

The admin panel has five tabs:

#### Game Control tab

- **Turn management** — buttons to set the active player or cycle to the next one.
- **Pending request banner** — appears when a player requests a cell; admin approves or denies.
- **Buzzer controls** — Activate Buzzer, Stop Buzzer, Reset Buzzers. Buzz order and ms deltas display live.
- **Open a cell** — admin can click any cell directly to open it for all viewers, bypassing the turn system.
- **Mark Answered / Wrong Answer / Close Question** — mark a cell done (dims it on the board), deduct points for a wrong answer, or close without marking.
- **Unmark a cell** — right-click (or long-press) an answered cell in admin view to restore it.
- **Drawing slideshow controls** — when a drawing question is open, admin navigates the carousel of uploaded player drawings.
- **Final Jeopardy controls** — Reveal/hide the answer, open the `/final` page in a new window, close Final Jeopardy.

#### Edit Board tab

- **Category names** — inline text inputs above each column.
- **Point values** — editable number inputs per row.
- **Column count slider** — 1–12 columns; adding columns preserves existing content.
- **Add Row** — appends a row with the next auto-incremented point value.
- **Cell editor** — click any cell to set its question text, answer text, and options:
  - **Image** (PNG, JPEG, GIF, WebP; max 5 MB). Cells with images show a picture icon.
  - **Daily Double** checkbox — player wagers before seeing the question.
  - **Drawing Question** checkbox — players upload drawings instead of a static image; admin presents them as a slideshow. Drawing cells show a ✏ icon.
- **Final Jeopardy editor** — category name, question/clue, correct answer, and optional image.

#### Players tab

- **Add player** — admin can add players manually (players can also join themselves from the main page).
- **Score table** — live score for each player with an editable number input.
- **Quick score buttons** — when a question is open, ±(point value) buttons appear for one-click score adjustment.
- **Remove player** — removes a player from the current game.

#### Sessions tab

Sessions are named folders that group uploaded images. A session must be active for players to join and for image uploads to work.

- **Create session** — give it a name (e.g. "Game Night #3"); images are saved under `uploads/<session-id>/`.
- **Set Active** — switch the active session (future uploads go here).
- **Delete session** — removes the session and all its uploaded images from disk.

#### Settings tab

- **Change admin password** — takes effect immediately; the current admin's live connection stays valid, but all tokens are revoked so reconnects require re-login.
- **Reset All Scores** — zeroes every player's score.
- **Unmark All Questions** — restores all answered cells to their unanswered state.
- **Full Game Reset** — records final scores/achievements for logged-in players, then clears questions, players, scores, and buzzers. Sessions and uploaded images are kept.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | `jeopardy` | Password for the admin panel. **Always override this in production.** |
| `PORT` | `3001` | Port the server listens on. |

---

## Architecture

```
server/index.js      Express + WebSocket server (single file, no database)
server/uploads/      Uploaded cell/final images, organized by session ID — NOT in git
server/avatars/      Player avatar images — NOT in git
server/accounts.json Player account data (usernames, hashed passwords, stats, achievements)
client/src/          React frontend (Vite build)
client/dist/         Built output served by Express — NOT in git
```

All game state is in-memory on the server and broadcast to every connected client via WebSocket whenever anything changes. Player accounts are the only data persisted to disk (beyond uploaded images). A server restart resets the board, players, and scores but preserves accounts and uploads.

---

## Security notes

- The server is designed to be internet-facing. It enforces rate limiting (60 msg/s per client), a connection cap (60), message size limits (12 MB), image magic-byte validation, and path traversal checks on all file operations.
- Admin login attempts are brute-force-protected: 5 failures per IP triggers a 15-minute block.
- Player login attempts are brute-force-protected: 10 failures per IP triggers a 10-minute block.
- Admin and player sessions use short-lived tokens (24 h, sliding window) so passwords are never retransmitted after login.
- Player passwords are hashed with scrypt (64-byte key, random 16-byte salt per account).
- Uploaded images are validated against PNG, JPEG, GIF, and WebP magic bytes before being saved.
- HTTP security headers are set on every response: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Content-Security-Policy`, `Referrer-Policy`, and `Permissions-Policy`.
