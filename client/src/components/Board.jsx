export default function Board({ gameState, isAdmin, onCellClick, onFinalClick, onUnmarkCell, myPlayerName }) {
  const { categories, pointValues, cells, activeCell, finalJeopardy, activePlayerName, pendingCellRequest } = gameState

  const fj = finalJeopardy || { category: 'Final Jeopardy', active: false }
  const allAnswered = Object.values(cells).every(c => c.answered)
  const canLaunch = allAnswered && !fj.active && isAdmin && !!onFinalClick

  const isMyTurn = !isAdmin && !!myPlayerName && myPlayerName === activePlayerName
  const hasPending = !isAdmin && !!pendingCellRequest

  function handleCellClick(col, row) {
    if (!onCellClick) return
    if (isAdmin) {
      onCellClick(col, row)
      return
    }
    // Player path
    if (!isMyTurn) {
      onCellClick(col, row) // App.jsx will handle "not your turn" feedback
      return
    }
    if (hasPending) return // already waiting for approval
    onCellClick(col, row)
  }

  return (
    <div className="board" style={{ gridTemplateColumns: `repeat(${categories.length}, 1fr)` }}>
      {categories.map((cat, col) => (
        <div key={col} className="category-cell">{cat}</div>
      ))}

      {pointValues.map((points, row) =>
        categories.map((_, col) => {
          const key = `${col}-${row}`
          const cell = cells[key]
          const isActive = activeCell?.col === col && activeCell?.row === row
          const answered = !!cell?.answered
          const isPendingThis = pendingCellRequest?.col === col && pendingCellRequest?.row === row

          let cellClass = 'board-cell'
          if (answered) cellClass += ' answered'
          if (isActive) cellClass += ' active'
          if (!isAdmin && !isMyTurn && !answered) cellClass += ' not-my-turn'
          if (isPendingThis) cellClass += ' pending-request'

          return (
            <button
              key={key}
              className={cellClass}
              onClick={() => {
                if (!answered) handleCellClick(col, row)
              }}
              tabIndex={answered ? -1 : 0}
              aria-label={answered ? 'answered' : `$${points}`}
            >
              {!answered ? `$${points}` : ''}
              {answered && onUnmarkCell && (
                <span
                  className="unmark-btn"
                  title="Restore question"
                  onClick={e => { e.stopPropagation(); onUnmarkCell(col, row) }}
                >↺</span>
              )}
            </button>
          )
        })
      )}

      <button
        className={[
          'final-jeopardy-cell',
          fj.active ? 'fj-active' : allAnswered ? 'fj-available' : 'fj-locked',
        ].join(' ')}
        onClick={() => canLaunch && onFinalClick()}
        disabled={!canLaunch}
        tabIndex={canLaunch ? 0 : -1}
        aria-label="Final Jeopardy"
      >
        {fj.active
          ? '★ FINAL JEOPARDY — IN PROGRESS'
          : isAdmin && allAnswered
            ? '★ LAUNCH FINAL JEOPARDY'
            : '★ FINAL JEOPARDY'}
      </button>
    </div>
  )
}
