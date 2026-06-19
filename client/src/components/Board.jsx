export default function Board({ gameState, isAdmin, onCellClick, onFinalClick }) {
  const { categories, pointValues, cells, activeCell, finalJeopardy } = gameState

  const fj = finalJeopardy || { category: 'Final Jeopardy', active: false }
  const allAnswered = Object.values(cells).every(c => c.answered)
  const canLaunch = allAnswered && !fj.active && isAdmin && !!onFinalClick

  return (
    <div className="board">
      {categories.map((cat, col) => (
        <div key={col} className="category-cell">{cat}</div>
      ))}

      {pointValues.map((points, row) =>
        categories.map((_, col) => {
          const key = `${col}-${row}`
          const cell = cells[key]
          const isActive = activeCell?.col === col && activeCell?.row === row
          const answered = !!cell?.answered

          return (
            <button
              key={key}
              className={[
                'board-cell',
                answered ? 'answered' : '',
                isActive ? 'active' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => {
                if (!answered && onCellClick) onCellClick(col, row)
              }}
              tabIndex={answered ? -1 : 0}
              aria-label={answered ? 'answered' : `$${points}`}
            >
              {!answered ? `$${points}` : ''}
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
