'use strict';
/**
 * OpenJeopardy server tests
 * Run: ELECTRON_RUN_AS_NODE=1 /usr/share/code/code server/test.js
 */
const { spawn } = require('child_process');
const assert = require('assert');
const net = require('net');
const path = require('path');
const WebSocket = require(path.join(__dirname, 'node_modules/ws'));

const TEST_PORT = 3099;
const WS_URL = `ws://localhost:${TEST_PORT}`;

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// Returns promise that resolves when the next message arrives.
function waitForMessage(ws, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout);
    ws.once('message', data => { clearTimeout(t); resolve(JSON.parse(data)); });
  });
}

// Returns promise that resolves when a message matching `pred` arrives.
function waitForMatch(ws, pred, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout waiting for matching message')), timeout);
    const handler = data => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (pred(msg)) { clearTimeout(t); ws.off('message', handler); resolve(msg); }
    };
    ws.on('message', handler);
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// Connect and consume the mandatory initial state broadcast.
async function connectAndGetState() {
  const ws = await connect();
  const state = await waitForMessage(ws);
  assert.strictEqual(state.type, 'state');
  return ws;
}

// Admin login. Consumes both admin_registered AND the subsequent state broadcast.
async function adminConnect(password = 'testpass') {
  const ws = await connectAndGetState();
  ws.send(JSON.stringify({ type: 'admin_join', password }));
  // Server sends: admin_registered, then state (with full gameState for admin)
  const reg = await waitForMatch(ws, m => m.type === 'admin_registered');
  await waitForMatch(ws, m => m.type === 'state'); // consume the post-login state
  return { ws, token: reg.token };
}

// Get a fresh state snapshot. Uses activate_buzzer then reset_buzzers so the
// returned state reflects post-reset_buzzers values (buzzerActive: false, buzzOrder: []).
async function getLatestState(adminWs) {
  adminWs.send(JSON.stringify({ type: 'activate_buzzer' }));
  await waitForMatch(adminWs, m => m.type === 'state'); // discard activate state
  adminWs.send(JSON.stringify({ type: 'reset_buzzers' }));
  return await waitForMatch(adminWs, m => m.type === 'state'); // return clean state
}

async function resetGame(adminWs) {
  adminWs.send(JSON.stringify({ type: 'reset_game' }));
  await waitForMatch(adminWs, m => m.type === 'state');
  adminWs.send(JSON.stringify({ type: 'reset_buzzers' }));
  await waitForMatch(adminWs, m => m.type === 'state');
}

function waitForServer(port, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function tryConnect() {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        if (Date.now() - start > timeout) return reject(new Error('Server did not start in time'));
        setTimeout(tryConnect, 150);
      });
    })();
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
// FUNCTIONAL TESTS
// ═══════════════════════════════════════════════════════════════

