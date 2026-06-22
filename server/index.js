const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const avatarsDir = path.join(__dirname, 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir);

// ── Accounts ──────────────────────────────────────────────────────────────────
const accountsFile = path.join(__dirname, 'accounts.json');
let accounts = {};

function loadAccounts() {
  try {
    if (fs.existsSync(accountsFile)) accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  } catch { accounts = {}; }
}

function saveAccounts() {
  try { fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2)); }
  catch (err) { console.error('Failed to save accounts:', err); }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

loadAccounts();

const playerTokens = new Map(); // token -> { username, expiresAt }
const PLAYER_TOKEN_TTL    = 24 * 60 * 60 * 1000;
const PLAYER_LOGIN_MAX    = 10;
const PLAYER_LOGIN_WINDOW = 5  * 60 * 1000;
const PLAYER_LOGIN_BLOCK  = 10 * 60 * 1000;
const playerLoginAttempts = new Map(); // ip -> { count, resetAt }

const MAX_USERNAME_LEN = 30;
const USERNAME_RE      = /^[a-zA-Z0-9 _\-.]+$/;

const ACHIEVEMENTS = [
  { id: 'first_game',  name: 'Showing Up',  desc: 'Play your first game' },
  { id: 'first_win',   name: 'First Blood', desc: 'Win your first game' },
  { id: 'veteran',     name: 'Veteran',     desc: 'Play 5 games' },
  { id: 'champion',    name: 'Champion',    desc: 'Win 3 games' },
  { id: 'legend',      name: 'Legend',      desc: 'Win 10 games' },
  { id: 'rich',        name: 'Getting Paid',desc: 'Score $5,000+ in a single game' },
  { id: 'loaded',      name: 'Loaded',      desc: 'Score $10,000+ in a single game' },
  { id: 'high_roller', name: 'High Roller', desc: 'Score $25,000+ in a single game' },
  { id: 'in_the_red',  name: 'In the Red',  desc: 'Finish a game with a negative score' },
];

function checkNewAchievements(account, gameResult) {
  const already = new Set(account.achievements);
  const s = account.stats;
  return ACHIEVEMENTS.filter(ach => {
    if (already.has(ach.id)) return false;
    switch (ach.id) {
      case 'first_game':  return s.gamesPlayed >= 1;
      case 'first_win':   return s.gamesWon >= 1;
      case 'veteran':     return s.gamesPlayed >= 5;
      case 'champion':    return s.gamesWon >= 3;
      case 'legend':      return s.gamesWon >= 10;
      case 'rich':        return gameResult.finalScore >= 5000;
      case 'loaded':      return gameResult.finalScore >= 10000;
      case 'high_roller': return gameResult.finalScore >= 25000;
      case 'in_the_red':  return gameResult.finalScore < 0;
      default:            return false;
    }
  });
}

function achDetails(ids) {
  return ids.map(id => ACHIEVEMENTS.find(a => a.id === id)).filter(Boolean);
}

// ── Security headers ──
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Restrict resource origins; allow images from self (uploads/avatars) and ws: for the game socket
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'self';"
  );
  next();
});

// Serve built client, uploads, and avatars
app.use('/uploads', express.static(uploadsDir));
app.use('/avatars', express.static(avatarsDir));
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
  return crypto.randomBytes(32).toString('hex');
}

function generatePlayerToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Prune expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [tok, exp] of adminTokens) {
    if (now > exp) adminTokens.delete(tok);
  }
  for (const [tok, data] of playerTokens) {
    if (now > data.expiresAt) playerTokens.delete(tok);
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

// Returns canonical absolute path if avatarUrl resolves safely inside avatarsDir, else null.
function safeAvatarPath(avatarUrl) {
  if (typeof avatarUrl !== 'string' || !avatarUrl.startsWith('/avatars/')) return null;
  const full = path.resolve(path.join(__dirname, avatarUrl.slice(1)));
  if (!full.startsWith(path.resolve(avatarsDir) + path.sep)) return null;
  return full;
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
      cells[`${col}-${row}`] = { question: '', answer: '', answered: false, image: null, dailyDouble: false, type: 'text' };
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
  dailyDoubleWager: null,
  finalJeopardy: { category: 'Final Jeopardy', question: '', answer: '', image: null, active: false, answerRevealed: false },
  adminPassword: process.env.ADMIN_PASSWORD || 'jeopardy',
  sessions: [],
  currentSessionId: null,
  drawingCarousel: { cellKey: null, images: [], currentIndex: -1 },
};

// Persist scores across reconnects
const playerScores = {};

// ── Game metrics (tracked within a game, reset on reset_game) ──
let gameMetrics = {
  buzzerActivatedAt: null,
  playerData: {}, // name -> { minScore, maxScore, maxStreak, firstBuzzCount, reactionTimes[] }
};

function initPlayerMetric(name, score = 0) {
  if (!gameMetrics.playerData[name]) {
    gameMetrics.playerData[name] = { minScore: score, maxScore: score, maxStreak: 0, firstBuzzCount: 0, reactionTimes: [] };
  }
}

function trackScore(name, score) {
  initPlayerMetric(name, score);
  const d = gameMetrics.playerData[name];
  if (score < d.minScore) d.minScore = score;
  if (score > d.maxScore) d.maxScore = score;
}

function trackStreak(name, streak) {
  initPlayerMetric(name);
  const d = gameMetrics.playerData[name];
  if (streak > d.maxStreak) d.maxStreak = streak;
}

function computeEndScreen() {
  const players = gameState.players;
  if (players.length === 0) return { sortedPlayers: [], awards: [], playerStats: [] };

  const sorted = [...players].sort((a, b) => b.score - a.score);

  const stats = players.map(p => {
    const d = gameMetrics.playerData[p.name] || { minScore: p.score, maxScore: p.score, maxStreak: 0, firstBuzzCount: 0, reactionTimes: [] };
    const rts = d.reactionTimes;
    const avgReaction = rts.length > 0 ? Math.round(rts.reduce((s, v) => s + v, 0) / rts.length) : null;
    const bestReaction = rts.length > 0 ? Math.min(...rts) : null;
    return {
      name: p.name,
      score: p.score,
      avatarUrl: p.avatarUrl || null,
      minScore: d.minScore,
      maxScore: d.maxScore,
      swing: d.maxScore - d.minScore,
      comeback: p.score - d.minScore,
      drop: d.maxScore - p.score,
      maxStreak: d.maxStreak,
      currentStreak: p.streak || 0,
      firstBuzzCount: d.firstBuzzCount,
      buzzCount: rts.length,
      avgReaction,
      bestReaction,
    };
  });

  const awards = [];
  const byScore = [...stats].sort((a, b) => b.score - a.score);

  if (byScore.length > 0) {
    const w = byScore[0];
    awards.push({ icon: '🏆', title: 'Champion', player: w.name, detail: `Finished with $${w.score.toLocaleString()}` });
  }

  const bySwing = [...stats].sort((a, b) => b.swing - a.swing);
  if (bySwing[0]?.swing >= 400) {
    const s = bySwing[0];
    awards.push({ icon: '🎢', title: 'Wild Ride', player: s.name, detail: `$${s.swing.toLocaleString()} total swing` });
  }

  const byComeback = [...stats].sort((a, b) => b.comeback - a.comeback);
  if (byComeback[0]?.comeback >= 200) {
    const c = byComeback[0];
    const lowFmt = c.minScore < 0 ? `-$${Math.abs(c.minScore).toLocaleString()}` : `$${c.minScore.toLocaleString()}`;
    awards.push({ icon: '📈', title: 'Comeback Kid', player: c.name, detail: `From ${lowFmt} back to $${c.score.toLocaleString()}` });
  }

  const byDrop = [...stats].sort((a, b) => b.drop - a.drop);
  const chokeCandidate = byDrop.find(s => s.drop >= 400 && (byScore.length < 2 || s.name !== byScore[0].name));
  if (chokeCandidate) {
    awards.push({ icon: '💸', title: 'So Close…', player: chokeCandidate.name, detail: `Peaked at $${chokeCandidate.maxScore.toLocaleString()}, ended $${chokeCandidate.drop.toLocaleString()} lower` });
  }

  const byBuzz = [...stats].sort((a, b) => b.firstBuzzCount - a.firstBuzzCount);
  if (byBuzz[0]?.firstBuzzCount > 0) {
    const b = byBuzz[0];
    awards.push({ icon: '⚡', title: 'Buzzer King', player: b.name, detail: `Buzzed first ${b.firstBuzzCount} time${b.firstBuzzCount !== 1 ? 's' : ''}` });
  }

  const fastBuzzers = stats.filter(s => s.firstBuzzCount > 0 && s.avgReaction !== null);
  if (fastBuzzers.length > 0) {
    const fastest = [...fastBuzzers].sort((a, b) => a.avgReaction - b.avgReaction)[0];
    awards.push({ icon: '🚀', title: 'Fastest Fingers', player: fastest.name, detail: `${(fastest.avgReaction / 1000).toFixed(2)}s avg reaction` });
  }

  const byStreak = [...stats].sort((a, b) => b.maxStreak - a.maxStreak);
  if (byStreak[0]?.maxStreak >= 2) {
    const s = byStreak[0];
    awards.push({ icon: '🔥', title: 'On Fire', player: s.name, detail: `${s.maxStreak} correct in a row` });
  }

  if (byScore.length >= 2) {
    const last = byScore[byScore.length - 1];
    if (last.score < 0) {
      awards.push({ icon: '📉', title: 'In the Red', player: last.name, detail: `-$${Math.abs(last.score).toLocaleString()}` });
    }
  }

  return {
    sortedPlayers: sorted.map(p => ({ name: p.name, score: p.score, avatarUrl: p.avatarUrl || null })),
    awards,
    playerStats: stats,
  };
}

const clients = new Map();

function joinAsPlayer(ws, client, displayName) {
  client.name = displayName;
  client.isAdmin = false;
  const avatarUrl = (client.username && accounts[client.username]?.avatarUrl) || null;
  const existing = gameState.players.find(p => p.name === displayName);
  if (existing) {
    existing.id = client.id;
    if (avatarUrl !== null) existing.avatarUrl = avatarUrl;
    gameState.buzzOrder.forEach(b => { if (b.playerName === displayName) b.playerId = client.id; });
  } else {
    const startScore = playerScores[displayName] || 0;
    gameState.players.push({ id: client.id, name: displayName, score: startScore, avatarUrl, streak: 0 });
    initPlayerMetric(displayName, startScore);
  }
  broadcast({ type: 'state', gameState: sanitize(gameState) });
  send(ws, { type: 'registered', id: client.id });
}

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
  clients.set(ws, { id, name: null, isAdmin: false, username: null, msgCount: 0, msgWindow: Date.now(), ip, lastReactionAt: 0 });

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
        joinAsPlayer(ws, client, playerName);
        break;
      }

      case 'register_player': {
        const uname = typeof msg.username === 'string' ? msg.username.trim().slice(0, MAX_USERNAME_LEN) : '';
        const pw = typeof msg.password === 'string' ? msg.password : '';
        if (uname.length < 2 || !USERNAME_RE.test(uname)) {
          send(ws, { type: 'auth_error', message: 'Username must be 2–30 characters (letters, numbers, spaces, _ - .)' });
          return;
        }
        if (pw.length < 4 || pw.length > 200) {
          send(ws, { type: 'auth_error', message: 'Password must be 4–200 characters.' });
          return;
        }
        if (accounts[uname]) {
          send(ws, { type: 'auth_error', message: 'Username already taken.' });
          return;
        }
        const salt = crypto.randomBytes(16).toString('hex');
        accounts[uname] = {
          passwordHash: hashPassword(pw, salt), salt,
          stats: { totalEarnings: 0, gamesPlayed: 0, gamesWon: 0, highScore: 0 },
          achievements: [],
        };
        saveAccounts();
        const regTok = generatePlayerToken();
        playerTokens.set(regTok, { username: uname, expiresAt: Date.now() + PLAYER_TOKEN_TTL });
        client.username = uname;
        send(ws, { type: 'player_auth', token: regTok, username: uname, stats: accounts[uname].stats, achievements: [], avatarUrl: null });
        joinAsPlayer(ws, client, uname);
        break;
      }

      case 'login_player': {
        const uname = typeof msg.username === 'string' ? msg.username.trim().slice(0, MAX_USERNAME_LEN) : '';
        const pw = typeof msg.password === 'string' ? msg.password : '';
        const plAtt = playerLoginAttempts.get(client.ip) || { count: 0, resetAt: Date.now() + PLAYER_LOGIN_WINDOW };
        if (Date.now() > plAtt.resetAt) { plAtt.count = 0; plAtt.resetAt = Date.now() + PLAYER_LOGIN_BLOCK; }
        if (plAtt.count >= PLAYER_LOGIN_MAX) {
          const waitSec = Math.ceil((plAtt.resetAt - Date.now()) / 1000);
          send(ws, { type: 'auth_error', message: `Too many login attempts. Try again in ${waitSec}s.` });
          return;
        }
        if (!accounts[uname] || hashPassword(pw, accounts[uname].salt) !== accounts[uname].passwordHash) {
          plAtt.count++;
          playerLoginAttempts.set(client.ip, plAtt);
          send(ws, { type: 'auth_error', message: 'Invalid username or password.' });
          return;
        }
        playerLoginAttempts.delete(client.ip);
        const loginTok = generatePlayerToken();
        playerTokens.set(loginTok, { username: uname, expiresAt: Date.now() + PLAYER_TOKEN_TTL });
        client.username = uname;
        const loginAcct = accounts[uname];
        send(ws, { type: 'player_auth', token: loginTok, username: uname, stats: loginAcct.stats, achievements: achDetails(loginAcct.achievements), avatarUrl: loginAcct.avatarUrl || null });
        joinAsPlayer(ws, client, uname);
        break;
      }

      case 'player_rejoin': {
        const tokData = typeof msg.token === 'string' ? playerTokens.get(msg.token) : null;
        if (!tokData || Date.now() > tokData.expiresAt) {
          send(ws, { type: 'auth_error', message: 'Session expired — please log in again.' });
          return;
        }
        tokData.expiresAt = Date.now() + PLAYER_TOKEN_TTL; // sliding window
        const uname = tokData.username;
        if (!accounts[uname]) {
          playerTokens.delete(msg.token);
          send(ws, { type: 'auth_error', message: 'Account not found.' });
          return;
        }
        client.username = uname;
        const rejoinAcct = accounts[uname];
        send(ws, { type: 'player_auth', token: msg.token, username: uname, stats: rejoinAcct.stats, achievements: achDetails(rejoinAcct.achievements), avatarUrl: rejoinAcct.avatarUrl || null });
        joinAsPlayer(ws, client, uname);
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
        const isFirst = gameState.buzzOrder.length === 0;
        const firstTime = isFirst ? buzzNow : gameState.buzzOrder[0].time;
        if (gameMetrics.buzzerActivatedAt) {
          const rt = buzzNow - gameMetrics.buzzerActivatedAt;
          const pname = client.name || 'Unknown';
          initPlayerMetric(pname);
          const d = gameMetrics.playerData[pname];
          d.reactionTimes.push(rt);
          if (isFirst) d.firstBuzzCount++;
        }
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
        gameMetrics.buzzerActivatedAt = Date.now();
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

      case 'stop_buzzer': {
        if (!client.isAdmin) return;
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
          const cellKey = `${col}-${row}`;
          if (gameState.cells[cellKey]?.type === 'drawing' && gameState.drawingCarousel.cellKey !== cellKey) {
            gameState.drawingCarousel = { cellKey, images: [], currentIndex: -1 };
          }
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
        gameState.dailyDoubleWager = null;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'mark_answered': {
        if (!client.isAdmin) return;
        if (gameState.activeCell) {
          const { col, row } = gameState.activeCell;
          const key = `${col}-${row}`;
          if (gameState.cells[key]) gameState.cells[key].answered = true;

          const isDailyDouble = gameState.cells[key]?.dailyDouble;
          let correctPlayerName = null;

          if (isDailyDouble && gameState.dailyDoubleWager) {
            correctPlayerName = gameState.activePlayerName;
            const ddPlayer = gameState.players.find(p => p.name === correctPlayerName);
            if (ddPlayer) {
              ddPlayer.score += gameState.dailyDoubleWager;
              playerScores[ddPlayer.name] = ddPlayer.score;
              trackScore(ddPlayer.name, ddPlayer.score);
            }
          } else if (!isDailyDouble && gameState.buzzOrder.length > 0) {
            correctPlayerName = gameState.buzzOrder[0].playerName;
          }

          if (correctPlayerName) {
            const streakPlayer = gameState.players.find(p => p.name === correctPlayerName);
            if (streakPlayer) {
              streakPlayer.streak = (streakPlayer.streak || 0) + 1;
              trackStreak(streakPlayer.name, streakPlayer.streak);
            }
          }
        }
        gameState.activeCell = null;
        gameState.pendingCellRequest = null;
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        gameState.dailyDoubleWager = null;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'unmark_answered': {
        if (!client.isAdmin) return;
        const col = parseInt(msg.col);
        const row = parseInt(msg.row);
        if (!inCellBounds(col, row)) return;
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
          if (typeof msg.cells !== 'object' || msg.cells === null || Array.isArray(msg.cells)) return;
          const validatedCells = {};
          for (const [key, cell] of Object.entries(msg.cells)) {
            if (typeof cell !== 'object' || cell === null) continue;
            validatedCells[key] = {
              question:    typeof cell.question === 'string' ? cell.question.slice(0, 2000) : '',
              answer:      typeof cell.answer   === 'string' ? cell.answer.slice(0, 2000)   : '',
              answered:    cell.answered === true,
              image:       typeof cell.image === 'string' ? cell.image : null,
              dailyDouble: gameState.cells[key]?.dailyDouble === true, // preserve via toggle_daily_double
              type:        gameState.cells[key]?.type || 'text',       // preserve via toggle_drawing_type
            };
          }
          gameState.cells = validatedCells;
        }
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'update_players': {
        if (!client.isAdmin) return;
        if (!Array.isArray(msg.players)) return;
        const validated = msg.players
          .filter(p => typeof p.name === 'string' && p.name.trim())
          .map(p => {
            const existing = gameState.players.find(pl => pl.name === p.name.trim().slice(0, MAX_NAME_LEN));
            return {
              id: String(p.id || ''),
              name: p.name.trim().slice(0, MAX_NAME_LEN),
              score: typeof p.score === 'number' && isFinite(p.score) ? Math.floor(p.score) : 0,
              avatarUrl: existing?.avatarUrl || null,
              streak: existing?.streak || 0,
            };
          });
        validated.forEach(p => { playerScores[p.name] = p.score; trackScore(p.name, p.score); });
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
        const pstartScore = playerScores[pname] || 0;
        gameState.players.push({ id: pid, name: pname, score: pstartScore, streak: 0 });
        initPlayerMetric(pname, pstartScore);
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

      case 'show_end_screen': {
        if (!client.isAdmin) return;
        const endScreen = computeEndScreen();
        gameState.finalJeopardy = { ...gameState.finalJeopardy, showEndScreen: true, endScreen };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'hide_end_screen': {
        if (!client.isAdmin) return;
        gameState.finalJeopardy = { ...gameState.finalJeopardy, showEndScreen: false, endScreen: null };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'reset_game': {
        if (!client.isAdmin) return;
        // Record game results for logged-in players before clearing
        if (gameState.players.length > 0) {
          const maxScore = Math.max(...gameState.players.map(p => p.score));
          const winnerNames = new Set(gameState.players.filter(p => p.score === maxScore).map(p => p.name));
          for (const [playerWs, c] of clients) {
            if (!c.username || !accounts[c.username]) continue;
            const entry = gameState.players.find(p => p.name === c.name);
            if (!entry) continue;
            const finalScore = entry.score;
            const isWinner = winnerNames.has(c.name);
            const acct = accounts[c.username];
            acct.stats.gamesPlayed++;
            acct.stats.totalEarnings += finalScore;
            if (isWinner) acct.stats.gamesWon++;
            if (finalScore > acct.stats.highScore) acct.stats.highScore = finalScore;
            const newAchs = checkNewAchievements(acct, { finalScore, isWinner });
            newAchs.forEach(a => acct.achievements.push(a.id));
            if (newAchs.length > 0) send(playerWs, { type: 'achievements_unlocked', achievements: newAchs });
            send(playerWs, { type: 'stats_updated', stats: acct.stats, achievements: achDetails(acct.achievements) });
          }
          saveAccounts();
        }
        gameState.cells = createDefaultCells();
        gameState.categories = Array.from({ length: NUM_COLS }, (_, i) => `Category ${i + 1}`);
        gameState.pointValues = [200, 400, 600, 800, 1000, 1200];
        gameState.players = [];
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        gameState.activeCell = null;
        gameState.activePlayerName = null;
        gameState.pendingCellRequest = null;
        gameState.dailyDoubleWager = null;
        gameState.finalJeopardy = { category: 'Final Jeopardy', question: '', answer: '', image: null, active: false, answerRevealed: false };
        gameState.drawingCarousel = { cellKey: null, images: [], currentIndex: -1 };
        Object.keys(playerScores).forEach(k => delete playerScores[k]);
        gameMetrics = { buzzerActivatedAt: null, playerData: {} };
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
        gameState.drawingCarousel = { cellKey: null, images: [], currentIndex: -1 };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      // ── Sessions ──

      case 'create_session': {
        if (!client.isAdmin) return;
        const sname = (typeof msg.name === 'string' ? msg.name.trim() : '').slice(0, 100)
          || `Session ${gameState.sessions.length + 1}`;
        const sid = `s-${crypto.randomBytes(8).toString('hex')}`;
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

      case 'toggle_drawing_type': {
        if (!client.isAdmin) return;
        const col = parseInt(msg.col);
        const row = parseInt(msg.row);
        if (!inCellBounds(col, row)) return;
        const key = `${col}-${row}`;
        if (!gameState.cells[key]) return;
        const newType = (gameState.cells[key].type || 'text') === 'drawing' ? 'text' : 'drawing';
        gameState.cells = { ...gameState.cells, [key]: { ...gameState.cells[key], type: newType } };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'upload_drawing': {
        if (!client.name) return;
        if (!gameState.currentSessionId) return;
        if (!gameState.activeCell) return;
        const activeCellKey = `${gameState.activeCell.col}-${gameState.activeCell.row}`;
        if (gameState.cells[activeCellKey]?.type !== 'drawing') return;
        if (gameState.drawingCarousel.images.length >= 50) return;
        if (typeof msg.imageBase64 !== 'string' || msg.imageBase64.length > MAX_IMG_B64) return;
        const drBuf = Buffer.from(msg.imageBase64, 'base64');
        if (!validImageBytes(drBuf)) return;
        const drExtMap = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/jpg': 'jpg' };
        const drExt = drExtMap[msg.mimeType] || 'jpg';
        const sessionDir = path.join(uploadsDir, gameState.currentSessionId);
        const drawingsDir = path.join(sessionDir, 'drawings');
        if (!fs.existsSync(drawingsDir)) fs.mkdirSync(drawingsDir, { recursive: true });
        const safeName = (client.name || 'player').replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 20);
        const drFilename = `${Date.now()}-${safeName}.${drExt}`;
        fs.writeFileSync(path.join(drawingsDir, drFilename), drBuf);
        const drUrl = `/uploads/${gameState.currentSessionId}/drawings/${drFilename}`;
        gameState.drawingCarousel = {
          ...gameState.drawingCarousel,
          images: [...gameState.drawingCarousel.images, { url: drUrl, playerName: client.name }],
        };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'set_carousel_index': {
        if (!client.isAdmin) return;
        const idx = parseInt(msg.index);
        if (!isFinite(idx)) return;
        if (idx !== -1 && (idx < 0 || idx >= gameState.drawingCarousel.images.length)) return;
        gameState.drawingCarousel = { ...gameState.drawingCarousel, currentIndex: idx };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
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
        const approvedKey = `${col}-${row}`;
        if (gameState.cells[approvedKey]?.type === 'drawing' && gameState.drawingCarousel.cellKey !== approvedKey) {
          gameState.drawingCarousel = { cellKey: approvedKey, images: [], currentIndex: -1 };
        }
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

      case 'toggle_daily_double': {
        if (!client.isAdmin) return;
        const ddCol = parseInt(msg.col);
        const ddRow = parseInt(msg.row);
        if (!inCellBounds(ddCol, ddRow)) return;
        const ddKey = `${ddCol}-${ddRow}`;
        if (gameState.cells[ddKey]) {
          gameState.cells[ddKey] = { ...gameState.cells[ddKey], dailyDouble: !gameState.cells[ddKey].dailyDouble };
        }
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'set_daily_double_wager': {
        if (!gameState.activeCell) return;
        const ddCellKey = `${gameState.activeCell.col}-${gameState.activeCell.row}`;
        if (!gameState.cells[ddCellKey]?.dailyDouble) return;
        const isActivePlayer = client.name === gameState.activePlayerName;
        if (!client.isAdmin && !isActivePlayer) return;
        const wager = parseInt(msg.wager);
        if (!isFinite(wager) || wager < 1) return;
        gameState.dailyDoubleWager = wager;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'wrong_answer': {
        if (!client.isAdmin) return;
        if (!gameState.activeCell) return;
        const { col: waCol, row: waRow } = gameState.activeCell;
        const waKey = `${waCol}-${waRow}`;
        const waCell = gameState.cells[waKey];
        const waPoints = gameState.pointValues[waRow];
        const waIsDd = waCell?.dailyDouble;

        let waTarget = null;
        let waDeduction = 0;

        if (waIsDd) {
          waTarget = gameState.activePlayerName;
          waDeduction = gameState.dailyDoubleWager || waPoints;
        } else {
          if (gameState.buzzOrder.length === 0) return;
          waTarget = gameState.buzzOrder[0].playerName;
          waDeduction = waPoints;
        }

        if (waTarget) {
          const waPlayer = gameState.players.find(p => p.name === waTarget);
          if (waPlayer) {
            waPlayer.score -= waDeduction;
            playerScores[waPlayer.name] = waPlayer.score;
            trackScore(waPlayer.name, waPlayer.score);
            waPlayer.streak = 0;
          }
        }

        gameState.buzzOrder = [];
        gameState.buzzerActive = false;

        if (waIsDd) {
          // DD wrong answer ends the question
          if (gameState.cells[waKey]) gameState.cells[waKey].answered = true;
          gameState.activeCell = null;
          gameState.pendingCellRequest = null;
          gameState.dailyDoubleWager = null;
        }

        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'player_reaction': {
        if (!client.name) return;
        if (typeof msg.emoji !== 'string' || msg.emoji.length > 12) return;
        const reactionNow = Date.now();
        if (reactionNow - client.lastReactionAt < 2000) return;
        client.lastReactionAt = reactionNow;
        broadcast({ type: 'player_reaction', playerName: client.name, emoji: msg.emoji });
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
          newColCells[`${newColIdx}-${r}`] = { question: '', answer: '', answered: false, image: null, dailyDouble: false, type: 'text' };
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
          newRowCells[`${c}-${newRowIdx}`] = { question: '', answer: '', answered: false, image: null, dailyDouble: false, type: 'text' };
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

      case 'upload_avatar': {
        if (!client.username || !accounts[client.username]) return;
        if (typeof msg.imageBase64 !== 'string' || msg.imageBase64.length > MAX_IMG_B64) return;
        const avBuf = Buffer.from(msg.imageBase64, 'base64');
        if (!validImageBytes(avBuf)) return;
        const avExtMap = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/jpg': 'jpg' };
        const avExt = avExtMap[msg.mimeType] || 'jpg';
        const safeUname = client.username.replace(/[^a-zA-Z0-9_\-.]/g, '_');
        const avFilename = `${safeUname}.${avExt}`;
        const oldAvatarUrl = accounts[client.username].avatarUrl;
        if (oldAvatarUrl) {
          const oldAvFile = safeAvatarPath(oldAvatarUrl);
          if (oldAvFile) { try { if (fs.existsSync(oldAvFile)) fs.unlinkSync(oldAvFile); } catch {} }
        }
        fs.writeFileSync(path.join(avatarsDir, avFilename), avBuf);
        const newAvatarUrl = `/avatars/${avFilename}`;
        accounts[client.username].avatarUrl = newAvatarUrl;
        saveAccounts();
        const avPlayer = gameState.players.find(p => p.name === client.name);
        if (avPlayer) avPlayer.avatarUrl = newAvatarUrl;
        send(ws, { type: 'avatar_updated', avatarUrl: newAvatarUrl });
        broadcast({ type: 'state', gameState: sanitize(gameState) });
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
