const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// ── Security headers ──
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Serve built client and uploads
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../client/dist/index.html');
  res.sendFile(indexPath, err => {
    if (err) res.status(404).send('Run `npm run build` to build the client first.');
  });
});

// ── Security constants ──
const MAX_NAME_LEN    = 50;
const MAX_IMG_B64     = 5 * 1024 * 1024; // 5 MB of base64 (~3.75 MB binary)
const MAX_MSG_BYTES   = 12 * 1024 * 1024; // 12 MB max WebSocket message
const RATE_LIMIT_MAX  = 60;              // messages/sec per client (general)
const MAX_CONNECTIONS = 60;             // concurrent WebSocket connections

// Admin login brute-force protection: 5 attempts per 5 min, then block for 15 min
const LOGIN_MAX    = 5;
const LOGIN_WINDOW = 5 * 60 * 1000;
const LOGIN_BLOCK  = 15 * 60 * 1000;
const loginAttempts = new Map(); // ip -> { count, resetAt }

// Admin session tokens (replaces storing the password in the browser)
const adminTokens = new Map(); // token -> expiresAt
const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24 hours

function generateToken() {
  const a = Math.random().toString(36).slice(2, 11);
  const b = Math.random().toString(36).slice(2, 11);
  const c = Date.now().toString(36);
  return `${a}${b}${c}`;
}

// Prune expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [tok, exp] of adminTokens) {
    if (now > exp) adminTokens.delete(tok);
  }
}, 60 * 60 * 1000);

// ── Validation helpers ──

function isNonNegInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function inCellBounds(col, row) {
  return isNonNegInt(col) && isNonNegInt(row) &&
    col < gameState.categories.length &&
    row < gameState.pointValues.length;
}

// Returns canonical absolute path if imageUrl resolves safely inside uploadsDir, else null.
function safeImagePath(imageUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('/uploads/')) return null;
  const full = path.resolve(path.join(__dirname, imageUrl.slice(1)));
  if (!full.startsWith(path.resolve(uploadsDir) + path.sep)) return null;
  return full;
}

// Validates the first bytes of decoded image data match a known image format.
function validImageBytes(buf) {
  if (buf.length < 12) return false;
  // PNG
  if (buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47) return true;
  // JPEG
  if (buf[0]===0xFF && buf[1]===0xD8 && buf[2]===0xFF) return true;
  // GIF
  if (buf[0]===0x47 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x38) return true;
  // WebP (RIFF....WEBP)
  if (buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46 &&
      buf[8]===0x57 && buf[9]===0x45 && buf[10]===0x42 && buf[11]===0x50) return true;
  return false;
}

// ── Game state ──

const NUM_COLS = 7;
const NUM_ROWS = 6;

function createDefaultCells(numCols = NUM_COLS, numRows = NUM_ROWS) {
  const cells = {};
  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < numRows; row++) {
      cells[`${col}-${row}`] = { question: '', answer: '', answered: false, image: null };
    }
  }
  return cells;
}

let gameState = {
  categories: Array.from({ length: NUM_COLS }, (_, i) => `Category ${i + 1}`),
  pointValues: [200, 400, 600, 800, 1000, 1200],
  cells: createDefaultCells(),
  players: [],
  buzzOrder: [],
  buzzerActive: false,
  activeCell: null,
  activePlayerName: null,
  pendingCellRequest: null,
  finalJeopardy: { category: 'Final Jeopardy', question: '', answer: '', image: null, active: false, answerRevealed: false },
  adminPassword: process.env.ADMIN_PASSWORD || 'jeopardy',
  sessions: [],
  currentSessionId: null,
};

// Persist scores across reconnects
const playerScores = {};

const clients = new Map();

function sanitize(state) {
  const { adminPassword, ...rest } = state;
  return rest;
}

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

