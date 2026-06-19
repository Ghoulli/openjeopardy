const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve built client in production
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../client/dist/index.html');
  res.sendFile(indexPath, err => {
    if (err) res.status(404).send('Run `npm run build` to build the client first.');
  });
});

const NUM_COLS = 7;
const NUM_ROWS = 6;

function createDefaultCells() {
  const cells = {};
  for (let col = 0; col < NUM_COLS; col++) {
    for (let row = 0; row < NUM_ROWS; row++) {
      cells[`${col}-${row}`] = { question: '', answer: '', answered: false };
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
  finalJeopardy: { category: 'Final Jeopardy', question: '', answer: '', active: false, answerRevealed: false },
  adminPassword: 'jeopardy',
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
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'close_question': {
        if (!client.isAdmin) return;
        gameState.activeCell = null;
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
        gameState.players = [];
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        gameState.activeCell = null;
        gameState.activePlayerName = null;
        gameState.finalJeopardy = { category: 'Final Jeopardy', question: '', answer: '', active: false, answerRevealed: false };
        Object.keys(playerScores).forEach(k => delete playerScores[k]);
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }

      case 'reset_board': {
        if (!client.isAdmin) return;
        gameState.cells = createDefaultCells();
        gameState.activeCell = null;
        gameState.buzzOrder = [];
        gameState.buzzerActive = false;
        gameState.finalJeopardy = { ...gameState.finalJeopardy, active: false, answerRevealed: false };
        broadcast({ type: 'state', gameState: sanitize(gameState) });
        break;
      }
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client && !client.isAdmin && client.name) {
      // Keep player in list but mark disconnected score
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
