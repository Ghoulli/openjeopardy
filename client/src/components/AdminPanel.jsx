import { useState } from 'react'
import Board from './Board'
import BuzzerDisplay from './BuzzerDisplay'
import QuestionModal from './QuestionModal'

export default function AdminPanel({ gameState, send, onLeave, wsStatus }) {
  const [tab, setTab] = useState('game')
  const [editingCell, setEditingCell] = useState(null)
  const [editQ, setEditQ] = useState('')
  const [editA, setEditA] = useState('')
  const [newPlayerName, setNewPlayerName] = useState('')
  const [newPw, setNewPw] = useState('')

  const activeCell = gameState?.activeCell
  const activeCellData = activeCell
    ? gameState.cells[`${activeCell.col}-${activeCell.row}`]
    : null

  function openCellEdit(col, row) {
    const cell = gameState.cells[`${col}-${row}`]
    setEditingCell({ col, row })
    setEditQ(cell?.question || '')
    setEditA(cell?.answer || '')
  }

  function saveCell() {
    const newCells = { ...gameState.cells }
    const key = `${editingCell.col}-${editingCell.row}`
    newCells[key] = { ...newCells[key], question: editQ, answer: editA }
    send({ type: 'update_board', cells: newCells })
    setEditingCell(null)
  }

  function handleGameCellClick(col, row) {
    send({ type: 'set_active_cell', cell: { col, row } })
  }

  function handleFinalClick() {
    send({ type: 'open_final_jeopardy' })
    window.open('/final', 'final_jeopardy', 'noopener,noreferrer')
  }

  function addPlayer() {
    const name = newPlayerName.trim()
    if (!name) return
    send({ type: 'add_player', name })
    setNewPlayerName('')
  }

  function removePlayer(id) {
    send({ type: 'update_players', players: gameState.players.filter(p => p.id !== id) })
  }

  function updateScore(id, val) {
    send({
      type: 'update_players',
      players: gameState.players.map(p => p.id === id ? { ...p, score: parseInt(val) || 0 } : p),
    })
  }

  function quickScore(id, delta) {
    const player = gameState.players.find(p => p.id === id)
    if (player) updateScore(id, player.score + delta)
  }

  function changePassword() {
    if (!newPw.trim()) return
    send({ type: 'update_password', password: newPw.trim() })
    sessionStorage.setItem('adminPw', newPw.trim())
    setNewPw('')
    alert('Password updated!')
  }

  function resetScores() {
    if (!confirm('Reset all scores to 0?')) return
    send({ type: 'update_players', players: gameState.players.map(p => ({ ...p, score: 0 })) })
  }

  function unmarkAll() {
    if (!confirm('Unmark all answered questions?')) return
    const newCells = {}
    Object.entries(gameState.cells).forEach(([k, v]) => { newCells[k] = { ...v, answered: false } })
    send({ type: 'update_board', cells: newCells })
  }

  function fullReset() {
    if (!confirm('Full reset — clear all questions, players, and scores?')) return
    send({ type: 'reset_game' })
  }

  const activePoints = activeCell ? gameState.pointValues[activeCell.row] : 0

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h1>JEOPARDY! Admin</h1>
        <div className="admin-header-actions">
          <span className={`ws-badge ${wsStatus}`}>{wsStatus}</span>
          <button
            className="btn-secondary"
            style={{ width: 'auto', padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}
            onClick={onLeave}
          >
            Exit Admin
          </button>
        </div>
      </div>

      <div className="admin-tabs">
        {[
          { id: 'game',     label: 'Game Control' },
          { id: 'edit',     label: 'Edit Board' },
          { id: 'players',  label: 'Players' },
          { id: 'settings', label: 'Settings' },
        ].map(t => (
          <button
            key={t.id}
            className={`admin-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="admin-content">

        {/* ── Game Control ── */}
        {tab === 'game' && (
          <div>
            {/* Turn Control */}
            {gameState.players.length > 0 && (
              <div className="turn-control">
                <div className="turn-control-header">
                  <span className="turn-label">
                    Turn: <strong>{gameState.activePlayerName || 'None selected'}</strong>
                  </span>
                  <button className="admin-btn yellow" onClick={() => send({ type: 'next_player' })}>
                    Next Player →
                  </button>
                </div>
                <div className="turn-player-btns">
                  {gameState.players.map(p => (
                    <button
                      key={p.name}
                      className={`admin-btn ${gameState.activePlayerName === p.name ? 'yellow' : 'blue'}`}
                      onClick={() => send({ type: 'set_active_player', playerName: p.name })}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="buzzer-controls">
              <button className="admin-btn green" onClick={() => send({ type: 'activate_buzzer' })}>
                ✓ Activate Buzzer
              </button>
              <button className="admin-btn orange" onClick={() => send({ type: 'reset_buzzers' })}>
                ↺ Reset Buzzers
              </button>
              {activeCell && (
                <>
                  <button className="admin-btn green" onClick={() => send({ type: 'mark_answered' })}>
                    ✓ Mark Answered
                  </button>
                  <button className="admin-btn red" onClick={() => send({ type: 'close_question' })}>
                    ✗ Close Question
                  </button>
                </>
              )}
            </div>

            {gameState.buzzerActive && (
              <div className="buzzer-active-indicator">⚡ BUZZER ACTIVE</div>
            )}

            {gameState.buzzOrder.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <BuzzerDisplay buzzOrder={gameState.buzzOrder} />
              </div>
            )}

            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
              Click a cell to open its question for all viewers.
            </p>

            <div className="admin-board-wrap">
              <Board
                gameState={gameState}
                isAdmin
                onCellClick={handleGameCellClick}
                onFinalClick={handleFinalClick}
              />
            </div>

            {gameState.finalJeopardy?.active && (
              <div className="final-jeopardy-controls">
                <span style={{ color: '#c080ff', fontWeight: 'bold', fontSize: '0.85rem', alignSelf: 'center' }}>
                  ★ Final Jeopardy Active
                </span>
                <button
                  className="admin-btn yellow"
                  onClick={() => send({ type: 'reveal_final_answer' })}
                >
                  {gameState.finalJeopardy.answerRevealed ? 'Hide Answer' : 'Reveal Answer'}
                </button>
                <button
                  className="admin-btn"
                  style={{ background: '#1a0a30', color: '#c080ff', borderColor: 'rgba(160,80,240,0.4)' }}
                  onClick={() => window.open('/final', 'final_jeopardy', 'noopener,noreferrer')}
                >
                  Open Final Page
                </button>
                <button
                  className="admin-btn red"
                  onClick={() => send({ type: 'close_final_jeopardy' })}
                >
                  Close Final Jeopardy
                </button>
              </div>
            )}

            {activeCell && activeCellData && (
              <QuestionModal
                cell={activeCellData}
                pointValue={gameState.pointValues[activeCell.row]}
                category={gameState.categories[activeCell.col]}
                isAdmin
                buzzOrder={gameState.buzzOrder}
                buzzerActive={gameState.buzzerActive}
                onClose={() => send({ type: 'close_question' })}
                onActivateBuzzer={() => send({ type: 'activate_buzzer' })}
                onResetBuzzers={() => send({ type: 'reset_buzzers' })}
                onMarkAnswered={() => send({ type: 'mark_answered' })}
              />
            )}
          </div>
        )}

        {/* ── Edit Board ── */}
        {tab === 'edit' && (
          <div>
            <div className="point-vals-row">
              <span style={{ color: '#ffdd00', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Point values:</span>
              {gameState.pointValues.map((val, i) => (
                <input
                  key={i}
                  type="number"
                  className="point-val-input"
                  value={val}
                  onChange={e => {
                    const v = [...gameState.pointValues]
                    v[i] = parseInt(e.target.value) || val
                    send({ type: 'update_board', pointValues: v })
                  }}
                />
              ))}
            </div>

            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
              Edit category names inline. Click a cell to set its question &amp; answer.
              Green border = has content.
            </p>

            <div className="admin-board-wrap">
              <div className="admin-board-grid">
                {gameState.categories.map((cat, col) => (
                  <input
                    key={col}
                    type="text"
                    className="admin-cat-input"
                    value={cat}
                    onChange={e => {
                      const c = [...gameState.categories]
                      c[col] = e.target.value
                      send({ type: 'update_board', categories: c })
                    }}
                    placeholder={`Category ${col + 1}`}
                  />
                ))}

                {gameState.pointValues.map((points, row) =>
                  gameState.categories.map((_, col) => {
                    const key = `${col}-${row}`
                    const cell = gameState.cells[key]
                    const hasContent = !!(cell?.question || cell?.answer)
                    const isActive = activeCell?.col === col && activeCell?.row === row
                    return (
                      <button
                        key={key}
                        className={[
                          'admin-cell-btn',
                          cell?.answered ? 'answered' : '',
                          hasContent ? 'has-content' : '',
                          isActive ? 'active' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => openCellEdit(col, row)}
                      >
                        ${points}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            <div className="final-jeopardy-edit">
              <h3>★ Final Jeopardy</h3>
              <label>Category Name</label>
              <input
                type="text"
                className="admin-input"
                value={gameState.finalJeopardy?.category || ''}
                onChange={e => send({ type: 'update_final_jeopardy', data: { category: e.target.value } })}
                placeholder="Final Jeopardy Category"
              />
              <label>Question / Clue</label>
              <textarea
                className="cell-textarea"
                value={gameState.finalJeopardy?.question || ''}
                onChange={e => send({ type: 'update_final_jeopardy', data: { question: e.target.value } })}
                placeholder="Enter the Final Jeopardy clue shown to players…"
                rows={3}
              />
              <label>Answer / Correct Response</label>
              <textarea
                className="cell-textarea"
                value={gameState.finalJeopardy?.answer || ''}
                onChange={e => send({ type: 'update_final_jeopardy', data: { answer: e.target.value } })}
                placeholder="Enter the correct answer (revealed only when you choose)…"
                rows={2}
              />
            </div>

            {editingCell && (
              <div className="cell-modal-overlay">
                <div className="cell-modal">
                  <h3>
                    {gameState.categories[editingCell.col]} — ${gameState.pointValues[editingCell.row]}
                  </h3>
                  <label>Question / Clue</label>
                  <textarea
                    className="cell-textarea"
                    value={editQ}
                    onChange={e => setEditQ(e.target.value)}
                    placeholder="Enter the clue shown to players..."
                    rows={3}
                    autoFocus
                  />
                  <label>Answer / Correct Response</label>
                  <textarea
                    className="cell-textarea"
                    value={editA}
                    onChange={e => setEditA(e.target.value)}
                    placeholder="Enter the correct answer (shown only to admin)..."
                    rows={2}
                  />
                  <div className="cell-modal-actions">
                    <button className="admin-btn red" onClick={() => setEditingCell(null)}>Cancel</button>
                    <button className="admin-btn green" onClick={saveCell}>Save</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Players ── */}
        {tab === 'players' && (
          <div>
            <div className="add-player-row">
              <input
                type="text"
                className="admin-input"
                value={newPlayerName}
                onChange={e => setNewPlayerName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addPlayer()}
                placeholder="Player name"
              />
              <button className="admin-btn green" onClick={addPlayer}>Add Player</button>
            </div>

            <table className="players-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Score</th>
                  {activeCell && <th>Quick ±{activePoints}</th>}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {gameState.players.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: 'rgba(255,255,255,0.35)', textAlign: 'center', paddingTop: '1.5rem' }}>
                      No players yet — add them above or have them join from the main page.
                    </td>
                  </tr>
                ) : (
                  gameState.players.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 'bold' }}>{p.name}</td>
                      <td>
                        <input
                          type="number"
                          className="score-input"
                          value={p.score}
                          onChange={e => updateScore(p.id, e.target.value)}
                        />
                      </td>
                      {activeCell && (
                        <td>
                          <button
                            className="admin-btn green"
                            style={{ marginRight: '0.4rem', fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                            onClick={() => quickScore(p.id, activePoints)}
                          >
                            +${activePoints}
                          </button>
                          <button
                            className="admin-btn red"
                            style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                            onClick={() => quickScore(p.id, -activePoints)}
                          >
                            −${activePoints}
                          </button>
                        </td>
                      )}
                      <td>
                        <button
                          className="admin-btn red"
                          style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                          onClick={() => removePlayer(p.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Settings ── */}
        {tab === 'settings' && (
          <div>
            <div className="settings-block">
              <h3>Admin Password</h3>
              <div className="settings-row">
                <input
                  type="password"
                  className="admin-input"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && changePassword()}
                  placeholder="New password"
                />
                <button className="admin-btn blue" onClick={changePassword}>Update</button>
              </div>
              <p className="hint-text">Default password is "jeopardy"</p>
            </div>

            <div className="settings-block">
              <h3>Danger Zone</h3>
              <div className="danger-zone">
                <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                  <button className="admin-btn orange" onClick={resetScores}>Reset All Scores</button>
                  <button className="admin-btn orange" onClick={unmarkAll}>Unmark All Questions</button>
                  <button className="admin-btn red" onClick={fullReset}>Full Game Reset</button>
                </div>
                <p className="hint-text" style={{ marginTop: '0.75rem' }}>
                  Full reset clears questions, players, scores, and buzzers.
                </p>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
