import { useState } from 'react'
import BuzzerDisplay from './BuzzerDisplay'

export default function QuestionModal({
  cell, pointValue, category, isAdmin,
  buzzOrder, buzzerActive,
  onClose, onActivateBuzzer, onResetBuzzers, onMarkAnswered,
}) {
  const [showAnswer, setShowAnswer] = useState(false)

  if (!cell) return null

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-meta">{category}</div>
        <div className="modal-points">${pointValue}</div>

        <div className="modal-question">
          {cell.question || <em style={{ opacity: 0.5 }}>No question set</em>}
        </div>

        {isAdmin && showAnswer && (
          <div className="modal-answer">
            <strong>Answer:</strong> {cell.answer || <em>No answer set</em>}
          </div>
        )}

        <div className="modal-buzzer-section">
          {buzzerActive && (
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

        {isAdmin && (
          <div className="modal-controls">
            <button className="btn-ctrl yellow" onClick={() => setShowAnswer(v => !v)}>
              {showAnswer ? 'Hide Answer' : 'Show Answer'}
            </button>
            <button className="btn-ctrl green" onClick={onActivateBuzzer}>
              ✓ Activate Buzzer
            </button>
            <button className="btn-ctrl orange" onClick={onResetBuzzers}>
              ↺ Reset Buzzers
            </button>
            <button className="btn-ctrl green" onClick={onMarkAnswered}>
              ✓ Mark Answered
            </button>
            <button className="btn-ctrl white" onClick={onClose}>
              ✗ Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
