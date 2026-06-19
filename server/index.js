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

// Serve built client and uploads
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../client/dist/index.html');
  res.sendFile(indexPath, err => {
    if (err) res.status(404).send('Run `npm run build` to build the client first.');
  });
});

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
  adminPassword: 'jeopardy',
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

wss.on('connection', (ws) => {
  const id = Math.random().toString(36).slice(2, 9);
  clients.set(ws, { id, name: null, isAdmin: false });

  send(ws, { type: 'state', gameState: sanitize(gameState) });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const client = clients.get(ws);

    switch (msg.type) {
      case 'join': {
        client.name = msg.name;
        client.isAdmin = false;
        const existing = gameState.players.find(p => p.name === msg.name);
        if (existing) {
          existing.id = client.id;
          gameState.buzzOrder.forEach(b => {
            if (b.playerName === msg.name) b.playerId = client.id;
          });
        } else {
          const score = playerScores[msg.name] || 0;
          gameState.players.push({ id: client.id, name: msg.name, score });
        }
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        send(ws, { type: 'registered', id: client.id });
        break;
      }

      case 'admin_join': {
        if (msg.password !== gameState.adminPassword) {
          send(ws, { type: 'error', message: 'Incorrect password' });
          return;
        }
        client.isAdmin = true;
        client.name = 'Admin';
        send(ws, { type: 'admin_registered', id: client.id });
        send(ws, { type: 'state', gameState });
        break;
      }

      case 'buzz': {
        if (!gameState.buzzerActive) return;
        if (gameState.buzzOrder.some(b => b.playerId === client.id)) return;
        const now = Date.now();
        const firstTime = gameState.buzzOrder.length > 0 ? gameState.buzzOrder[0].time : now;
        gameState.buzzOrder.push({
          playerId: client.id,
          playerName: client.name || 'Unknown',
          time: now,
          delta: now - firstTime,
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
        gameState.activeCell = msg.cell;
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

      case 'update_board': {
        if (!client.isAdmin) return;
        if (msg.categories) gameState.categories = msg.categories;
        if (msg.pointValues) gameState.pointValues = msg.pointValues;
        if (msg.cells) gameState.cells = msg.cells;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'update_players': {
        if (!client.isAdmin) return;
        msg.players.forEach(p => { playerScores[p.name] = p.score; });
        gameState.players = msg.players;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'update_password': {
        if (!client.isAdmin) return;
        gameState.adminPassword = msg.password;
        send(ws, { type: 'state', gameState });
        break;
      }

      case 'add_player': {
        if (!client.isAdmin) return;
        const pname = (msg.name || '').trim();
        if (!pname) return;
        if (gameState.players.find(p => p.name === pname)) return;
        const pid = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        gameState.players.push({ id: pid, name: pname, score: playerScores[pname] || 0 });
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'set_active_player': {
        if (!client.isAdmin) return;
        gameState.activePlayerName = msg.playerName;
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
        gameState.finalJeopardy = { ...gameState.finalJeopardy, ...msg.data };
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
        const sname = (msg.name || '').trim() || `Session ${gameState.sessions.length + 1}`;
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
        const { col, row, imageBase64, mimeType } = msg;
        const extMap = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/jpg': 'jpg' };
        const ext = extMap[mimeType] || 'jpg';
        const filename = `${col}-${row}-${Date.now()}.${ext}`;
        const sessionDir = path.join(uploadsDir, gameState.currentSessionId);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        // Remove old image file if one exists
        const cellKey = `${col}-${row}`;
        const oldImage = gameState.cells[cellKey]?.image;
        if (oldImage) {
          const oldFile = path.join(__dirname, oldImage.replace(/^\//, ''));
          try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch {}
        }
        fs.writeFileSync(path.join(sessionDir, filename), Buffer.from(imageBase64, 'base64'));
        const imageUrl = `/uploads/${gameState.currentSessionId}/${filename}`;
        gameState.cells = { ...gameState.cells, [cellKey]: { ...gameState.cells[cellKey], image: imageUrl } };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'remove_image': {
        if (!client.isAdmin) return;
        const { col, row } = msg;
        const cellKey = `${col}-${row}`;
        const oldImage = gameState.cells[cellKey]?.image;
        if (oldImage) {
          const oldFile = path.join(__dirname, oldImage.replace(/^\//, ''));
          try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch {}
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
        const { col, row } = msg;
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
        const delDir = path.join(uploadsDir, delSess.id);
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
        const { imageBase64: fjBase64, mimeType: fjMime } = msg;
        const fjExtMap = { 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/jpg': 'jpg' };
        const fjExt = fjExtMap[fjMime] || 'jpg';
        const fjFilename = `final-${Date.now()}.${fjExt}`;
        const fjDir = path.join(uploadsDir, gameState.currentSessionId);
        if (!fs.existsSync(fjDir)) fs.mkdirSync(fjDir, { recursive: true });
        const fjOld = gameState.finalJeopardy.image;
        if (fjOld) {
          const fjOldFile = path.join(__dirname, fjOld.replace(/^\//, ''));
          try { if (fs.existsSync(fjOldFile)) fs.unlinkSync(fjOldFile); } catch {}
        }
        fs.writeFileSync(path.join(fjDir, fjFilename), Buffer.from(fjBase64, 'base64'));
        gameState.finalJeopardy = { ...gameState.finalJeopardy, image: `/uploads/${gameState.currentSessionId}/${fjFilename}` };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'remove_final_image': {
        if (!client.isAdmin) return;
        const fjOldImg = gameState.finalJeopardy.image;
        if (fjOldImg) {
          const fjOldFile = path.join(__dirname, fjOldImg.replace(/^\//, ''));
          try { if (fs.existsSync(fjOldFile)) fs.unlinkSync(fjOldFile); } catch {}
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
});
