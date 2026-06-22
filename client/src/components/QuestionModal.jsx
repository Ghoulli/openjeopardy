import { useState } from 'react'
import BuzzerDisplay from './BuzzerDisplay'

export default function QuestionModal({
  cell, pointValue, category, isAdmin,
  buzzOrder, buzzerActive,
  onClose, onActivateBuzzer, onResetBuzzers, onStopBuzzer, onMarkAnswered,
  isDailyDouble, dailyDoubleWager, activePlayerName, isActivePlayer,
  onSetWager, onWrongAnswer,
}) {
  const [showAnswer, setShowAnswer] = useState(false)
  const [wagerInput, setWagerInput] = useState('')

  if (!cell) return null

  const hasImage = !!cell.image
  const ddWagerPhase = isDailyDouble && dailyDoubleWager == null
  const ddQuestionPhase = isDailyDouble && dailyDoubleWager != null

  function submitWager() {
    const w = parseInt(wagerInput)
    if (!isFinite(w) || w < 1) return
    onSetWager(w)
    setWagerInput('')
  }

  // ── Daily Double: wager phase ──────────────────────────────────────────────
  if (ddWagerPhase) {
    return (
      <div className="modal-overlay">
        <div className="modal dd-modal">
          <div className="dd-splash">DAILY DOUBLE!</div>
          <div className="dd-category">{category}</div>

          {activePlayerName && (
            <div className="dd-wagering-line">
              {isActivePlayer
                ? 'Enter your wager:'
                : isAdmin
                  ? `${activePlayerName} is wagering…`
                  : `${activePlayerName} is wagering…`
              }
            </div>
          )}

          {(isActivePlayer || isAdmin) && (
            <div className="dd-wager-row">
              <input
                className="dd-wager-input"
                type="number"
                min={1}
                value={wagerInput}
                onChange={e => setWagerInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitWager()}
                placeholder="Wager amount"
                autoFocus={isActivePlayer}
              />
              <button className="admin-btn green" onClick={submitWager}>Set Wager</button>
            </div>
          )}

          {isAdmin && (
            <div className="modal-controls" style={{ marginTop: '0.5rem' }}>
              <button className="btn-ctrl white" onClick={onClose}>✗ Close</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Normal or Daily Double question phase ─────────────────────────────────
  return (
    <div className="modal-overlay">
      <div className="modal">
        {ddQuestionPhase ? (
          <div className="dd-header-bar">
            <span className="dd-tag">DAILY DOUBLE</span>
            <span className="dd-wager-display">Wager: ${dailyDoubleWager?.toLocaleString()}</span>
          </div>
        ) : (
          <>
            <div className="modal-meta">{category}</div>
            <div className="modal-points">${pointValue}</div>
          </>
        )}

        {hasImage ? (
          <div className="modal-content-row">
            <div className="modal-question modal-question-left">
              {cell.question || <em style={{ opacity: 0.5 }}>No question set</em>}
            </div>
            <div className="modal-image-wrap">
              <img src={cell.image} alt="" className="modal-image" />
            </div>
          </div>
        ) : (
          <div className="modal-question">
            {cell.question || <em style={{ opacity: 0.5 }}>No question set</em>}
          </div>
        )}

        {isAdmin && showAnswer && (
          <div className="modal-answer">
            <strong>Answer:</strong> {cell.answer || <em>No answer set</em>}
          </div>
        )}

        {!ddQuestionPhase && (
          <div className="modal-buzzer-section">
            {buzzerActive && (!buzzOrder || buzzOrder.length === 0) && (
              <div className="modal-buzzer-active">
                BUZZER ACTIVE — Players can buzz in!
              </div>
            )}
            {buzzOrder && buzzOrder.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <BuzzerDisplay buzzOrder={buzzOrder} />
              </div>
            )}
          </div>
        )}

        {isAdmin && (
          <div className="modal-controls">
            <button className="btn-ctrl yellow" onClick={() => setShowAnswer(v => !v)}>
              {showAnswer ? 'Hide Answer' : 'Show Answer'}
            </button>
            {!ddQuestionPhase && (
              <>
                <button className="btn-ctrl green" onClick={onActivateBuzzer}>
                  ✓ Activate Buzzer
                </button>
                {buzzerActive && (
                  <button className="btn-ctrl red" onClick={onStopBuzzer}>
                    ■ Stop Buzzer
                  </button>
                )}
                <button className="btn-ctrl orange" onClick={onResetBuzzers}>
                  ↺ Reset Buzzers
                </button>
              </>
            )}
            <button className="btn-ctrl green" onClick={onMarkAnswered}>
              {ddQuestionPhase
                ? `✓ Correct (+$${dailyDoubleWager?.toLocaleString()})`
                : '✓ Mark Answered'}
            </button>
            {onWrongAnswer && (
              <button className="btn-ctrl red" onClick={onWrongAnswer}>
                {ddQuestionPhase
                  ? `✗ Wrong (−$${dailyDoubleWager?.toLocaleString()})`
                  : buzzOrder?.length > 0
                    ? `✗ Wrong (−$${pointValue?.toLocaleString()})`
                    : '✗ Wrong Answer'}
              </button>
            )}
            <button className="btn-ctrl white" onClick={onClose}>
              ✗ Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