wss.on('connection', (ws, req) => {
  // Enforce connection cap
  if (clients.size >= MAX_CONNECTIONS) {
    ws.close(1013, 'Server at capacity');
    return;
  }

  const id = Math.random().toString(36).slice(2, 9);
  const ip = req.socket.remoteAddress || 'unknown';
  clients.set(ws, { id, name: null, isAdmin: false, msgCount: 0, msgWindow: Date.now(), ip });

  send(ws, { type: 'state', gameState: sanitize(gameState) });

  ws.on('message', (raw) => {
    // Enforce message size limit
    if (raw.length > MAX_MSG_BYTES) return;

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const client = clients.get(ws);

    // ── Rate limiting ──
    const now = Date.now();
    if (now - client.msgWindow > 1000) {
      client.msgWindow = now;
      client.msgCount = 0;
    }
    if (++client.msgCount > RATE_LIMIT_MAX) return;

    switch (msg.type) {
      case 'join': {
        const playerName = typeof msg.name === 'string' ? msg.name.trim().slice(0, MAX_NAME_LEN) : '';
        if (!playerName) return;
        client.name = playerName;
        client.isAdmin = false;
        const existing = gameState.players.find(p => p.name === playerName);
        if (existing) {
          existing.id = client.id;
          gameState.buzzOrder.forEach(b => {
            if (b.playerName === playerName) b.playerId = client.id;
          });
        } else {
          const score = playerScores[playerName] || 0;
          gameState.players.push({ id: client.id, name: playerName, score });
        }
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        send(ws, { type: 'registered', id: client.id });
        break;
      }

      case 'admin_join': {
        if (typeof msg.password !== 'string') return;
        // Brute-force protection per source IP
        const attempts = loginAttempts.get(client.ip) || { count: 0, resetAt: Date.now() + LOGIN_WINDOW };
        if (Date.now() > attempts.resetAt) {
          attempts.count = 0;
          attempts.resetAt = Date.now() + LOGIN_BLOCK;
        }
        if (attempts.count >= LOGIN_MAX) {
          const waitMin = Math.ceil((attempts.resetAt - Date.now()) / 60000);
          send(ws, { type: 'error', message: `Too many login attempts. Try again in ${waitMin} minute(s).` });
          return;
        }
        if (msg.password !== gameState.adminPassword) {
          attempts.count++;
          loginAttempts.set(client.ip, attempts);
          send(ws, { type: 'error', message: 'Incorrect password' });
          return;
        }
        // Success: clear attempts, issue token
        loginAttempts.delete(client.ip);
        const token = generateToken();
        adminTokens.set(token, Date.now() + TOKEN_TTL);
        client.isAdmin = true;
        client.name = 'Admin';
        send(ws, { type: 'admin_registered', id: client.id, token });
        send(ws, { type: 'state', gameState });
        break;
      }

      case 'admin_rejoin': {
        // Token-based reconnect — no password re-transmission needed
        const tokenExp = typeof msg.token === 'string' ? adminTokens.get(msg.token) : null;
        if (!tokenExp || Date.now() > tokenExp) {
          send(ws, { type: 'error', message: 'Session expired — please log in again.' });
          return;
        }
        client.isAdmin = true;
        client.name = 'Admin';
        send(ws, { type: 'admin_registered', id: client.id, token: msg.token });
        send(ws, { type: 'state', gameState });
        break;
      }

      case 'buzz': {
        if (!gameState.buzzerActive) return;
        if (gameState.buzzOrder.some(b => b.playerId === client.id)) return;
        const buzzNow = Date.now();
        const firstTime = gameState.buzzOrder.length > 0 ? gameState.buzzOrder[0].time : buzzNow;
        gameState.buzzOrder.push({
          playerId: client.id,
          playerName: client.name || 'Unknown',
          time: buzzNow,
          delta: buzzNow - firstTime,
        });
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'activate_buzzer': {
        if (!client.isAdmin) return;
        gameState.buzzOrder = [];
        gameState.buzzerActive = true;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'reset_buzzers': {
        if (!client.isAdmin) return;
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'set_active_cell': {
        if (!client.isAdmin) return;
        if (msg.cell == null) {
          gameState.activeCell = null;
        } else {
          const col = parseInt(msg.cell?.col);
          const row = parseInt(msg.cell?.row);
          if (!inCellBounds(col, row)) return;
          gameState.activeCell = { col, row };
        }
        gameState.pendingCellRequest = null;
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'close_question': {
        if (!client.isAdmin) return;
        gameState.activeCell = null;
        gameState.pendingCellRequest = null;
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'mark_answered': {
        if (!client.isAdmin) return;
        if (gameState.activeCell) {
          const key = `${gameState.activeCell.col}-${gameState.activeCell.row}`;
          if (gameState.cells[key]) gameState.cells[key].answered = true;
        }
        gameState.activeCell = null;
        gameState.pendingCellRequest = null;
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'unmark_answered': {
        if (!client.isAdmin) return;
        const col = parseInt(msg.col);
        const row = parseInt(msg.row);
        if (!isFinite(col) || !isFinite(row)) return;
        const key = `${col}-${row}`;
        if (gameState.cells[key]) gameState.cells[key].answered = false;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'update_board': {
        if (!client.isAdmin) return;
        if (msg.categories !== undefined) {
          if (!Array.isArray(msg.categories)) return;
          gameState.categories = msg.categories.map(c => typeof c === 'string' ? c.slice(0, 100) : '');
        }
        if (msg.pointValues !== undefined) {
          if (!Array.isArray(msg.pointValues)) return;
          gameState.pointValues = msg.pointValues.map(v =>
            typeof v === 'number' && isFinite(v) ? Math.floor(v) : 0
          );
        }
        if (msg.cells !== undefined) {
          if (typeof msg.cells !== 'object' || msg.cells === null) return;
          gameState.cells = msg.cells;
        }
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'update_players': {
        if (!client.isAdmin) return;
        if (!Array.isArray(msg.players)) return;
        const validated = msg.players
          .filter(p => typeof p.name === 'string' && p.name.trim())
          .map(p => ({
            id: String(p.id || ''),
            name: p.name.trim().slice(0, MAX_NAME_LEN),
            score: typeof p.score === 'number' && isFinite(p.score) ? Math.floor(p.score) : 0,
          }));
        validated.forEach(p => { playerScores[p.name] = p.score; });
        gameState.players = validated;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'update_password': {
        if (!client.isAdmin) return;
        if (typeof msg.password !== 'string' || !msg.password.trim()) return;
        gameState.adminPassword = msg.password.trim().slice(0, 200);
        // Revoke all existing admin tokens so old sessions must re-authenticate
        adminTokens.clear();
        send(ws, { type: 'state', gameState });
        break;
      }

      case 'add_player': {
        if (!client.isAdmin) return;
        const pname = typeof msg.name === 'string' ? msg.name.trim().slice(0, MAX_NAME_LEN) : '';
        if (!pname) return;
        if (gameState.players.find(p => p.name === pname)) return;
        const pid = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        gameState.players.push({ id: pid, name: pname, score: playerScores[pname] || 0 });
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'set_active_player': {
        if (!client.isAdmin) return;
        if (msg.playerName === null || msg.playerName === undefined) {
          gameState.activePlayerName = null;
        } else {
          const pname = typeof msg.playerName === 'string' ? msg.playerName.trim() : '';
          if (!gameState.players.some(p => p.name === pname)) return;
          gameState.activePlayerName = pname;
        }
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'next_player': {
        if (!client.isAdmin) return;
        const players = gameState.players;
        if (players.length === 0) return;
        const currentIdx = players.findIndex(p => p.name === gameState.activePlayerName);
        const nextIdx = (currentIdx + 1) % players.length;
        gameState.activePlayerName = players[nextIdx].name;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'update_final_jeopardy': {
        if (!client.isAdmin) return;
        if (typeof msg.data !== 'object' || msg.data === null) return;
        const patch = {};
        for (const k of ['category', 'question', 'answer']) {
          if (typeof msg.data[k] === 'string') patch[k] = msg.data[k].slice(0, 2000);
        }
        gameState.finalJeopardy = { ...gameState.finalJeopardy, ...patch };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'open_final_jeopardy': {
        if (!client.isAdmin) return;
        gameState.finalJeopardy = { ...gameState.finalJeopardy, active: true, answerRevealed: false };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'close_final_jeopardy': {
        if (!client.isAdmin) return;
        gameState.finalJeopardy = { ...gameState.finalJeopardy, active: false, answerRevealed: false };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'reveal_final_answer': {
        if (!client.isAdmin) return;
        gameState.finalJeopardy = { ...gameState.finalJeopardy, answerRevealed: !gameState.finalJeopardy.answerRevealed };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'reset_game': {
        if (!client.isAdmin) return;
        gameState.cells = createDefaultCells();
        gameState.categories = Array.from({ length: NUM_COLS }, (_, i) => `Category ${i + 1}`);
        gameState.pointValues = [200, 400, 600, 800, 1000, 1200];
        gameState.players = [];
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        gameState.activeCell = null;
        gameState.activePlayerName = null;
        gameState.pendingCellRequest = null;
        gameState.finalJeopardy = { category: 'Final Jeopardy', question: '', answer: '', image: null, active: false, answerRevealed: false };
        Object.keys(playerScores).forEach(k => delete playerScores[k]);
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'reset_board': {
        if (!client.isAdmin) return;
        gameState.cells = createDefaultCells(gameState.categories.length, gameState.pointValues.length);
        gameState.activeCell = null;
        gameState.pendingCellRequest = null;
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        gameState.finalJeopardy = { ...gameState.finalJeopardy, image: null, active: false, answerRevealed: false };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      // ── Sessions ──

      case 'create_session': {
        if (!client.isAdmin) return;
        const sname = (typeof msg.name === 'string' ? msg.name.trim() : '').slice(0, 100)
          || `Session ${gameState.sessions.length + 1}`;
        const sid = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const sessionDir = path.join(uploadsDir, sid);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        const session = { id: sid, name: sname, createdAt: new Date().toISOString() };
        gameState.sessions.push(session);
        gameState.currentSessionId = sid;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'set_current_session': {
        if (!client.isAdmin) return;
        const found = gameState.sessions.find(s => s.id === msg.id);
        if (!found) return;
        gameState.currentSessionId = msg.id;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      // ── Image uploads ──

      case 'upload_image': {
        if (!client.isAdmin) return;
        if (!gameState.currentSessionId) return;
        const col = parseInt(msg.col);
        const row = parseInt(msg.row);
        if (!inCellBounds(col, row)) return;
        if (typeof msg.imageBase64 !== 'string' || msg.imageBase64.length > MAX_IMG_B64) return;
        const imgBuf = Buffer.from(msg.imageBase64, 'base64');
        if (!validImageBytes(imgBuf)) return;
        const extMap = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/jpg': 'jpg' };
        const ext = extMap[msg.mimeType] || 'jpg';
        const filename = `${col}-${row}-${Date.now()}.${ext}`;
        const sessionDir = path.join(uploadsDir, gameState.currentSessionId);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        const cellKey = `${col}-${row}`;
        const oldImage = gameState.cells[cellKey]?.image;
        if (oldImage) {
          const oldFile = safeImagePath(oldImage);
          if (oldFile) { try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch {} }
        }
        fs.writeFileSync(path.join(sessionDir, filename), imgBuf);
        const imageUrl = `/uploads/${gameState.currentSessionId}/${filename}`;
        gameState.cells = { ...gameState.cells, [cellKey]: { ...gameState.cells[cellKey], image: imageUrl } };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'remove_image': {
        if (!client.isAdmin) return;
        const col = parseInt(msg.col);
        const row = parseInt(msg.row);
        if (!inCellBounds(col, row)) return;
        const cellKey = `${col}-${row}`;
        const oldImage = gameState.cells[cellKey]?.image;
        if (oldImage) {
          const oldFile = safeImagePath(oldImage);
          if (oldFile) { try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch {} }
          gameState.cells = { ...gameState.cells, [cellKey]: { ...gameState.cells[cellKey], image: null } };
          broadcast({ type: 'state', gameState: sanitize(gameState) });
        }
        break;
      }

      // ── Turn-based cell selection ──

      case 'request_open_cell': {
        if (client.isAdmin) return;
        if (gameState.activePlayerName !== client.name) return;
        if (gameState.pendingCellRequest) return;
        if (gameState.activeCell) return;
        const col = parseInt(msg.col);
        const row = parseInt(msg.row);
        if (!inCellBounds(col, row)) return;
        const cellKey = `${col}-${row}`;
        if (!gameState.cells[cellKey] || gameState.cells[cellKey].answered) return;
        gameState.pendingCellRequest = { playerId: client.id, playerName: client.name, col, row };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'approve_cell_request': {
        if (!client.isAdmin) return;
        if (!gameState.pendingCellRequest) return;
        const { col, row } = gameState.pendingCellRequest;
        gameState.activeCell = { col, row };
        gameState.pendingCellRequest = null;
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'deny_cell_request': {
        if (!client.isAdmin) return;
        gameState.pendingCellRequest = null;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'cancel_cell_request': {
        if (!gameState.pendingCellRequest) return;
        if (gameState.pendingCellRequest.playerId !== client.id) return;
        gameState.pendingCellRequest = null;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'delete_session': {
        if (!client.isAdmin) return;
        const delIdx = gameState.sessions.findIndex(s => s.id === msg.id);
        if (delIdx === -1) return;
        const delSess = gameState.sessions[delIdx];
        const delDir = path.resolve(uploadsDir, delSess.id);
        if (!delDir.startsWith(path.resolve(uploadsDir) + path.sep)) return;
        try { if (fs.existsSync(delDir)) fs.rmSync(delDir, { recursive: true, force: true }); } catch {}
        gameState.sessions.splice(delIdx, 1);
        if (gameState.currentSessionId === delSess.id) {
          gameState.currentSessionId = gameState.sessions.length > 0
            ? gameState.sessions[gameState.sessions.length - 1].id
            : null;
        }
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'add_column': {
        if (!client.isAdmin) return;
        const newColIdx = gameState.categories.length;
        gameState.categories = [...gameState.categories, `Category ${newColIdx + 1}`];
        const newColCells = { ...gameState.cells };
        for (let r = 0; r < gameState.pointValues.length; r++) {
          newColCells[`${newColIdx}-${r}`] = { question: '', answer: '', answered: false, image: null };
        }
        gameState.cells = newColCells;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'add_row': {
        if (!client.isAdmin) return;
        const newRowIdx = gameState.pointValues.length;
        const lastVal = gameState.pointValues[newRowIdx - 1] || 200;
        const secondLast = gameState.pointValues[newRowIdx - 2] || 0;
        const step = lastVal - secondLast || 200;
        gameState.pointValues = [...gameState.pointValues, lastVal + step];
        const newRowCells = { ...gameState.cells };
        for (let c = 0; c < gameState.categories.length; c++) {
          newRowCells[`${c}-${newRowIdx}`] = { question: '', answer: '', answered: false, image: null };
        }
        gameState.cells = newRowCells;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'upload_final_image': {
        if (!client.isAdmin) return;
        if (!gameState.currentSessionId) return;
        if (typeof msg.imageBase64 !== 'string' || msg.imageBase64.length > MAX_IMG_B64) return;
        const fjBuf = Buffer.from(msg.imageBase64, 'base64');
        if (!validImageBytes(fjBuf)) return;
        const fjExtMap = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/jpg': 'jpg' };
        const fjExt = fjExtMap[msg.mimeType] || 'jpg';
        const fjFilename = `final-${Date.now()}.${fjExt}`;
        const fjDir = path.join(uploadsDir, gameState.currentSessionId);
        if (!fs.existsSync(fjDir)) fs.mkdirSync(fjDir, { recursive: true });
        const fjOld = gameState.finalJeopardy.image;
        if (fjOld) {
          const fjOldFile = safeImagePath(fjOld);
          if (fjOldFile) { try { if (fs.existsSync(fjOldFile)) fs.unlinkSync(fjOldFile); } catch {} }
        }
        fs.writeFileSync(path.join(fjDir, fjFilename), fjBuf);
        gameState.finalJeopardy = { ...gameState.finalJeopardy, image: `/uploads/${gameState.currentSessionId}/${fjFilename}` };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'remove_final_image': {
        if (!client.isAdmin) return;
        const fjOldImg = gameState.finalJeopardy.image;
        if (fjOldImg) {
          const fjOldFile = safeImagePath(fjOldImg);
          if (fjOldFile) { try { if (fs.existsSync(fjOldFile)) fs.unlinkSync(fjOldFile); } catch {} }
          gameState.finalJeopardy = { ...gameState.finalJeopardy, image: null };
          broadcast({ type: 'state', gameState: sanitize(gameState) });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client && !client.isAdmin && client.name) {
      const player = gameState.players.find(p => p.id === client.id);
      if (player) playerScores[player.name] = player.score;
    }
    clients.delete(ws);
  });

  ws.on('error', () => ws.terminate());
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenJeopardy server running at http://localhost:${PORT}`);
  console.log(`Also accessible on LAN at http://<your-ip>:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('\n⚠️  WARNING: ADMIN_PASSWORD env var is not set.');
    console.warn('   Using default password "jeopardy" — change it before exposing to the internet!');
    console.warn('   Set it with: ADMIN_PASSWORD=yourpassword node server/index.js\n');
  }
});