async function runFunctionalTests() {
  console.log('\n=== Functional Tests ===\n');

  // ── Connection & initial state ──

  await test('connects and receives initial state with correct structure', async () => {
    const ws = await connect();
    const msg = await waitForMessage(ws);
    assert.strictEqual(msg.type, 'state');
    assert.ok(Array.isArray(msg.gameState.categories), 'categories must be an array');
    assert.ok(Array.isArray(msg.gameState.pointValues), 'pointValues must be an array');
    assert.ok(typeof msg.gameState.cells === 'object', 'cells must be an object');
    assert.ok(Array.isArray(msg.gameState.players), 'players must be an array');
    assert.ok(typeof msg.gameState.finalJeopardy === 'object', 'finalJeopardy must be present');
    assert.ok(typeof msg.gameState.buzzerActive === 'boolean', 'buzzerActive must be boolean');
    ws.close();
  });

  // ── Player join ──

  await test('player joins and receives registered', async () => {
    const ws = await connectAndGetState();
    // Set up both listeners before sending
    const regPromise = waitForMatch(ws, m => m.type === 'registered');
    ws.send(JSON.stringify({ type: 'join', name: 'Alice' }));
    const reg = await regPromise;
    assert.ok(typeof reg.id === 'string' && reg.id.length > 0);
    ws.close();
  });

  await test('player name is truncated to 50 characters', async () => {
    const ws = await connectAndGetState();
    const longName = 'X'.repeat(200);
    // State arrives before registered; set up listener first
    const statePromise = waitForMatch(ws, m =>
      m.type === 'state' && m.gameState.players.some(p => p.name === 'X'.repeat(50))
    );
    ws.send(JSON.stringify({ type: 'join', name: longName }));
    await statePromise;
    ws.close();
  });

  await test('empty/whitespace player name is rejected', async () => {
    const ws = await connectAndGetState();
    ws.send(JSON.stringify({ type: 'join', name: '   ' }));
    await assert.rejects(
      () => waitForMatch(ws, m => m.type === 'registered', 400),
      /Timeout/
    );
    ws.close();
  });

  await test('non-string player name is rejected', async () => {
    const ws = await connectAndGetState();
    ws.send(JSON.stringify({ type: 'join', name: 12345 }));
    await assert.rejects(
      () => waitForMatch(ws, m => m.type === 'registered', 400),
      /Timeout/
    );
    ws.close();
  });

  // ── Admin login ──

  await test('admin login succeeds with correct password', async () => {
    const { ws } = await adminConnect();
    ws.close();
  });

  await test('admin login fails with wrong password', async () => {
    const ws = await connectAndGetState();
    ws.send(JSON.stringify({ type: 'admin_join', password: 'wrongpass' }));
    const msg = await waitForMatch(ws, m => m.type === 'error');
    assert.ok(msg.message.toLowerCase().includes('incorrect'));
    ws.close();
  });

  await test('admin rejoin with valid token succeeds', async () => {
    const { ws: ws1, token } = await adminConnect();
    ws1.close();
    await delay(100);
    const ws2 = await connectAndGetState();
    ws2.send(JSON.stringify({ type: 'admin_rejoin', token }));
    const reg = await waitForMatch(ws2, m => m.type === 'admin_registered');
    assert.strictEqual(reg.token, token);
    ws2.close();
  });

  await test('admin rejoin with invalid token fails', async () => {
    const ws = await connectAndGetState();
    ws.send(JSON.stringify({ type: 'admin_rejoin', token: 'fake-token-value' }));
    const msg = await waitForMatch(ws, m => m.type === 'error');
    assert.ok(msg.message.toLowerCase().includes('expired') || msg.message.toLowerCase().includes('session'));
    ws.close();
  });

  // ── Player account system ──

  await test('player can register a new account', async () => {
    const ws = await connectAndGetState();
    const uname = `user_${Date.now()}`;
    ws.send(JSON.stringify({ type: 'register_player', username: uname, password: 'pass1234' }));
    const authMsg = await waitForMatch(ws, m => m.type === 'player_auth');
    assert.strictEqual(authMsg.username, uname);
    assert.ok(typeof authMsg.token === 'string' && authMsg.token.length > 0);
    assert.ok(authMsg.stats);
    ws.close();
  });

  await test('player registration fails with too-short password', async () => {
    const ws = await connectAndGetState();
    ws.send(JSON.stringify({ type: 'register_player', username: 'validuser99', password: 'ab' }));
    const msg = await waitForMatch(ws, m => m.type === 'auth_error');
    assert.ok(msg.message.toLowerCase().includes('password'));
    ws.close();
  });

  await test('player registration fails with invalid username characters', async () => {
    const ws = await connectAndGetState();
    ws.send(JSON.stringify({ type: 'register_player', username: 'bad/name!', password: 'pass1234' }));
    const msg = await waitForMatch(ws, m => m.type === 'auth_error');
    assert.ok(msg.message.toLowerCase().includes('username'));
    ws.close();
  });

  await test('registered player can login and rejoin with token', async () => {
    const ws = await connectAndGetState();
    const uname = `loginuser_${Date.now()}`;
    ws.send(JSON.stringify({ type: 'register_player', username: uname, password: 'pass1234' }));
    const { token } = await waitForMatch(ws, m => m.type === 'player_auth');
    ws.close();
    await delay(100);

    const ws2 = await connectAndGetState();
    ws2.send(JSON.stringify({ type: 'player_rejoin', token }));
    const rejoin = await waitForMatch(ws2, m => m.type === 'player_auth');
    assert.strictEqual(rejoin.username, uname);
    ws2.close();
  });

  await test('duplicate username registration is rejected', async () => {
    const ws1 = await connectAndGetState();
    const uname = `dup_${Date.now()}`;
    ws1.send(JSON.stringify({ type: 'register_player', username: uname, password: 'pass1234' }));
    await waitForMatch(ws1, m => m.type === 'player_auth');
    ws1.close();

    const ws2 = await connectAndGetState();
    ws2.send(JSON.stringify({ type: 'register_player', username: uname, password: 'pass5678' }));
    const msg = await waitForMatch(ws2, m => m.type === 'auth_error');
    assert.ok(msg.message.toLowerCase().includes('taken') || msg.message.toLowerCase().includes('already'));
    ws2.close();
  });

  // ── Buzzer ──

  await test('buzzer records arrival order with correct deltas', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    const p1 = await connectAndGetState();
    const p2 = await connectAndGetState();
    p1.send(JSON.stringify({ type: 'join', name: 'BuzzFirst' }));
    await waitForMatch(p1, m => m.type === 'registered');
    p2.send(JSON.stringify({ type: 'join', name: 'BuzzSecond' }));
    await waitForMatch(p2, m => m.type === 'registered');

    // Set up listener before activating buzzer
    const buzzedState = waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.buzzOrder.length >= 2
    );

    adminWs.send(JSON.stringify({ type: 'activate_buzzer' }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.buzzerActive === true);

    p1.send(JSON.stringify({ type: 'buzz' }));
    await delay(30);
    p2.send(JSON.stringify({ type: 'buzz' }));

    const s = await buzzedState;
    assert.strictEqual(s.gameState.buzzOrder[0].playerName, 'BuzzFirst');
    assert.strictEqual(s.gameState.buzzOrder[1].playerName, 'BuzzSecond');
    assert.ok(s.gameState.buzzOrder[1].delta >= 0, 'delta should be non-negative');
    assert.ok(s.gameState.buzzOrder[0].delta === 0, 'first buzz delta should be 0');

    p1.close(); p2.close();
    adminWs.send(JSON.stringify({ type: 'reset_buzzers' }));
    await waitForMatch(adminWs, m => m.type === 'state');
    adminWs.close();
  });

  await test('buzz is ignored when buzzer is inactive', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    const playerWs = await connectAndGetState();
    playerWs.send(JSON.stringify({ type: 'join', name: 'NoBuzz' }));
    await waitForMatch(playerWs, m => m.type === 'registered');

    playerWs.send(JSON.stringify({ type: 'buzz' }));
    await delay(200);

    const s = await getLatestState(adminWs);
    assert.strictEqual(s.gameState.buzzOrder.length, 0, 'Buzz ignored when buzzer inactive');

    playerWs.close(); adminWs.close();
  });

  await test('player cannot buzz twice (deduplicated)', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    adminWs.send(JSON.stringify({ type: 'activate_buzzer' }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.buzzerActive);

    const playerWs = await connectAndGetState();
    playerWs.send(JSON.stringify({ type: 'join', name: 'DoubleBuzz' }));
    await waitForMatch(playerWs, m => m.type === 'registered');

    // Set up listener before first buzz
    const firstBuzzState = waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.buzzOrder.some(b => b.playerName === 'DoubleBuzz')
    );

    playerWs.send(JSON.stringify({ type: 'buzz' }));
    await firstBuzzState; // wait for first buzz to register

    playerWs.send(JSON.stringify({ type: 'buzz' })); // second attempt (should be silently dropped)
    await delay(200);

    // stop_buzzer broadcasts state without clearing buzzOrder — safe for counting
    const stopStatePromise = waitForMatch(adminWs, m => m.type === 'state');
    adminWs.send(JSON.stringify({ type: 'stop_buzzer' }));
    const s = await stopStatePromise;
    const buzzes = s.gameState.buzzOrder.filter(b => b.playerName === 'DoubleBuzz');
    assert.strictEqual(buzzes.length, 1, 'Only one buzz entry per player');

    playerWs.close();
    adminWs.send(JSON.stringify({ type: 'reset_buzzers' }));
    await waitForMatch(adminWs, m => m.type === 'state');
    adminWs.close();
  });

  // ── Board management ──

  await test('admin can set active cell and mark it answered', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    adminWs.send(JSON.stringify({ type: 'set_active_cell', cell: { col: 0, row: 0 } }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.activeCell !== null);

    adminWs.send(JSON.stringify({ type: 'mark_answered' }));
    const s = await waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.cells['0-0']?.answered === true
    );
    assert.strictEqual(s.gameState.cells['0-0'].answered, true);
    assert.strictEqual(s.gameState.activeCell, null, 'activeCell should clear after mark_answered');

    adminWs.close();
  });

  await test('admin can unmark an answered cell', async () => {
    const { ws: adminWs } = await adminConnect();

    adminWs.send(JSON.stringify({ type: 'set_active_cell', cell: { col: 0, row: 0 } }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.activeCell !== null);
    adminWs.send(JSON.stringify({ type: 'mark_answered' }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.cells['0-0']?.answered === true);

    adminWs.send(JSON.stringify({ type: 'unmark_answered', col: 0, row: 0 }));
    const s = await waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.cells['0-0']?.answered === false
    );
    assert.strictEqual(s.gameState.cells['0-0'].answered, false);

    adminWs.close();
  });

  await test('admin can update board categories and point values', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    const newCategories = ['Science', 'History', 'Sports', 'Art', 'Music', 'Tech', 'Food'];
    const newPointValues = [100, 200, 300, 400, 500, 600];

    // Listen for the specific state that reflects our changes
    const updatedState = waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.categories[0] === 'Science'
    );
    adminWs.send(JSON.stringify({ type: 'update_board', categories: newCategories, pointValues: newPointValues }));

    const s = await updatedState;
    assert.deepStrictEqual(s.gameState.categories, newCategories);
    assert.deepStrictEqual(s.gameState.pointValues, newPointValues);

    adminWs.close();
  });

  await test('update_board cell question/answer is length-capped at 2000 chars', async () => {
    const { ws: adminWs } = await adminConnect();
    const hugeText = 'A'.repeat(5000);

    const updatedState = waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.cells['0-0']?.question.length > 0
    );
    adminWs.send(JSON.stringify({
      type: 'update_board',
      cells: { '0-0': { question: hugeText, answer: hugeText, answered: false, image: null } },
    }));

    const s = await updatedState;
    assert.strictEqual(s.gameState.cells['0-0'].question.length, 2000);
    assert.strictEqual(s.gameState.cells['0-0'].answer.length, 2000);

    adminWs.close();
  });

  await test('admin can add_column and add_row', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    // Get baseline
    const baseState = await getLatestState(adminWs);
    const origCols = baseState.gameState.categories.length;
    const origRows = baseState.gameState.pointValues.length;

    adminWs.send(JSON.stringify({ type: 'add_column' }));
    const colState = await waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.categories.length === origCols + 1
    );
    assert.strictEqual(colState.gameState.categories.length, origCols + 1);

    adminWs.send(JSON.stringify({ type: 'add_row' }));
    const rowState = await waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.pointValues.length === origRows + 1
    );
    assert.strictEqual(rowState.gameState.pointValues.length, origRows + 1);

    adminWs.close();
  });

  // ── Player management ──

  await test('admin can add a player', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    const addedState = waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.players.some(p => p.name === 'Charlie')
    );
    adminWs.send(JSON.stringify({ type: 'add_player', name: 'Charlie' }));
    await addedState;

    adminWs.close();
  });

  await test('admin can update player scores', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    adminWs.send(JSON.stringify({ type: 'add_player', name: 'Dave' }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.players.some(p => p.name === 'Dave'));

    adminWs.send(JSON.stringify({
      type: 'update_players',
      players: [{ id: '', name: 'Dave', score: 1500 }],
    }));
    const s = await waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.players.find(p => p.name === 'Dave')?.score === 1500
    );
    assert.strictEqual(s.gameState.players.find(p => p.name === 'Dave').score, 1500);

    adminWs.close();
  });

  await test('next_player cycles through player list', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    adminWs.send(JSON.stringify({ type: 'add_player', name: 'Eve' }));
    await waitForMatch(adminWs, m => m.type === 'state');
    adminWs.send(JSON.stringify({ type: 'add_player', name: 'Frank' }));
    await waitForMatch(adminWs, m => m.type === 'state');

    adminWs.send(JSON.stringify({ type: 'set_active_player', playerName: 'Eve' }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.activePlayerName === 'Eve');

    adminWs.send(JSON.stringify({ type: 'next_player' }));
    const s = await waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.activePlayerName === 'Frank'
    );
    assert.strictEqual(s.gameState.activePlayerName, 'Frank');

    adminWs.close();
  });

  // ── Sessions ──

  await test('admin can create and switch sessions', async () => {
    const { ws: adminWs } = await adminConnect();

    adminWs.send(JSON.stringify({ type: 'create_session', name: 'Session Alpha' }));
    const s1 = await waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.sessions.some(s => s.name === 'Session Alpha')
    );
    const sid = s1.gameState.sessions.find(s => s.name === 'Session Alpha').id;
    assert.strictEqual(s1.gameState.currentSessionId, sid);

    adminWs.close();
  });

  // ── Final Jeopardy ──

  await test('admin can open, update, reveal answer, and close Final Jeopardy', async () => {
    const { ws: adminWs } = await adminConnect();

    adminWs.send(JSON.stringify({ type: 'update_final_jeopardy', data: { category: 'Science', question: 'Speed of light?', answer: '~300,000 km/s' } }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.finalJeopardy.question === 'Speed of light?');

    adminWs.send(JSON.stringify({ type: 'open_final_jeopardy' }));
    const openState = await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.finalJeopardy.active === true);
    assert.strictEqual(openState.gameState.finalJeopardy.answerRevealed, false);

    adminWs.send(JSON.stringify({ type: 'reveal_final_answer' }));
    const revealState = await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.finalJeopardy.answerRevealed === true);
    assert.strictEqual(revealState.gameState.finalJeopardy.answerRevealed, true);

    adminWs.send(JSON.stringify({ type: 'close_final_jeopardy' }));
    const closeState = await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.finalJeopardy.active === false);
    assert.strictEqual(closeState.gameState.finalJeopardy.active, false);
    assert.strictEqual(closeState.gameState.finalJeopardy.answerRevealed, false);

    adminWs.close();
  });

  // ── Cell request flow ──

  await test('active player can request a cell and admin approves it', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    const playerWs = await connectAndGetState();
    playerWs.send(JSON.stringify({ type: 'join', name: 'Grace' }));
    await waitForMatch(playerWs, m => m.type === 'registered');

    adminWs.send(JSON.stringify({ type: 'set_active_player', playerName: 'Grace' }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.activePlayerName === 'Grace');

    playerWs.send(JSON.stringify({ type: 'request_open_cell', col: 0, row: 0 }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.pendingCellRequest !== null);

    adminWs.send(JSON.stringify({ type: 'approve_cell_request' }));
    const s = await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.activeCell !== null);
    assert.deepStrictEqual(s.gameState.activeCell, { col: 0, row: 0 });

    playerWs.close(); adminWs.close();
  });

  await test('admin can deny a cell request', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    const playerWs = await connectAndGetState();
    playerWs.send(JSON.stringify({ type: 'join', name: 'Heidi' }));
    await waitForMatch(playerWs, m => m.type === 'registered');

    adminWs.send(JSON.stringify({ type: 'set_active_player', playerName: 'Heidi' }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.activePlayerName === 'Heidi');

    playerWs.send(JSON.stringify({ type: 'request_open_cell', col: 1, row: 1 }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.pendingCellRequest !== null);

    adminWs.send(JSON.stringify({ type: 'deny_cell_request' }));
    const s = await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.pendingCellRequest === null);
    assert.strictEqual(s.gameState.pendingCellRequest, null);
    assert.strictEqual(s.gameState.activeCell, null, 'deny should not open the cell');

    playerWs.close(); adminWs.close();
  });
}

