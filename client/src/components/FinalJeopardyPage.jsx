export default function FinalJeopardyPage({ gameState, wsStatus }) {
  const fj = gameState?.finalJeopardy || {}

  return (
    <div className="fj-page">
      <div className="fj-header">
        <div className="fj-title">FINAL JEOPARDY!</div>
        {fj.category && <div className="fj-category">{fj.category}</div>}
      </div>

      <div className="fj-body">
        {fj.active ? (
          <>
            <div className="fj-question">
              {fj.question || <em style={{ opacity: 0.5 }}>Question will appear here</em>}
            </div>
            {fj.answerRevealed && (
              <div className="fj-answer">
                <div className="fj-answer-label">Answer</div>
                <div className="fj-answer-text">{fj.answer || 'No answer set'}</div>
              </div>
            )}
          </>
        ) : (
          <div className="fj-waiting">
            <div className="fj-waiting-text">Preparing Final Jeopardy…</div>
          </div>
        )}
      </div>

      {gameState?.players?.length > 0 && (
        <div className="fj-scoreboard">
          {gameState.players.map(p => (
            <div key={p.id} className="fj-player">
              <div className="fj-player-name">{p.name}</div>
              <div className="fj-player-score">
                {p.score < 0 ? '-' : ''}${Math.abs(p.score).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      <span className={`ws-badge ${wsStatus}`}>{wsStatus}</span>
    </div>
  )
}