// ═══════════════════════════════════════════════════════════════
// SECURITY TESTS
// ═══════════════════════════════════════════════════════════════

async function runSecurityTests() {
  console.log('\n=== Security Tests ===\n');

  // ── adminPassword never leaked to clients ──

  await test('state broadcast to players never contains adminPassword', async () => {
    const ws = await connectAndGetState();
    const statePromise = waitForMatch(ws, m => m.type === 'state');
    ws.send(JSON.stringify({ type: 'join', name: 'ObserverA' }));
    const s = await statePromise;
    assert.strictEqual(s.gameState.adminPassword, undefined, 'adminPassword must be stripped from player state');
    ws.close();
  });

  // ── Admin-only operations rejected for non-admins ──

  await test('non-admin activate_buzzer is ignored', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    const playerWs = await connectAndGetState();
    playerWs.send(JSON.stringify({ type: 'join', name: 'EvilPlayer' }));
    await waitForMatch(playerWs, m => m.type === 'registered');

    playerWs.send(JSON.stringify({ type: 'activate_buzzer' }));
    await delay(200);

    const s = await getLatestState(adminWs);
    assert.strictEqual(s.gameState.buzzerActive, false, 'activate_buzzer from non-admin must be ignored');

    playerWs.close(); adminWs.close();
  });

  await test('non-admin reset_game is ignored', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);
    adminWs.send(JSON.stringify({ type: 'add_player', name: 'KeepMe' }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.players.some(p => p.name === 'KeepMe'));

    const playerWs = await connectAndGetState();
    playerWs.send(JSON.stringify({ type: 'join', name: 'Attacker' }));
    await waitForMatch(playerWs, m => m.type === 'registered');

    playerWs.send(JSON.stringify({ type: 'reset_game' }));
    await delay(200);

    const s = await getLatestState(adminWs);
    assert.ok(s.gameState.players.some(p => p.name === 'KeepMe'), 'reset_game from non-admin must be ignored');

    playerWs.close(); adminWs.close();
  });

  await test('non-admin update_board is ignored', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    const playerWs = await connectAndGetState();
    playerWs.send(JSON.stringify({ type: 'join', name: 'HackerBoard' }));
    await waitForMatch(playerWs, m => m.type === 'registered');

    playerWs.send(JSON.stringify({
      type: 'update_board',
      categories: ['Hacked', 'Hacked', 'Hacked', 'Hacked', 'Hacked', 'Hacked', 'Hacked'],
    }));
    await delay(200);

    const s = await getLatestState(adminWs);
    assert.ok(!s.gameState.categories.includes('Hacked'), 'update_board from non-admin must be ignored');

    playerWs.close(); adminWs.close();
  });

  await test('non-admin delete_session is ignored', async () => {
    const { ws: adminWs } = await adminConnect();
    adminWs.send(JSON.stringify({ type: 'create_session', name: 'DontDelete' }));
    const s1 = await waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.sessions.some(s => s.name === 'DontDelete')
    );
    const sid = s1.gameState.sessions.find(s => s.name === 'DontDelete').id;

    const playerWs = await connectAndGetState();
    playerWs.send(JSON.stringify({ type: 'join', name: 'HackerSess' }));
    await waitForMatch(playerWs, m => m.type === 'registered');

    playerWs.send(JSON.stringify({ type: 'delete_session', id: sid }));
    await delay(200);

    const s = await getLatestState(adminWs);
    assert.ok(s.gameState.sessions.some(s => s.id === sid), 'delete_session from non-admin must be ignored');

    playerWs.close(); adminWs.close();
  });

  // ── Out-of-bounds cell access ──

  await test('set_active_cell with out-of-bounds col/row is rejected', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    adminWs.send(JSON.stringify({ type: 'set_active_cell', cell: { col: 9999, row: 9999 } }));
    await delay(200);

    const s = await getLatestState(adminWs);
    assert.strictEqual(s.gameState.activeCell, null, 'Out-of-bounds cell must be rejected');

    adminWs.close();
  });

  await test('set_active_cell with negative coordinates is rejected', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    adminWs.send(JSON.stringify({ type: 'set_active_cell', cell: { col: -1, row: -1 } }));
    await delay(200);

    const s = await getLatestState(adminWs);
    assert.strictEqual(s.gameState.activeCell, null, 'Negative cell coordinates must be rejected');

    adminWs.close();
  });

  // ── Message size limit ──

  await test('oversized messages are dropped and connection stays open', async () => {
    const ws = await connect();
    await waitForMessage(ws); // initial state
    // Send 13MB message (exceeds MAX_MSG_BYTES = 12MB)
    const giant = Buffer.alloc(13 * 1024 * 1024, 0x41);
    ws.send(giant);
    await delay(500);
    assert.strictEqual(ws.readyState, WebSocket.OPEN, 'Connection should remain open after oversized message');
    ws.close();
  });

  // ── update_board validation ──

  await test('update_board rejects array as cells value', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    adminWs.send(JSON.stringify({ type: 'update_board', cells: ['injection', 'attempt'] }));
    await delay(200);

    const s = await getLatestState(adminWs);
    assert.ok(!Array.isArray(s.gameState.cells), 'cells should remain an object, not an array');

    adminWs.close();
  });

  await test('update_board strips unknown fields from cells', async () => {
    const { ws: adminWs } = await adminConnect();

    const updatedState = waitForMatch(adminWs, m =>
      m.type === 'state' && m.gameState.cells['2-2']?.question === 'ValidQ'
    );
    adminWs.send(JSON.stringify({
      type: 'update_board',
      cells: { '2-2': { question: 'ValidQ', answer: 'ValidA', answered: false, image: null, evilField: 'drop this' } },
    }));

    const s = await updatedState;
    assert.strictEqual(s.gameState.cells['2-2'].evilField, undefined, 'Extra fields must be stripped');
    assert.strictEqual(s.gameState.cells['2-2'].question, 'ValidQ');

    adminWs.close();
  });

  // ── cancel_cell_request ownership ──

  await test('only the requesting player can cancel their cell request', async () => {
    const { ws: adminWs } = await adminConnect();
    await resetGame(adminWs);

    const p1 = await connectAndGetState();
    p1.send(JSON.stringify({ type: 'join', name: 'Requester' }));
    await waitForMatch(p1, m => m.type === 'registered');

    adminWs.send(JSON.stringify({ type: 'set_active_player', playerName: 'Requester' }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.activePlayerName === 'Requester');

    p1.send(JSON.stringify({ type: 'request_open_cell', col: 0, row: 0 }));
    await waitForMatch(adminWs, m => m.type === 'state' && m.gameState.pendingCellRequest !== null);

    // Different player tries to cancel
    const p2 = await connectAndGetState();
    p2.send(JSON.stringify({ type: 'join', name: 'Thief' }));
    await waitForMatch(p2, m => m.type === 'registered');
    p2.send(JSON.stringify({ type: 'cancel_cell_request' }));
    await delay(200);

    const s = await getLatestState(adminWs);
    assert.ok(s.gameState.pendingCellRequest !== null, 'Only the requesting player can cancel their request');

    p1.close(); p2.close(); adminWs.close();
  });

  // ── Admin token security ──

  await test('admin token is 64-character cryptographic hex string', async () => {
    const { ws, token } = await adminConnect();
    assert.match(token, /^[0-9a-f]{64}$/, `Token must be 64 hex chars (crypto.randomBytes), got: "${token}"`);
    ws.close();
  });

  await test('changing admin password invalidates existing admin tokens', async () => {
    const { ws: adminWs, token: oldToken } = await adminConnect();

    // Change password
    const stateAfterChange = waitForMatch(adminWs, m => m.type === 'state');
    adminWs.send(JSON.stringify({ type: 'update_password', password: 'newpass123' }));
    await stateAfterChange;
    adminWs.close();
    await delay(100);

    // Old token should now be invalid
    const ws2 = await connectAndGetState();
    ws2.send(JSON.stringify({ type: 'admin_rejoin', token: oldToken }));
    const errMsg = await waitForMatch(ws2, m => m.type === 'error');
    assert.ok(
      errMsg.message.toLowerCase().includes('expired') || errMsg.message.toLowerCase().includes('session'),
      'Old token should be invalid after password change'
    );
    ws2.close();

    // Restore original password for subsequent tests
    const ws3 = await connectAndGetState();
    ws3.send(JSON.stringify({ type: 'admin_join', password: 'newpass123' }));
    await waitForMatch(ws3, m => m.type === 'admin_registered');
    await waitForMatch(ws3, m => m.type === 'state');
    ws3.send(JSON.stringify({ type: 'update_password', password: 'testpass' }));
    await waitForMatch(ws3, m => m.type === 'state');
    ws3.close();
  });

  // ── Brute-force lockout tests (run last — they lock 127.0.0.1) ──

  await test('admin login is locked after 5 failed attempts', async () => {
    const clients = [];
    for (let i = 0; i < 5; i++) {
      const ws = await connectAndGetState();
      ws.send(JSON.stringify({ type: 'admin_join', password: `wronglockout${i}` }));
      await waitForMatch(ws, m => m.type === 'error');
      clients.push(ws);
    }
    // 6th attempt should trigger lockout message
    const ws6 = await connectAndGetState();
    ws6.send(JSON.stringify({ type: 'admin_join', password: 'wronglockout5' }));
    const lockMsg = await waitForMatch(ws6, m => m.type === 'error');
    assert.ok(
      lockMsg.message.toLowerCase().includes('too many') || lockMsg.message.toLowerCase().includes('minute'),
      `Expected lockout message, got: "${lockMsg.message}"`
    );
    clients.push(ws6);
    clients.forEach(w => w.close());
  });

  await test('player login is locked after 10 failed attempts', async () => {
    const ws0 = await connectAndGetState();
    const targetUser = `brute_${Date.now()}`;
    ws0.send(JSON.stringify({ type: 'register_player', username: targetUser, password: 'correctpass' }));
    await waitForMatch(ws0, m => m.type === 'player_auth');
    ws0.close();

    const clients = [];
    for (let i = 0; i < 10; i++) {
      const ws = await connectAndGetState();
      ws.send(JSON.stringify({ type: 'login_player', username: targetUser, password: `bad${i}` }));
      await waitForMatch(ws, m => m.type === 'auth_error');
      clients.push(ws);
    }
    // 11th attempt — should be locked
    const ws11 = await connectAndGetState();
    ws11.send(JSON.stringify({ type: 'login_player', username: targetUser, password: 'bad11' }));
    const lockMsg = await waitForMatch(ws11, m => m.type === 'auth_error');
    assert.ok(
      lockMsg.message.toLowerCase().includes('too many'),
      `Expected lockout message, got: "${lockMsg.message}"`
    );
    clients.push(ws11);
    clients.forEach(w => w.close());
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const serverProc = spawn(
    '/usr/share/code/code',
    [path.join(__dirname, 'index.js')],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(TEST_PORT), ADMIN_PASSWORD: 'testpass' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  serverProc.stdout.on('data', () => {}); // suppress
  serverProc.stderr.on('data', () => {}); // suppress startup warnings

  try {
    await waitForServer(TEST_PORT);
    await delay(100); // small grace period

    await runFunctionalTests();
    await runSecurityTests();

  } finally {
    serverProc.kill('SIGTERM');
  }

  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('\nTest runner error:', err);
  process.exit(1);
});
